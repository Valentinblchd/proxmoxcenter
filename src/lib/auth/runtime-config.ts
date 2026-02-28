import "server-only";
import fs from "node:fs";
import path from "node:path";

export type RuntimeAuthConfig = {
  enabled: boolean;
  username: string;
  email: string | null;
  passwordHash: string;
  passwordSalt: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  secureCookie: boolean;
  updatedAt: string;
};

type RuntimeAuthConfigInput = {
  enabled?: unknown;
  username?: unknown;
  email?: unknown;
  passwordHash?: unknown;
  passwordSalt?: unknown;
  sessionSecret?: unknown;
  sessionTtlSeconds?: unknown;
  secureCookie?: unknown;
  updatedAt?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asEmailOrNull(value: unknown) {
  const email = asNonEmptyString(value);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!normalized.includes("@") || normalized.startsWith("@") || normalized.endsWith("@")) {
    return null;
  }
  return normalized;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function getDefaultRuntimeAuthConfigPath() {
  return path.join(process.cwd(), "data", "app-auth.json");
}

export function getRuntimeAuthConfigPath() {
  const custom = process.env.PROXCENTER_AUTH_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimeAuthConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeRuntimeAuthConfig(
  input: RuntimeAuthConfigInput,
): RuntimeAuthConfig | null {
  const username = asNonEmptyString(input.username);
  const email = asEmailOrNull(input.email);
  const passwordHash = asNonEmptyString(input.passwordHash);
  const passwordSalt = asNonEmptyString(input.passwordSalt);
  const sessionSecret = asNonEmptyString(input.sessionSecret);

  if (!username || !passwordHash || !passwordSalt || !sessionSecret) {
    return null;
  }

  return {
    enabled: asBoolean(input.enabled, true),
    username,
    email,
    passwordHash,
    passwordSalt,
    sessionSecret,
    sessionTtlSeconds: asPositiveInt(input.sessionTtlSeconds, 60 * 60 * 12),
    secureCookie: asBoolean(input.secureCookie, false),
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt.trim()
        ? input.updatedAt
        : new Date().toISOString(),
  };
}

export function readRuntimeAuthConfig(): RuntimeAuthConfig | null {
  const filePath = getRuntimeAuthConfigPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return normalizeRuntimeAuthConfig(JSON.parse(raw) as RuntimeAuthConfigInput);
  } catch {
    return null;
  }
}

export function writeRuntimeAuthConfig(input: RuntimeAuthConfigInput) {
  const normalized = normalizeRuntimeAuthConfig(input);
  if (!normalized) {
    throw new Error("Invalid runtime auth config.");
  }

  const filePath = getRuntimeAuthConfigPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function deleteRuntimeAuthConfig() {
  const filePath = getRuntimeAuthConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
