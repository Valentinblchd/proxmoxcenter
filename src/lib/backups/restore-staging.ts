import "server-only";
import { randomUUID } from "node:crypto";

type RestoreStagedPayload = {
  token: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  createdAt: string;
  expiresAt: number;
  downloads: number;
};

const STAGING_GLOBAL_KEY = "__proxcenter_backup_restore_staging__";
const STAGING_TTL_MS = 20 * 60_000;
const MAX_DOWNLOADS = 3;

function getStore() {
  const globalRef = globalThis as typeof globalThis & {
    [STAGING_GLOBAL_KEY]?: Map<string, RestoreStagedPayload>;
  };

  if (!globalRef[STAGING_GLOBAL_KEY]) {
    globalRef[STAGING_GLOBAL_KEY] = new Map<string, RestoreStagedPayload>();
  }
  return globalRef[STAGING_GLOBAL_KEY];
}

function pruneExpired() {
  const now = Date.now();
  const store = getStore();
  for (const [token, item] of store.entries()) {
    if (item.expiresAt <= now || item.downloads >= MAX_DOWNLOADS) {
      store.delete(token);
    }
  }
}

export function stageRestorePayload(input: {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}) {
  pruneExpired();
  const token = randomUUID();
  const createdAt = new Date().toISOString();
  const payload: RestoreStagedPayload = {
    token,
    filename: input.filename,
    contentType: input.contentType,
    bytes: input.bytes,
    createdAt,
    expiresAt: Date.now() + STAGING_TTL_MS,
    downloads: 0,
  };
  getStore().set(token, payload);
  return {
    token,
    filename: payload.filename,
    createdAt,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export function consumeStagedRestorePayload(token: string) {
  pruneExpired();
  const store = getStore();
  const item = store.get(token) ?? null;
  if (!item) return null;
  item.downloads += 1;
  if (item.downloads >= MAX_DOWNLOADS) {
    store.delete(token);
  } else {
    store.set(token, item);
  }
  return item;
}

export function peekStagedRestorePayload(token: string) {
  pruneExpired();
  return getStore().get(token) ?? null;
}
