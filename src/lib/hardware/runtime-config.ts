import "server-only";
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

export type HardwareMonitorProtocol = "https" | "http";
export type HardwareMonitorTlsMode = "strict" | "insecure" | "custom-ca";

export type RuntimeHardwareMonitorConfig = {
  enabled: boolean;
  nodeName: string | null;
  label: string | null;
  baseUrl: string;
  protocol: HardwareMonitorProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  tlsMode: HardwareMonitorTlsMode;
  allowInsecureTls: boolean;
  customCaCertPem: string | null;
  updatedAt: string;
};

type RuntimeHardwareMonitorConfigInput = {
  enabled?: unknown;
  nodeName?: unknown;
  label?: unknown;
  baseUrl?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  passwordCipher?: unknown;
  tlsMode?: unknown;
  allowInsecureTls?: unknown;
  customCaCertPem?: unknown;
};

function asNonEmptyString(value: unknown, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
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

function asProtocol(value: unknown): HardwareMonitorProtocol | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "https" || normalized === "http") return normalized;
  return null;
}

function asTlsMode(value: unknown): HardwareMonitorTlsMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "strict" || normalized === "insecure" || normalized === "custom-ca") {
    return normalized;
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

function normalizeNodeName(value: unknown) {
  const raw = asNonEmptyString(value, 120);
  if (!raw) return null;
  return raw;
}

function normalizeLabel(value: unknown) {
  return asNonEmptyString(value, 120);
}

function normalizeCustomCaCert(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length > 128_000) return null;
  if (!raw.includes("BEGIN CERTIFICATE")) return null;
  return raw;
}

function normalizeEndpoint(input: RuntimeHardwareMonitorConfigInput) {
  const protocolInput = asProtocol(input.protocol);
  const hostInput = normalizeHost(input.host);
  const portInput = asPort(input.port);

  if (hostInput) {
    const protocol = protocolInput ?? "https";
    const port = portInput ?? (protocol === "https" ? 443 : 80);
    return {
      protocol,
      host: hostInput,
      port,
      baseUrl: `${protocol}://${hostInput.includes(":") ? `[${hostInput}]` : hostInput}:${port}`,
    };
  }

  const baseUrlRaw = asNonEmptyString(input.baseUrl, 1000);
  if (!baseUrlRaw) return null;

  try {
    const parsed = new URL(baseUrlRaw);
    const protocol: HardwareMonitorProtocol | null =
      parsed.protocol === "http:" ? "http" : parsed.protocol === "https:" ? "https" : null;
    if (!protocol || !parsed.hostname) return null;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : protocol === "https" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      protocol,
      host: parsed.hostname,
      port,
      baseUrl: `${protocol}://${parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname}:${port}`,
    };
  } catch {
    return null;
  }
}

function getDefaultRuntimeHardwareMonitorConfigPath() {
  return path.join(process.cwd(), "data", "hardware-monitor.json");
}

export function getRuntimeHardwareMonitorConfigPath() {
  const custom = process.env.PROXCENTER_HARDWARE_MONITOR_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimeHardwareMonitorConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function normalizeRuntimeHardwareMonitorConfigInput(
  input: RuntimeHardwareMonitorConfigInput,
): RuntimeHardwareMonitorConfig | null {
  const enabled = asBoolean(input.enabled, true);
  const endpoint = normalizeEndpoint(input);
  const username = asNonEmptyString(input.username, 180);
  const passwordInput = asNonEmptyString(input.password, 4000);
  const passwordCipher = asNonEmptyString(input.passwordCipher, 6000);
  const password = passwordInput ?? (passwordCipher ? openSecret(passwordCipher) : null);
  const tlsModeInput = asTlsMode(input.tlsMode);
  const customCaCertPem = normalizeCustomCaCert(input.customCaCertPem);
  const allowInsecureTlsInput = asBoolean(input.allowInsecureTls, false);
  const tlsMode =
    tlsModeInput ??
    (allowInsecureTlsInput ? "insecure" : customCaCertPem ? "custom-ca" : "strict");
  const allowInsecureTls = tlsMode === "insecure";

  if (!endpoint || !username || !password) {
    return null;
  }

  if (tlsMode === "custom-ca" && !customCaCertPem) {
    return null;
  }

  return {
    enabled,
    nodeName: normalizeNodeName(input.nodeName),
    label: normalizeLabel(input.label),
    baseUrl: endpoint.baseUrl,
    protocol: endpoint.protocol,
    host: endpoint.host,
    port: endpoint.port,
    username,
    password,
    tlsMode,
    allowInsecureTls,
    customCaCertPem: tlsMode === "custom-ca" ? customCaCertPem : null,
    updatedAt: new Date().toISOString(),
  };
}

export function readRuntimeHardwareMonitorConfig() {
  const filePath = getRuntimeHardwareMonitorConfigPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as RuntimeHardwareMonitorConfigInput & { updatedAt?: unknown };
    const normalized = normalizeRuntimeHardwareMonitorConfigInput(parsed);
    if (!normalized) return null;
    if (typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()) {
      normalized.updatedAt = parsed.updatedAt;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function writeRuntimeHardwareMonitorConfig(input: RuntimeHardwareMonitorConfigInput) {
  const normalized = normalizeRuntimeHardwareMonitorConfigInput(input);
  if (!normalized) {
    throw new Error("Invalid hardware monitor config.");
  }

  const filePath = getRuntimeHardwareMonitorConfigPath();
  ensureParentDirectory(filePath);
  const payload = {
    enabled: normalized.enabled,
    nodeName: normalized.nodeName,
    label: normalized.label,
    baseUrl: normalized.baseUrl,
    protocol: normalized.protocol,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    passwordCipher: sealSecret(normalized.password),
    tlsMode: normalized.tlsMode,
    allowInsecureTls: normalized.allowInsecureTls,
    customCaCertPem: normalized.customCaCertPem,
    updatedAt: normalized.updatedAt,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return normalized;
}

export function deleteRuntimeHardwareMonitorConfig() {
  const filePath = getRuntimeHardwareMonitorConfigPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function maskHardwareMonitorSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, secret.length - 4))}${secret.slice(-4)}`;
}
