import "server-only";
import { createHash } from "node:crypto";
import { Agent, type Dispatcher } from "undici";
import {
  readRuntimeProxmoxConfig,
  type ProxmoxTlsMode,
} from "@/lib/proxmox/runtime-config";

export type ProxmoxConfig = {
  baseUrl: string;
  protocol: "https" | "http";
  host: string;
  port: number;
  tokenId: string;
  tokenSecret: string;
  tlsMode: ProxmoxTlsMode;
  allowInsecureTls: boolean;
  customCaCertPem: string | null;
};

const PROXMOX_CA_AGENTS = new Map<string, Agent>();

function getCaAgent(caPem: string) {
  const key = createHash("sha256").update(caPem).digest("hex");
  const existing = PROXMOX_CA_AGENTS.get(key);
  if (existing) return existing;

  const agent = new Agent({
    connect: {
      rejectUnauthorized: true,
      ca: caPem,
    },
  });
  PROXMOX_CA_AGENTS.set(key, agent);
  return agent;
}

export function getProxmoxConfigSource() {
  if (readRuntimeProxmoxConfig()) return "runtime" as const;
  return "none" as const;
}

export function getProxmoxConfig(): ProxmoxConfig | null {
  const runtimeConfig = readRuntimeProxmoxConfig();
  if (!runtimeConfig) return null;

  return {
    baseUrl: runtimeConfig.baseUrl,
    protocol: runtimeConfig.protocol,
    host: runtimeConfig.host,
    port: runtimeConfig.port,
    tokenId: runtimeConfig.tokenId,
    tokenSecret: runtimeConfig.tokenSecret,
    tlsMode: runtimeConfig.tlsMode,
    allowInsecureTls: runtimeConfig.allowInsecureTls,
    customCaCertPem: runtimeConfig.customCaCertPem,
  };
}

export function getProxmoxAuthHeaderValue(config: ProxmoxConfig) {
  return `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`;
}

export function applyProxmoxTlsMode(configOverride?: ProxmoxConfig | null) {
  const config = configOverride ?? getProxmoxConfig();
  if (!config) return;

  if (config.tlsMode === "insecure" || config.allowInsecureTls) {
    // Global Node.js switch: only for homelab self-signed mode.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    return;
  }

  // Strict verification when certificate is public-trusted or custom CA is provided.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
}

export function getProxmoxFetchDispatcher(config: ProxmoxConfig): Dispatcher | undefined {
  if (config.tlsMode !== "custom-ca" || !config.customCaCertPem) return undefined;
  return getCaAgent(config.customCaCertPem);
}

