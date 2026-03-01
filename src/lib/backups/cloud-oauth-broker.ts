import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

export type CloudOauthProvider = "onedrive" | "gdrive";
export type CloudOauthMode = "central" | "local";

type BrokerStateBase = {
  id: string;
  provider: CloudOauthProvider;
  targetOrigin: string;
  createdAt: number;
  expiresAt: number;
};

type OneDriveBrokerState = BrokerStateBase & {
  provider: "onedrive";
  clientId: string;
  clientSecret: string | null;
  authority: string;
  redirectUri: string;
  codeVerifier: string;
};

type GoogleBrokerState = BrokerStateBase & {
  provider: "gdrive";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type BrokerState = OneDriveBrokerState | GoogleBrokerState;

const STATE_TTL_MS = 10 * 60_000;
const STATE_CACHE_KEY = "__proxcenter_cloud_oauth_broker_state__";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function asNonEmptyString(value: string | null | undefined, maxLength = 600) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = asNonEmptyString(value, 500);
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

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

function getStateCache() {
  const globalRef = globalThis as typeof globalThis & {
    [STATE_CACHE_KEY]?: Map<string, BrokerState>;
  };

  if (!globalRef[STATE_CACHE_KEY]) {
    globalRef[STATE_CACHE_KEY] = new Map<string, BrokerState>();
  }
  return globalRef[STATE_CACHE_KEY];
}

function pruneExpiredStates(cache: Map<string, BrokerState>, nowMs: number) {
  for (const [key, state] of cache.entries()) {
    if (state.expiresAt <= nowMs) {
      cache.delete(key);
    }
  }
}

export function getCloudOauthMode(): CloudOauthMode {
  return process.env.PROXMOXCENTER_CLOUD_OAUTH_MODE?.trim().toLowerCase() === "central" ? "central" : "local";
}

export function getCentralCloudOauthBrokerOrigin() {
  return normalizeOrigin(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN);
}

export function getCloudOauthBrokerStatus() {
  const mode = getCloudOauthMode();
  const brokerOrigin = getCentralCloudOauthBrokerOrigin();
  return {
    mode,
    brokerOrigin,
    brokerAvailable: mode === "central" ? Boolean(brokerOrigin) : false,
  };
}

export function getCentralCloudOauthProviderStatus() {
  const broker = getCloudOauthBrokerStatus();
  if (broker.mode !== "central") {
    return {
      mode: broker.mode,
      brokerOrigin: broker.brokerOrigin,
      onedrive: false,
      gdrive: false,
    };
  }
  return {
    mode: broker.mode,
    brokerOrigin: broker.brokerOrigin,
    onedrive: broker.brokerAvailable,
    gdrive: broker.brokerAvailable,
  };
}

export function getBrokerClientConfig(provider: CloudOauthProvider) {
  if (provider === "onedrive") {
    const clientId = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_ID, 200);
    const clientSecret = asNonEmptyString(
      process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_SECRET,
      3000,
    );
    const authority = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_AUTHORITY, 80) ?? "consumers";
    return {
      clientId,
      clientSecret,
      authority,
      ready: Boolean(clientId),
    };
  }

  const clientId = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_ID, 200);
  const clientSecret = asNonEmptyString(
    process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_SECRET,
    3000,
  );
  return {
    clientId,
    clientSecret,
    authority: null,
    ready: Boolean(clientId && clientSecret),
  };
}

export function issueBrokerOneDriveOauthState(input: {
  clientId: string;
  clientSecret?: string | null;
  authority: string;
  redirectUri: string;
  targetOrigin: string;
}) {
  const cache = getStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);

  const id = randomUUID();
  const codeVerifier = makeCodeVerifier();
  const state: OneDriveBrokerState = {
    id,
    provider: "onedrive",
    clientId: input.clientId,
    clientSecret: input.clientSecret ?? null,
    authority: input.authority,
    redirectUri: input.redirectUri,
    targetOrigin: input.targetOrigin,
    codeVerifier,
    createdAt: nowMs,
    expiresAt: nowMs + STATE_TTL_MS,
  };
  cache.set(id, state);
  return {
    id,
    codeChallenge: makeCodeChallenge(codeVerifier),
  };
}

export function issueBrokerGoogleOauthState(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  targetOrigin: string;
}) {
  const cache = getStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);

  const id = randomUUID();
  const state: GoogleBrokerState = {
    id,
    provider: "gdrive",
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
    targetOrigin: input.targetOrigin,
    createdAt: nowMs,
    expiresAt: nowMs + STATE_TTL_MS,
  };
  cache.set(id, state);
  return { id };
}

export function consumeBrokerOauthState(id: string) {
  const cache = getStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);
  const state = cache.get(id) ?? null;
  if (!state) return null;
  cache.delete(id);
  if (state.expiresAt <= nowMs) return null;
  return state;
}

export function parseBrokerTargetOrigin(value: string | null | undefined) {
  return normalizeOrigin(value);
}
