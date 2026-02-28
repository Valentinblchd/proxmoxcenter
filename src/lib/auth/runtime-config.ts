import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  normalizeRuntimeAuthUserRole,
  type RuntimeAuthUserRole,
} from "@/lib/auth/rbac";

const LOCAL_USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;

export type RuntimeAuthUser = {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  passwordSalt: string;
  role: RuntimeAuthUserRole;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  sessionRevokedAt: string | null;
};

export type RuntimeAuthConfig = {
  enabled: boolean;
  username: string;
  email: string | null;
  passwordHash: string;
  passwordSalt: string;
  users: RuntimeAuthUser[];
  primaryUserId: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  secureCookie: boolean;
  updatedAt: string;
};

type RuntimeAuthUserInput = {
  id?: unknown;
  username?: unknown;
  email?: unknown;
  passwordHash?: unknown;
  passwordSalt?: unknown;
  role?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastLoginAt?: unknown;
  sessionRevokedAt?: unknown;
};

type RuntimeAuthConfigInput = {
  enabled?: unknown;
  username?: unknown;
  email?: unknown;
  passwordHash?: unknown;
  passwordSalt?: unknown;
  users?: unknown;
  primaryUserId?: unknown;
  sessionSecret?: unknown;
  sessionTtlSeconds?: unknown;
  secureCookie?: unknown;
  updatedAt?: unknown;
};

type RuntimeAuthUserCreateInput = {
  username: string;
  email?: string | null;
  passwordHash: string;
  passwordSalt: string;
  role?: RuntimeAuthUserRole;
  enabled?: boolean;
};

type RuntimeAuthSessionSettingsInput = {
  sessionTtlSeconds?: number;
  secureCookie?: boolean;
  sessionSecret?: string;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeLocalUsernameInput(value: unknown) {
  const username = asNonEmptyString(value);
  if (!username) return null;
  if (!LOCAL_USERNAME_PATTERN.test(username)) return null;
  return username;
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

function normalizeUserRole(value: unknown): RuntimeAuthUserRole {
  return normalizeRuntimeAuthUserRole(value);
}

function normalizeRuntimeAuthUser(input: RuntimeAuthUserInput): RuntimeAuthUser | null {
  const username = asNonEmptyString(input.username);
  const passwordHash = asNonEmptyString(input.passwordHash);
  const passwordSalt = asNonEmptyString(input.passwordSalt);
  if (!username || !passwordHash || !passwordSalt) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: asNonEmptyString(input.id) ?? `local-${username.toLowerCase()}`,
    username,
    email: asEmailOrNull(input.email),
    passwordHash,
    passwordSalt,
    role: normalizeUserRole(input.role),
    enabled: asBoolean(input.enabled, true),
    createdAt: asNonEmptyString(input.createdAt) ?? now,
    updatedAt: asNonEmptyString(input.updatedAt) ?? now,
    lastLoginAt: asNonEmptyString(input.lastLoginAt),
    sessionRevokedAt: asNonEmptyString(input.sessionRevokedAt),
  };
}

function normalizeUsers(input: RuntimeAuthConfigInput) {
  const seen = new Set<string>();
  const rawUsers = Array.isArray(input.users) ? input.users : [];
  const normalizedUsers = rawUsers
    .map((entry) => normalizeRuntimeAuthUser((entry ?? {}) as RuntimeAuthUserInput))
    .filter((entry): entry is RuntimeAuthUser => Boolean(entry))
    .filter((entry) => {
      const key = entry.username.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (normalizedUsers.length > 0) {
    return normalizedUsers;
  }

  const legacyUser = normalizeRuntimeAuthUser({
    username: input.username,
    email: input.email,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    role: "admin",
    enabled: true,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  });

  return legacyUser ? [legacyUser] : [];
}

function normalizeRuntimeAuthConfig(input: RuntimeAuthConfigInput): RuntimeAuthConfig | null {
  const sessionSecret = asNonEmptyString(input.sessionSecret);
  const users = normalizeUsers(input);
  if (!sessionSecret || users.length === 0) {
    return null;
  }

  const primaryUserIdRaw = asNonEmptyString(input.primaryUserId);
  const enabledUsers = users.filter((user) => user.enabled);
  const primaryUser =
    users.find((user) => user.id === primaryUserIdRaw) ??
    enabledUsers[0] ??
    users[0];

  if (!primaryUser) {
    return null;
  }

  const updatedAt = asNonEmptyString(input.updatedAt) ?? new Date().toISOString();

  return {
    enabled: asBoolean(input.enabled, true),
    username: primaryUser.username,
    email: primaryUser.email,
    passwordHash: primaryUser.passwordHash,
    passwordSalt: primaryUser.passwordSalt,
    users,
    primaryUserId: primaryUser.id,
    sessionSecret,
    sessionTtlSeconds: asPositiveInt(input.sessionTtlSeconds, 60 * 60 * 12),
    secureCookie: asBoolean(input.secureCookie, false),
    updatedAt,
  };
}

function writeNormalizedRuntimeAuthConfig(config: RuntimeAuthConfig) {
  const primaryUser =
    config.users.find((user) => user.id === config.primaryUserId) ??
    config.users.find((user) => user.enabled) ??
    config.users[0];
  if (!primaryUser) {
    throw new Error("Au moins un compte local doit rester présent.");
  }

  const normalizedConfig: RuntimeAuthConfig = {
    ...config,
    username: primaryUser.username,
    email: primaryUser.email,
    passwordHash: primaryUser.passwordHash,
    passwordSalt: primaryUser.passwordSalt,
    primaryUserId: primaryUser.id,
  };

  const filePath = getRuntimeAuthConfigPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return normalizedConfig;
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

  return writeNormalizedRuntimeAuthConfig(normalized);
}

export function deleteRuntimeAuthConfig() {
  const filePath = getRuntimeAuthConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function listRuntimeAuthUsers() {
  return readRuntimeAuthConfig()?.users ?? [];
}

export function findRuntimeAuthUserByUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return null;
  return listRuntimeAuthUsers().find((user) => user.username.toLowerCase() === normalized) ?? null;
}

export function findRuntimeAuthUserById(userId: string) {
  const normalized = userId.trim();
  if (!normalized) return null;
  return listRuntimeAuthUsers().find((user) => user.id === normalized) ?? null;
}

export function updateRuntimeAuthSessionSettings(input: RuntimeAuthSessionSettingsInput) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    sessionSecret: asNonEmptyString(input.sessionSecret) ?? current.sessionSecret,
    sessionTtlSeconds: asPositiveInt(input.sessionTtlSeconds, current.sessionTtlSeconds),
    secureCookie: typeof input.secureCookie === "boolean" ? input.secureCookie : current.secureCookie,
    updatedAt: new Date().toISOString(),
  });
}

export function addRuntimeAuthUser(input: RuntimeAuthUserCreateInput) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const username = normalizeLocalUsernameInput(input.username);
  if (!username) {
    throw new Error("Utilisateur invalide. Utilise 3-64 caractères alphanumériques, ., _ ou -.");
  }

  if (findRuntimeAuthUserByUsername(username)) {
    throw new Error("Un utilisateur local avec ce nom existe déjà.");
  }

  const now = new Date().toISOString();
  const nextUser: RuntimeAuthUser = {
    id: randomUUID(),
    username,
    email: input.email?.trim() ? input.email.trim().toLowerCase() : null,
    passwordHash: input.passwordHash,
    passwordSalt: input.passwordSalt,
    role: input.role ?? "operator",
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    sessionRevokedAt: null,
  };

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: [...current.users, nextUser],
    updatedAt: now,
  });
}

export function setRuntimeAuthPrimaryUser(userId: string) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const target = current.users.find((user) => user.id === userId);
  if (!target) {
    throw new Error("Utilisateur introuvable.");
  }

  if (!target.enabled) {
    throw new Error("Le compte principal doit rester actif.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    primaryUserId: target.id,
    updatedAt: new Date().toISOString(),
  });
}

export function setRuntimeAuthUserEnabled(userId: string, enabled: boolean) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const target = current.users.find((user) => user.id === userId);
  if (!target) {
    throw new Error("Utilisateur introuvable.");
  }

  const nextUsers = current.users.map((user) =>
    user.id === userId
      ? { ...user, enabled, updatedAt: new Date().toISOString() }
      : user,
  );

  const enabledUsers = nextUsers.filter((user) => user.enabled);
  if (enabledUsers.length === 0) {
    throw new Error("Au moins un compte local actif doit rester disponible.");
  }
  if (!nextUsers.some((user) => user.enabled && user.role === "admin")) {
    throw new Error("Au moins un compte local admin actif doit rester disponible.");
  }

  const nextPrimary =
    current.primaryUserId === userId && !enabled
      ? enabledUsers[0]?.id ?? current.primaryUserId
      : current.primaryUserId;

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    primaryUserId: nextPrimary,
    updatedAt: new Date().toISOString(),
  });
}

export function deleteRuntimeAuthUser(userId: string) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const nextUsers = current.users.filter((user) => user.id !== userId);
  if (nextUsers.length === current.users.length) {
    throw new Error("Utilisateur introuvable.");
  }
  if (nextUsers.length === 0) {
    throw new Error("Au moins un compte local doit rester présent.");
  }

  const enabledUsers = nextUsers.filter((user) => user.enabled);
  if (enabledUsers.length === 0) {
    throw new Error("Au moins un compte local actif doit rester disponible.");
  }
  if (!nextUsers.some((user) => user.enabled && user.role === "admin")) {
    throw new Error("Au moins un compte local admin actif doit rester disponible.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    primaryUserId:
      current.primaryUserId === userId
        ? enabledUsers[0]?.id ?? nextUsers[0]?.id ?? current.primaryUserId
        : current.primaryUserId,
    updatedAt: new Date().toISOString(),
  });
}

export function updateRuntimeAuthUserPassword(userId: string, passwordHash: string, passwordSalt: string) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const nextUsers = current.users.map((user) =>
    user.id === userId
      ? {
          ...user,
          passwordHash,
          passwordSalt,
          updatedAt: new Date().toISOString(),
          sessionRevokedAt: new Date().toISOString(),
        }
      : user,
  );

  if (!nextUsers.some((user) => user.id === userId)) {
    throw new Error("Utilisateur introuvable.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    updatedAt: new Date().toISOString(),
  });
}

export function revokeRuntimeAuthUserSessions(userId: string) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  let found = false;
  const now = new Date().toISOString();
  const nextUsers = current.users.map((user) => {
    if (user.id !== userId) return user;
    found = true;
    return {
      ...user,
      sessionRevokedAt: now,
      updatedAt: now,
    };
  });

  if (!found) {
    throw new Error("Utilisateur introuvable.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    updatedAt: now,
  });
}

export function revokeRuntimeAuthOtherSessions(userId: string, keepIssuedAtMs: number) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  if (!Number.isFinite(keepIssuedAtMs) || keepIssuedAtMs <= 0) {
    throw new Error("Session courante invalide.");
  }

  let found = false;
  const cutoff = new Date(keepIssuedAtMs).toISOString();
  const now = new Date().toISOString();
  const nextUsers = current.users.map((user) => {
    if (user.id !== userId) return user;
    found = true;
    return {
      ...user,
      sessionRevokedAt: cutoff,
      updatedAt: now,
    };
  });

  if (!found) {
    throw new Error("Utilisateur introuvable.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    updatedAt: now,
  });
}

export function updateRuntimeAuthUserRole(userId: string, role: RuntimeAuthUserRole) {
  const current = readRuntimeAuthConfig();
  if (!current) {
    throw new Error("Auth UI non configurée.");
  }

  const normalizedRole = normalizeRuntimeAuthUserRole(role);
  let found = false;
  const now = new Date().toISOString();
  const nextUsers = current.users.map((user) => {
    if (user.id !== userId) return user;
    found = true;
    return {
      ...user,
      role: normalizedRole,
      updatedAt: now,
    };
  });

  if (!found) {
    throw new Error("Utilisateur introuvable.");
  }

  if (!nextUsers.some((user) => user.enabled && user.role === "admin")) {
    throw new Error("Au moins un compte local admin actif doit rester disponible.");
  }

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    updatedAt: now,
  });
}

export function touchRuntimeAuthUserLastLogin(username: string) {
  const current = readRuntimeAuthConfig();
  if (!current) return null;

  let touched = false;
  const now = new Date().toISOString();
  const nextUsers = current.users.map((user) => {
    if (user.username.toLowerCase() !== username.trim().toLowerCase()) {
      return user;
    }
    touched = true;
    return {
      ...user,
      lastLoginAt: now,
      updatedAt: now,
    };
  });

  if (!touched) return current;

  return writeNormalizedRuntimeAuthConfig({
    ...current,
    users: nextUsers,
    updatedAt: now,
  });
}
