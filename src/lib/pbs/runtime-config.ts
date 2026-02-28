import "server-only";
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

export type RuntimePbsConfig = {
  host: string;
  port: number;
  datastore: string;
  authId: string;
  secret: string;
  namespace: string | null;
  fingerprint: string | null;
  updatedAt: string;
};

type RuntimePbsConfigInput = {
  host?: unknown;
  port?: unknown;
  datastore?: unknown;
  authId?: unknown;
  secret?: unknown;
  secretCipher?: unknown;
  namespace?: unknown;
  fingerprint?: unknown;
};

function asNonEmptyString(value: unknown, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asPort(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }
  return null;
}

function normalizeHost(value: unknown) {
  const raw = asNonEmptyString(value, 255);
  if (!raw) return null;
  const host = raw.replace(/^\[|\]$/g, "").trim();
  if (!host || /[\s/]/.test(host)) return null;
  return host;
}

function normalizeDatastore(value: unknown) {
  const raw = asNonEmptyString(value, 120);
  if (!raw) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(raw)) return null;
  return raw;
}

function normalizeNamespace(value: unknown) {
  const raw = asNonEmptyString(value, 300);
  if (!raw) return null;
  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (!normalized) return null;
  if (!/^[a-zA-Z0-9._/-]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeFingerprint(value: unknown) {
  const raw = asNonEmptyString(value, 200);
  if (!raw) return null;
  return raw.replace(/\s+/g, "");
}

function getDefaultRuntimePbsConfigPath() {
  return path.join(process.cwd(), "data", "pbs-connection.json");
}

export function getRuntimePbsConfigPath() {
  const custom = process.env.PROXCENTER_PBS_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimePbsConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function normalizeRuntimePbsConfigInput(
  input: RuntimePbsConfigInput,
): RuntimePbsConfig | null {
  const host = normalizeHost(input.host);
  const port = asPort(input.port) ?? 8007;
  const datastore = normalizeDatastore(input.datastore);
  const authId = asNonEmptyString(input.authId, 180);
  const namespace = normalizeNamespace(input.namespace);
  const fingerprint = normalizeFingerprint(input.fingerprint);

  const secretInput = asNonEmptyString(input.secret, 4000);
  const secretCipher = asNonEmptyString(input.secretCipher, 6000);
  let secret = secretInput;

  if (!secret && secretCipher) {
    secret = openSecret(secretCipher);
  }

  if (!host || !datastore || !authId || !secret) {
    return null;
  }

  return {
    host,
    port,
    datastore,
    authId,
    secret,
    namespace,
    fingerprint,
    updatedAt: new Date().toISOString(),
  };
}

export function readRuntimePbsConfig(): RuntimePbsConfig | null {
  const filePath = getRuntimePbsConfigPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as RuntimePbsConfigInput & { updatedAt?: unknown };
    const normalized = normalizeRuntimePbsConfigInput(parsed);
    if (!normalized) return null;

    if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
      normalized.updatedAt = parsed.updatedAt;
    }

    return normalized;
  } catch {
    return null;
  }
}

export function writeRuntimePbsConfig(input: RuntimePbsConfigInput) {
  const normalized = normalizeRuntimePbsConfigInput(input);
  if (!normalized) {
    throw new Error("Invalid PBS connection config.");
  }

  const filePath = getRuntimePbsConfigPath();
  ensureParentDirectory(filePath);
  const payload = {
    host: normalized.host,
    port: normalized.port,
    datastore: normalized.datastore,
    authId: normalized.authId,
    secretCipher: sealSecret(normalized.secret),
    namespace: normalized.namespace,
    fingerprint: normalized.fingerprint,
    updatedAt: normalized.updatedAt,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return normalized;
}

export function deleteRuntimePbsConfig() {
  const filePath = getRuntimePbsConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function buildPbsRepository(config: RuntimePbsConfig) {
  return `${config.authId}@${config.host}:${config.port}:${config.datastore}`;
}
