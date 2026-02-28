import {
  findRuntimeAuthUserById,
  findRuntimeAuthUserByUsername,
  readRuntimeAuthConfig,
} from "@/lib/auth/runtime-config";
import {
  getDefaultSecondaryAuthRole,
  normalizeRuntimeAuthUserRole,
  type RuntimeAuthUserRole,
} from "@/lib/auth/rbac";
import { isLdapSecondaryAuthEnabled } from "@/lib/auth/ldap";

export const AUTH_COOKIE_NAME = "proxcenter_session";
export type AuthMethod = "local" | "ldap";

type AuthResolvedConfig = {
  source: "runtime";
  users: Array<{
    id: string;
    username: string;
    passwordHash: string;
    passwordSalt: string;
    role: RuntimeAuthUserRole;
    enabled: boolean;
  }>;
  sessionSecret: string;
  sessionTtlSeconds: number;
  secureCookie: boolean;
};

export type AuthSession = {
  userId: string | null;
  username: string;
  role: RuntimeAuthUserRole;
  authMethod: AuthMethod;
  issuedAt: number;
  expiresAt: number;
};

function getRuntimeAuthResolvedConfig(): AuthResolvedConfig | null {
  const runtime = readRuntimeAuthConfig();
  if (!runtime?.enabled) return null;

  return {
    source: "runtime",
    users: runtime.users.map((user) => ({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      role: user.role,
      enabled: user.enabled,
    })),
    sessionSecret: runtime.sessionSecret,
    sessionTtlSeconds: runtime.sessionTtlSeconds,
    secureCookie: runtime.secureCookie,
  };
}

export function getAuthConfig(): AuthResolvedConfig | null {
  return getRuntimeAuthResolvedConfig();
}

export function isAuthEnabled() {
  return getAuthConfig() !== null;
}

export function getAuthStatus() {
  const runtime = readRuntimeAuthConfig();
  const runtimeActive = Boolean(
    runtime?.enabled &&
      runtime.users.some((user) => user.enabled && user.passwordHash && user.passwordSalt) &&
      runtime.sessionSecret,
  );

  return {
    enabledFlag: Boolean(runtime?.enabled),
    configured: runtimeActive,
    runtimeConfigured: runtimeActive,
    source: runtimeActive ? ("runtime" as const) : ("none" as const),
    active: runtimeActive,
  };
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(message: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(message),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function pbkdf2Sha256Hex(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  );

  return Array.from(new Uint8Array(bits))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPasswordWithSalt(password: string, salt: string) {
  const iterations = 310_000;
  const hash = await pbkdf2Sha256Hex(password, salt, iterations);
  return `pbkdf2-sha256:${iterations}:${hash}`;
}

export function randomHex(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeBase64Url(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const base64 = `${padded}${padding}`;

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function timingSafeEqualString(a: string, b: string) {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

export async function authenticateLocalCredentials(
  username: string,
  password: string,
): Promise<{ userId: string; username: string; role: RuntimeAuthUserRole } | null> {
  const config = getAuthConfig();
  if (!config) return null;
  const normalized = username.trim().toLowerCase();
  const user =
    config.users.find((entry) => entry.enabled && entry.username.toLowerCase() === normalized) ?? null;
  if (!user) return null;

  const expectedHash = user.passwordHash;
  const salt = user.passwordSalt;
  if (!expectedHash || !salt) return null;

  let actualHash: string;
  if (expectedHash.startsWith("pbkdf2-sha256:")) {
    const [, iterationsRaw] = expectedHash.split(":", 3);
    const iterations = Number.parseInt(iterationsRaw ?? "", 10);
    if (!Number.isInteger(iterations) || iterations < 100_000) return null;
    const derived = await pbkdf2Sha256Hex(password, salt, iterations);
    actualHash = `pbkdf2-sha256:${iterations}:${derived}`;
  } else {
    actualHash = await sha256Hex(`${salt}:${password}`);
  }

  if (!timingSafeEqualString(actualHash, expectedHash)) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username,
    role: user.role,
  };
}

export async function verifyLoginCredentials(username: string, password: string) {
  return Boolean(await authenticateLocalCredentials(username, password));
}

export async function createSessionToken(input: {
  userId?: string | null;
  username: string;
  role: RuntimeAuthUserRole;
  authMethod: AuthMethod;
}) {
  const config = getAuthConfig();
  if (!config) {
    throw new Error("Auth is not configured.");
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.sessionTtlSeconds * 1000;
  const payload = JSON.stringify({
    i: input.userId ?? null,
    u: input.username,
    r: input.role,
    m: input.authMethod,
    t: issuedAt,
    e: expiresAt,
    v: 2,
  });
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(payload));
  const signature = await hmacHex(config.sessionSecret, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
    maxAge: config.sessionTtlSeconds,
    secureCookie: config.secureCookie,
  };
}

export async function verifySessionToken(token: string): Promise<AuthSession | null> {
  const config = getAuthConfig();
  if (!config) return null;

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = await hmacHex(config.sessionSecret, encodedPayload);
  if (!timingSafeEqualString(providedSignature, expectedSignature)) {
    return null;
  }

  const decoded = new TextDecoder().decode(decodeBase64Url(encodedPayload));
  const payload = safeJsonParse<{ i?: unknown; u?: unknown; r?: unknown; m?: unknown; t?: unknown; e?: unknown; v?: unknown }>(
    decoded,
  );

  if (!payload || typeof payload.u !== "string" || typeof payload.e !== "number") {
    return null;
  }

  if (!Number.isFinite(payload.e) || payload.e <= Date.now()) {
    return null;
  }

  const authMethod = payload.m === "ldap" ? "ldap" : "local";

  if (authMethod === "ldap") {
    if (!isLdapSecondaryAuthEnabled()) {
      return null;
    }

    return {
      userId: null,
      username: payload.u,
      role: normalizeRuntimeAuthUserRole(payload.r ?? getDefaultSecondaryAuthRole()),
      authMethod,
      issuedAt:
        typeof payload.t === "number" && Number.isFinite(payload.t) ? payload.t : Date.now(),
      expiresAt: payload.e,
    };
  }

  const existingUser =
    typeof payload.i === "string" ? findRuntimeAuthUserById(payload.i) : findRuntimeAuthUserByUsername(payload.u);
  if (!existingUser?.enabled) {
    return null;
  }

  if (existingUser.sessionRevokedAt) {
    const revokedAtMs = Date.parse(existingUser.sessionRevokedAt);
    const issuedAtMs =
      typeof payload.t === "number" && Number.isFinite(payload.t) ? payload.t : 0;
    if (Number.isFinite(revokedAtMs) && issuedAtMs < revokedAtMs) {
      return null;
    }
  }

  return {
    userId: existingUser.id,
    username: existingUser.username,
    role: existingUser.role,
    authMethod,
    issuedAt:
      typeof payload.t === "number" && Number.isFinite(payload.t) ? payload.t : Date.now(),
    expiresAt: payload.e,
  };
}

export function sanitizeNextPath(nextValue: string | null | undefined) {
  if (!nextValue) return "/";
  if (!nextValue.startsWith("/")) return "/";
  if (nextValue.startsWith("//")) return "/";
  return nextValue;
}
