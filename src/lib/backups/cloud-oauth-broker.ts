import "server-only";

import { createHash, randomBytes } from "node:crypto";
import {
  consumePersistedOauthState,
  issuePersistedOauthState,
} from "@/lib/backups/oauth-state-store";

export type CloudOauthProvider = "onedrive" | "gdrive";
export type CloudOauthMode = "central" | "local";

type BrokerStateBase = {
  id: string;
  provider: CloudOauthProvider;
  targetOrigin: string;
  createdAt: number;
  expiresAt: number;
};

type OneDriveBrokerState = BrokerStateBase & {
  provider: "onedrive";
  clientId: string;
  clientSecret: string | null;
  authority: string;
  redirectUri: string;
  codeVerifier: string;
};

type GoogleBrokerState = BrokerStateBase & {
  provider: "gdrive";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type BrokerState = OneDriveBrokerState | GoogleBrokerState;

const STATE_TTL_MS = 10 * 60_000;
const BROKER_ONEDRIVE_STATE_KIND = "broker-onedrive";
const BROKER_GDRIVE_STATE_KIND = "broker-gdrive";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function asNonEmptyString(value: string | null | undefined, maxLength = 600) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = asNonEmptyString(value, 500);
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return trimTrailingSlash(url.origin);
  } catch {
    return null;
  }
}

function parseOriginList(value: string | null | undefined) {
  if (!value) return [];
  const origins = new Set<string>();
  for (const item of value.split(/[\s,;]+/)) {
    const normalized = normalizeOrigin(item);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function toBase64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeCodeVerifier() {
  return toBase64Url(randomBytes(48));
}

function makeCodeChallenge(codeVerifier: string) {
  return toBase64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export function getCloudOauthMode(): CloudOauthMode {
  return process.env.PROXMOXCENTER_CLOUD_OAUTH_MODE?.trim().toLowerCase() === "central" ? "central" : "local";
}

export function getCentralCloudOauthBrokerOrigin() {
  return normalizeOrigin(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ORIGIN);
}

export function getCloudOauthBrokerAllowedOrigins() {
  return [
    ...new Set([
      ...parseOriginList(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS),
      ...parseOriginList(process.env.PROXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS),
    ]),
  ];
}

export function getCloudOauthBrokerAllowlistStatus() {
  const allowedOrigins = getCloudOauthBrokerAllowedOrigins();
  return {
    configured: allowedOrigins.length > 0,
    allowedOrigins,
  };
}

export function getCloudOauthBrokerStatus() {
  const mode = getCloudOauthMode();
  const brokerOrigin = getCentralCloudOauthBrokerOrigin();
  return {
    mode,
    brokerOrigin,
    brokerAvailable: mode === "central" ? Boolean(brokerOrigin) : false,
  };
}

export function getCentralCloudOauthProviderStatus() {
  const broker = getCloudOauthBrokerStatus();
  if (broker.mode !== "central") {
    return {
      mode: broker.mode,
      brokerOrigin: broker.brokerOrigin,
      onedrive: false,
      gdrive: false,
    };
  }
  return {
    mode: broker.mode,
    brokerOrigin: broker.brokerOrigin,
    onedrive: broker.brokerAvailable,
    gdrive: broker.brokerAvailable,
  };
}

export function getBrokerClientConfig(provider: CloudOauthProvider) {
  if (provider === "onedrive") {
    const clientId = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_ID, 200);
    const clientSecret = asNonEmptyString(
      process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_CLIENT_SECRET,
      3000,
    );
    const authority = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_ONEDRIVE_AUTHORITY, 80) ?? "consumers";
    return {
      clientId,
      clientSecret,
      authority,
      ready: Boolean(clientId),
    };
  }

  const clientId = asNonEmptyString(process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_ID, 200);
  const clientSecret = asNonEmptyString(
    process.env.PROXMOXCENTER_CLOUD_OAUTH_BROKER_GDRIVE_CLIENT_SECRET,
    3000,
  );
  return {
    clientId,
    clientSecret,
    authority: null,
    ready: Boolean(clientId && clientSecret),
  };
}

export function issueBrokerOneDriveOauthState(input: {
  clientId: string;
  clientSecret?: string | null;
  authority: string;
  redirectUri: string;
  targetOrigin: string;
}) {
  const codeVerifier = makeCodeVerifier();
  const state = issuePersistedOauthState({
    kind: BROKER_ONEDRIVE_STATE_KIND,
    ttlMs: STATE_TTL_MS,
    payload: {
      provider: "onedrive" as const,
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? null,
      authority: input.authority,
      redirectUri: input.redirectUri,
      targetOrigin: input.targetOrigin,
      codeVerifier,
    },
  });
  return {
    id: state.id,
    codeChallenge: makeCodeChallenge(codeVerifier),
  };
}

export function issueBrokerGoogleOauthState(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  targetOrigin: string;
}) {
  return issuePersistedOauthState({
    kind: BROKER_GDRIVE_STATE_KIND,
    ttlMs: STATE_TTL_MS,
    payload: {
      provider: "gdrive" as const,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      redirectUri: input.redirectUri,
      targetOrigin: input.targetOrigin,
    },
  });
}

export function consumeBrokerOauthState(id: string) {
  return (
    consumePersistedOauthState<Omit<OneDriveBrokerState, "id" | "createdAt" | "expiresAt">>({
      kind: BROKER_ONEDRIVE_STATE_KIND,
      id,
    }) ??
    consumePersistedOauthState<Omit<GoogleBrokerState, "id" | "createdAt" | "expiresAt">>({
      kind: BROKER_GDRIVE_STATE_KIND,
      id,
    })
  ) as BrokerState | null;
}

export function parseBrokerTargetOrigin(value: string | null | undefined) {
  return normalizeOrigin(value);
}

export function isAllowedBrokerTargetOrigin(value: string | null | undefined) {
  const origin = normalizeOrigin(value);
  if (!origin) return false;
  return getCloudOauthBrokerAllowedOrigins().includes(origin);
}
