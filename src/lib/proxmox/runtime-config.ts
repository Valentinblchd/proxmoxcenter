import "server-only";
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

export type ProxmoxProtocol = "https" | "http";
export type ProxmoxTlsMode = "strict" | "insecure" | "custom-ca";

export type RuntimeProxmoxLdapConfig = {
  enabled: boolean;
  serverUrl: string;
  baseDn: string;
  bindDn: string;
  bindPasswordCipher: string | null;
  userFilter: string;
  realm: string;
  startTls: boolean;
  allowInsecureTls: boolean;
};

export type RuntimeProxmoxConfig = {
  baseUrl: string;
  protocol: ProxmoxProtocol;
  host: string;
  port: number;
  tokenId: string;
  tokenSecret: string;
  tlsMode: ProxmoxTlsMode;
  allowInsecureTls: boolean;
  customCaCertPem: string | null;
  ldap: RuntimeProxmoxLdapConfig;
  updatedAt: string;
};

type LdapConfigInput = {
  enabled?: unknown;
  serverUrl?: unknown;
  baseDn?: unknown;
  bindDn?: unknown;
  bindPassword?: unknown;
  bindPasswordCipher?: unknown;
  userFilter?: unknown;
  realm?: unknown;
  startTls?: unknown;
  allowInsecureTls?: unknown;
};

type ProxmoxConfigInput = {
  baseUrl?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  tokenId?: unknown;
  tokenSecret?: unknown;
  tlsMode?: unknown;
  allowInsecureTls?: unknown;
  customCaCertPem?: unknown;
  ldap?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function asProtocol(value: unknown): ProxmoxProtocol | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "https" || normalized === "http") return normalized;
  return null;
}

function asTlsMode(value: unknown): ProxmoxTlsMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "strict" || normalized === "insecure" || normalized === "custom-ca") {
    return normalized;
  }
  return null;
}

function normalizeHost(value: unknown) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const host = raw.replace(/^\[|\]$/g, "").trim();
  if (!host) return null;
  if (/[\s/]/.test(host)) return null;
  return host;
}

function normalizeBaseUrl(value: unknown) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function formatHostForUrl(host: string) {
  return host.includes(":") ? `[${host}]` : host;
}

function makeBaseUrl(protocol: ProxmoxProtocol, host: string, port: number) {
  return `${protocol}://${formatHostForUrl(host)}:${port}`;
}

function getDefaultPort(protocol: ProxmoxProtocol) {
  if (protocol === "https") return 443;
  return 80;
}

type NormalizedEndpoint = {
  protocol: ProxmoxProtocol;
  host: string;
  port: number;
  baseUrl: string;
};

function normalizeEndpoint(input: ProxmoxConfigInput): NormalizedEndpoint | null {
  const protocolInput = asProtocol(input.protocol);
  const hostInput = normalizeHost(input.host);
  const portInput = asPort(input.port);

  if (hostInput) {
    const protocol = protocolInput ?? "https";
    const port = portInput ?? (protocol === "https" ? 8006 : 80);
    return {
      protocol,
      host: hostInput,
      port,
      baseUrl: makeBaseUrl(protocol, hostInput, port),
    };
  }

  const parsedBase = normalizeBaseUrl(input.baseUrl);
  if (!parsedBase) return null;

  const protocol = parsedBase.protocol === "http:" ? "http" : "https";
  const host = parsedBase.hostname;
  const port = parsedBase.port ? Number.parseInt(parsedBase.port, 10) : getDefaultPort(protocol);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;

  return {
    protocol,
    host,
    port,
    baseUrl: makeBaseUrl(protocol, host, port),
  };
}

function normalizeCustomCaCert(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length > 128_000) return null;
  if (!raw.includes("BEGIN CERTIFICATE")) return null;
  return raw;
}

function normalizeLdapConfig(input: unknown): RuntimeProxmoxLdapConfig | null {
  const record = (input ?? {}) as LdapConfigInput;
  const enabled = asBoolean(record.enabled, false);
  const serverUrl = asNonEmptyString(record.serverUrl) ?? "";
  const baseDn = asNonEmptyString(record.baseDn) ?? "";
  const bindDn = asNonEmptyString(record.bindDn) ?? "";
  const userFilter = asNonEmptyString(record.userFilter) ?? "(uid={username})";
  const realm = asNonEmptyString(record.realm) ?? "ldap";
  const startTls = asBoolean(record.startTls, false);
  const allowInsecureTls = asBoolean(record.allowInsecureTls, false);
  const bindPassword = asNonEmptyString(record.bindPassword);
  const bindPasswordCipher = asNonEmptyString(record.bindPasswordCipher);

  let sealedPassword: string | null = bindPasswordCipher ?? null;
  if (bindPassword) {
    try {
      sealedPassword = sealSecret(bindPassword);
    } catch {
      return null;
    }
  }

  if (enabled) {
    if (!serverUrl || !baseDn || !userFilter || !realm) return null;
    try {
      const parsed = new URL(serverUrl);
      if (!["ldap:", "ldaps:"].includes(parsed.protocol)) return null;
    } catch {
      return null;
    }
  }

  return {
    enabled,
    serverUrl,
    baseDn,
    bindDn,
    bindPasswordCipher: sealedPassword,
    userFilter,
    realm,
    startTls,
    allowInsecureTls,
  };
}

function getDefaultRuntimeConfigPath() {
  return path.join(process.cwd(), "data", "proxmox-connection.json");
}

export function getRuntimeProxmoxConfigPath() {
  const custom = process.env.PROXCENTER_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimeConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function normalizeRuntimeProxmoxConfigInput(
  input: ProxmoxConfigInput,
): RuntimeProxmoxConfig | null {
  const endpoint = normalizeEndpoint(input);
  const tokenId = asNonEmptyString(input.tokenId);
  const tokenSecret = asNonEmptyString(input.tokenSecret);
  const customCaCertPem = normalizeCustomCaCert(input.customCaCertPem);
  const tlsModeRaw = asTlsMode(input.tlsMode);
  const allowInsecureTlsInput = asBoolean(input.allowInsecureTls, false);
  const tlsMode =
    tlsModeRaw ??
    (allowInsecureTlsInput ? "insecure" : customCaCertPem ? "custom-ca" : "strict");
  const allowInsecureTls = tlsMode === "insecure";

  if (!endpoint || !tokenId || !tokenSecret) {
    return null;
  }

  if (tlsMode === "custom-ca" && !customCaCertPem) {
    return null;
  }

  const ldap = normalizeLdapConfig(input.ldap);
  if (!ldap) return null;

  return {
    baseUrl: endpoint.baseUrl,
    protocol: endpoint.protocol,
    host: endpoint.host,
    port: endpoint.port,
    tokenId,
    tokenSecret,
    tlsMode,
    allowInsecureTls,
    customCaCertPem: tlsMode === "custom-ca" ? customCaCertPem : null,
    ldap,
    updatedAt: new Date().toISOString(),
  };
}

export function readRuntimeProxmoxConfig(): RuntimeProxmoxConfig | null {
  const filePath = getRuntimeProxmoxConfigPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as ProxmoxConfigInput & { updatedAt?: unknown };
    const normalized = normalizeRuntimeProxmoxConfigInput(parsed);
    if (!normalized) return null;

    if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
      normalized.updatedAt = parsed.updatedAt;
    }

    return normalized;
  } catch {
    return null;
  }
}

export function writeRuntimeProxmoxConfig(input: ProxmoxConfigInput) {
  const normalized = normalizeRuntimeProxmoxConfigInput(input);
  if (!normalized) {
    throw new Error("Invalid Proxmox connection config.");
  }

  const filePath = getRuntimeProxmoxConfigPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function deleteRuntimeProxmoxConfig() {
  const filePath = getRuntimeProxmoxConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, secret.length - 4))}${secret.slice(-4)}`;
}

export function readRuntimeLdapBindPassword(config: RuntimeProxmoxConfig | null) {
  const cipher = config?.ldap.bindPasswordCipher;
  if (!cipher) return null;
  return openSecret(cipher);
}
