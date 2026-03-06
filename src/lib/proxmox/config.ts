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
const PROXMOX_INSECURE_AGENT = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

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

export function getProxmoxFetchDispatcher(config: ProxmoxConfig): Dispatcher | undefined {
  if (config.protocol !== "https") return undefined;

  if (config.tlsMode === "insecure" || config.allowInsecureTls) {
    return PROXMOX_INSECURE_AGENT;
  }

  if (config.tlsMode === "custom-ca" && config.customCaCertPem) {
    return getCaAgent(config.customCaCertPem);
  }

  return undefined;
}
