import "server-only";
import { randomUUID } from "node:crypto";

type GoogleOauthState = {
  id: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
};

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_CACHE_KEY = "__proxcenter_google_oauth_state__";

function getOAuthStateCache() {
  const globalRef = globalThis as typeof globalThis & {
    [OAUTH_STATE_CACHE_KEY]?: Map<string, GoogleOauthState>;
  };

  if (!globalRef[OAUTH_STATE_CACHE_KEY]) {
    globalRef[OAUTH_STATE_CACHE_KEY] = new Map<string, GoogleOauthState>();
  }
  return globalRef[OAUTH_STATE_CACHE_KEY];
}

function pruneExpiredStates(cache: Map<string, GoogleOauthState>, nowMs: number) {
  for (const [key, state] of cache.entries()) {
    if (state.expiresAt <= nowMs) {
      cache.delete(key);
    }
  }
}

export function issueGoogleOauthState(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const cache = getOAuthStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);

  const id = randomUUID();
  cache.set(id, {
    id,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
    createdAt: nowMs,
    expiresAt: nowMs + OAUTH_STATE_TTL_MS,
  });

  return { id };
}

export function consumeGoogleOauthState(id: string) {
  const cache = getOAuthStateCache();
  const nowMs = Date.now();
  pruneExpiredStates(cache, nowMs);
  const state = cache.get(id) ?? null;
  if (!state) return null;
  cache.delete(id);
  if (state.expiresAt <= nowMs) return null;
  return state;
}
