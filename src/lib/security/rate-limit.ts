import "server-only";

type RateLimitPolicy = {
  windowMs: number;
  max: number;
  blockMs?: number;
};

type RateLimitState = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

type GlobalStore = {
  states: Map<string, RateLimitState>;
  lastCleanupAt: number;
};

const GLOBAL_KEY = "__proxcenter_rate_limit_store__";
const CLEANUP_INTERVAL_MS = 60_000;

function getStore(): GlobalStore {
  const globalRef = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalStore;
  };

  if (!globalRef[GLOBAL_KEY]) {
    globalRef[GLOBAL_KEY] = {
      states: new Map(),
      lastCleanupAt: 0,
    };
  }

  return globalRef[GLOBAL_KEY];
}

function maybeCleanup(now: number) {
  const store = getStore();
  if (now - store.lastCleanupAt < CLEANUP_INTERVAL_MS) return;

  for (const [key, state] of store.states.entries()) {
    const expiredWindow = now - state.windowStart > 10 * 60_000 && now >= state.blockedUntil;
    if (expiredWindow) {
      store.states.delete(key);
    }
  }

  store.lastCleanupAt = now;
}

export function consumeRateLimit(key: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  const store = getStore();
  maybeCleanup(now);

  const existing = store.states.get(key);
  let state: RateLimitState;

  if (!existing || now - existing.windowStart >= policy.windowMs) {
    state = { count: 0, windowStart: now, blockedUntil: 0 };
  } else {
    state = existing;
  }

  if (state.blockedUntil > now) {
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: state.blockedUntil - now,
    };
  }

  state.count += 1;
  if (state.count > policy.max) {
    const blockMs = policy.blockMs ?? policy.windowMs;
    state.blockedUntil = now + blockMs;
    store.states.set(key, state);
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: blockMs,
    };
  }

  store.states.set(key, state);
  return {
    ok: true,
    remaining: Math.max(0, policy.max - state.count),
    retryAfterMs: 0,
  };
}

export function resetRateLimit(key: string) {
  getStore().states.delete(key);
}
