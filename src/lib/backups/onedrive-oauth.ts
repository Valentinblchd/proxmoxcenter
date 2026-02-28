import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";

type OneDriveOauthState = {
  id: string;
  clientId: string;
  authority: string;
  redirectUri: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
};

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_CACHE_KEY = "__proxcenter_onedrive_oauth_state__";

function toBase64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeCodeVerifier() {
  return toBase64Url(randomBytes(48));
}

function makeCodeChallenge(codeVerifier: string) {
  return toBase64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

function getOAuthStateCache() {
  const globalRef = globalThis as typeof globalThis & {
    [OAUTH_STATE_CACHE_KEY]?: Map<string, OneDriveOauthState>;
  };

  if (!globalRef[OAUTH_STATE_CACHE_KEY]) {
    globalRef[OAUTH_STATE_CACHE_KEY] = new Map<string, OneDriveOauthState>();
  }
  return globalRef[OAUTH_STATE_CACHE_KEY];
}

function pruneExpiredStates(cache: Map<string, OneDriveOauthState>, nowMs: number) {
  for (const [key, state] of cache.entries()) {
    if (state.expiresAt <= nowMs) {
      cache.delete(key);
    }
  }
}

export function issueOneDriveOauthState(input: {
  clientId: string;
  authority: string;
  redirectUri: string;
}) {
  const cache = getOAuthStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);

  const id = randomUUID();
  const codeVerifier = makeCodeVerifier();
  const state: OneDriveOauthState = {
    id,
    clientId: input.clientId,
    authority: input.authority,
    redirectUri: input.redirectUri,
    codeVerifier,
    createdAt: nowMs,
    expiresAt: nowMs + OAUTH_STATE_TTL_MS,
  };

  cache.set(id, state);
  return {
    id,
    codeChallenge: makeCodeChallenge(codeVerifier),
  };
}

export function consumeOneDriveOauthState(id: string) {
  const cache = getOAuthStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);
  const state = cache.get(id) ?? null;
  if (!state) return null;
  cache.delete(id);
  if (state.expiresAt <= nowMs) return null;
  return state;
}
