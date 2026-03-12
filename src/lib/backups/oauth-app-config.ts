import "server-only";

import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

export type CloudOauthProvider = "onedrive" | "gdrive";

export type RuntimeOneDriveOauthAppConfig = {
  clientId: string;
  clientSecret: string | null;
  authority: string;
  updatedAt: string;
  source: "ui" | "local-file";
  secretExpiresAt: string | null;
};

export type RuntimeGoogleOauthAppConfig = {
  clientId: string;
  clientSecret: string;
  updatedAt: string;
  source: "ui" | "local-file";
  secretExpiresAt: string | null;
};

export type RuntimeCloudOauthAppConfig = {
  onedrive: RuntimeOneDriveOauthAppConfig | null;
  gdrive: RuntimeGoogleOauthAppConfig | null;
};

type LocalSecretFilePayload = {
  onedrive?: {
    clientId?: unknown;
    clientSecret?: unknown;
    authority?: unknown;
    updatedAt?: unknown;
    secretExpiresAt?: unknown;
  } | null;
  gdrive?: {
    clientId?: unknown;
    clientSecret?: unknown;
    updatedAt?: unknown;
    secretExpiresAt?: unknown;
  } | null;
};

type FilePayload = {
  onedrive?: {
    clientId?: unknown;
    clientSecretCipher?: unknown;
    authority?: unknown;
    updatedAt?: unknown;
    secretExpiresAt?: unknown;
  } | null;
  gdrive?: {
    clientId?: unknown;
    clientSecretCipher?: unknown;
    updatedAt?: unknown;
    secretExpiresAt?: unknown;
  } | null;
};

type OneDriveInput = {
  clientId?: unknown;
  clientSecret?: unknown;
  authority?: unknown;
};

type GoogleInput = {
  clientId?: unknown;
  clientSecret?: unknown;
};

export type CloudOauthProviderSource = "ui" | "local-file" | null;
export type CloudOauthSecretExpiryState = "ok" | "expiring" | "expired" | "unknown";

export type PublicCloudOauthProviderStatus = {
  configured: boolean;
  clientIdMasked: string | null;
  updatedAt: string | null;
  source: CloudOauthProviderSource;
  secretExpiresAt: string | null;
  secretExpiryState: CloudOauthSecretExpiryState;
  daysUntilSecretExpiry: number | null;
  authority?: string;
};

function asNonEmptyString(value: unknown, maxLength = 600) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function asIsoDateOnly(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
    ) {
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  const frenchDateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (frenchDateMatch) {
    const [, day, month, year] = frenchDateMatch;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
    ) {
      return `${year}-${month}-${day}`;
    }
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeAuthority(value: unknown) {
  const trimmed = asNonEmptyString(value, 80);
  if (!trimmed) return "consumers";
  if (!/^[a-z0-9._-]+$/i.test(trimmed)) return "consumers";
  return trimmed;
}

function getPath() {
  return path.join(process.cwd(), "data", "cloud-oauth-apps.json");
}

function getLocalSecretPath() {
  const custom = process.env.PROXCENTER_CLOUD_OAUTH_SECRETS_PATH?.trim();
  return custom || path.join(process.cwd(), "data", "cloud-oauth-secrets.json");
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function maskClientId(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function calculateSecretExpiryStatus(secretExpiresAt: string | null) {
  if (!secretExpiresAt) {
    return {
      secretExpiryState: "unknown" as const,
      daysUntilSecretExpiry: null,
    };
  }

  const [year, month, day] = secretExpiresAt.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return {
      secretExpiryState: "unknown" as const,
      daysUntilSecretExpiry: null,
    };
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const expiryUtc = Date.UTC(year, month - 1, day);
  const daysUntilSecretExpiry = Math.round((expiryUtc - todayUtc) / 86_400_000);

  if (daysUntilSecretExpiry < 0) {
    return {
      secretExpiryState: "expired" as const,
      daysUntilSecretExpiry,
    };
  }

  if (daysUntilSecretExpiry <= 30) {
    return {
      secretExpiryState: "expiring" as const,
      daysUntilSecretExpiry,
    };
  }

  return {
    secretExpiryState: "ok" as const,
    daysUntilSecretExpiry,
  };
}

function readStoredRuntimeCloudOauthAppConfig(now = new Date().toISOString()): RuntimeCloudOauthAppConfig {
  const filePath = getPath();
  if (!fs.existsSync(filePath)) {
    return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
    const parsed = JSON.parse(raw) as FilePayload;

    const oneDrive =
      parsed.onedrive && typeof parsed.onedrive === "object"
        ? (() => {
            const clientId = asNonEmptyString(parsed.onedrive?.clientId, 200);
            if (!clientId) return null;
            const secretCipher = asNonEmptyString(parsed.onedrive?.clientSecretCipher, 4000);
            return {
              clientId,
              clientSecret: secretCipher ? openSecret(secretCipher) : null,
              authority: normalizeAuthority(parsed.onedrive?.authority),
              updatedAt: asIsoDate(parsed.onedrive?.updatedAt, now),
              source: "ui",
              secretExpiresAt: asIsoDateOnly(parsed.onedrive?.secretExpiresAt),
            } satisfies RuntimeOneDriveOauthAppConfig;
          })()
        : null;

    const google =
      parsed.gdrive && typeof parsed.gdrive === "object"
        ? (() => {
            const clientId = asNonEmptyString(parsed.gdrive?.clientId, 200);
            const secretCipher = asNonEmptyString(parsed.gdrive?.clientSecretCipher, 4000);
            const clientSecret = secretCipher ? openSecret(secretCipher) : null;
            if (!clientId || !clientSecret) return null;
            return {
              clientId,
              clientSecret,
              updatedAt: asIsoDate(parsed.gdrive?.updatedAt, now),
              source: "ui",
              secretExpiresAt: asIsoDateOnly(parsed.gdrive?.secretExpiresAt),
            } satisfies RuntimeGoogleOauthAppConfig;
          })()
        : null;

    return {
      onedrive: oneDrive,
      gdrive: google,
    } satisfies RuntimeCloudOauthAppConfig;
  } catch {
    return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
  }
}

function readLocalSecretRuntimeCloudOauthAppConfig(now = new Date().toISOString()): RuntimeCloudOauthAppConfig {
  const localSecretPath = getLocalSecretPath();
  if (!fs.existsSync(localSecretPath)) {
    return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
  }

  try {
    const raw = fs.readFileSync(localSecretPath, "utf8");
    if (!raw.trim()) return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
    const parsed = JSON.parse(raw) as LocalSecretFilePayload;

    const oneDrive =
      parsed.onedrive && typeof parsed.onedrive === "object"
        ? (() => {
            const clientId = asNonEmptyString(parsed.onedrive?.clientId, 200);
            if (!clientId) return null;
            return {
              clientId,
              clientSecret: asNonEmptyString(parsed.onedrive?.clientSecret, 3000),
              authority: normalizeAuthority(parsed.onedrive?.authority),
              updatedAt: asIsoDate(parsed.onedrive?.updatedAt, now),
              source: "local-file",
              secretExpiresAt: asIsoDateOnly(parsed.onedrive?.secretExpiresAt),
            } satisfies RuntimeOneDriveOauthAppConfig;
          })()
        : null;

    const google =
      parsed.gdrive && typeof parsed.gdrive === "object"
        ? (() => {
            const clientId = asNonEmptyString(parsed.gdrive?.clientId, 200);
            const clientSecret = asNonEmptyString(parsed.gdrive?.clientSecret, 3000);
            if (!clientId || !clientSecret) return null;
            return {
              clientId,
              clientSecret,
              updatedAt: asIsoDate(parsed.gdrive?.updatedAt, now),
              source: "local-file",
              secretExpiresAt: asIsoDateOnly(parsed.gdrive?.secretExpiresAt),
            } satisfies RuntimeGoogleOauthAppConfig;
          })()
        : null;

    return {
      onedrive: oneDrive,
      gdrive: google,
    } satisfies RuntimeCloudOauthAppConfig;
  } catch {
    return { onedrive: null, gdrive: null } satisfies RuntimeCloudOauthAppConfig;
  }
}

export function readRuntimeCloudOauthAppConfig(): RuntimeCloudOauthAppConfig {
  const now = new Date().toISOString();
  const storedConfig = readStoredRuntimeCloudOauthAppConfig(now);
  const localSecretConfig = readLocalSecretRuntimeCloudOauthAppConfig(now);
  return {
    onedrive: localSecretConfig.onedrive ?? storedConfig.onedrive,
    gdrive: localSecretConfig.gdrive ?? storedConfig.gdrive,
  };
}

export function writeRuntimeCloudOauthAppConfig(input: {
  provider: CloudOauthProvider;
  onedrive?: OneDriveInput;
  gdrive?: GoogleInput;
}) {
  const current = readStoredRuntimeCloudOauthAppConfig();
  const filePath = getPath();
  const now = new Date().toISOString();

  const next: RuntimeCloudOauthAppConfig = {
    onedrive: current.onedrive,
    gdrive: current.gdrive,
  };

  if (input.provider === "onedrive") {
    const clientId = asNonEmptyString(input.onedrive?.clientId, 200);
    if (!clientId) {
      throw new Error("Client ID OneDrive requis.");
    }
    next.onedrive = {
      clientId,
      clientSecret: asNonEmptyString(input.onedrive?.clientSecret, 3000),
      authority: normalizeAuthority(input.onedrive?.authority),
      updatedAt: now,
      source: "ui",
      secretExpiresAt: current.onedrive?.secretExpiresAt ?? null,
    };
  }

  if (input.provider === "gdrive") {
    const clientId = asNonEmptyString(input.gdrive?.clientId, 200);
    const clientSecret = asNonEmptyString(input.gdrive?.clientSecret, 3000);
    if (!clientId || !clientSecret) {
      throw new Error("Client ID et Client Secret Google requis.");
    }
    next.gdrive = {
      clientId,
      clientSecret,
      updatedAt: now,
      source: "ui",
      secretExpiresAt: current.gdrive?.secretExpiresAt ?? null,
    };
  }

  ensureParentDirectory(filePath);
  const payload = {
    onedrive: next.onedrive
      ? {
          clientId: next.onedrive.clientId,
          clientSecretCipher: next.onedrive.clientSecret ? sealSecret(next.onedrive.clientSecret) : null,
          authority: next.onedrive.authority,
          updatedAt: next.onedrive.updatedAt,
          secretExpiresAt: next.onedrive.secretExpiresAt,
        }
      : null,
    gdrive: next.gdrive
      ? {
          clientId: next.gdrive.clientId,
          clientSecretCipher: sealSecret(next.gdrive.clientSecret),
          updatedAt: next.gdrive.updatedAt,
          secretExpiresAt: next.gdrive.secretExpiresAt,
        }
      : null,
  } satisfies FilePayload;

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return next;
}

export function clearRuntimeCloudOauthAppConfig(provider: CloudOauthProvider) {
  const current = readStoredRuntimeCloudOauthAppConfig();
  const next: RuntimeCloudOauthAppConfig = {
    onedrive: provider === "onedrive" ? null : current.onedrive,
    gdrive: provider === "gdrive" ? null : current.gdrive,
  };
  const filePath = getPath();
  ensureParentDirectory(filePath);
  const payload = {
    onedrive: next.onedrive
      ? {
          clientId: next.onedrive.clientId,
          clientSecretCipher: next.onedrive.clientSecret ? sealSecret(next.onedrive.clientSecret) : null,
          authority: next.onedrive.authority,
          updatedAt: next.onedrive.updatedAt,
          secretExpiresAt: next.onedrive.secretExpiresAt,
        }
      : null,
    gdrive: next.gdrive
      ? {
          clientId: next.gdrive.clientId,
          clientSecretCipher: sealSecret(next.gdrive.clientSecret),
          updatedAt: next.gdrive.updatedAt,
          secretExpiresAt: next.gdrive.secretExpiresAt,
        }
      : null,
  } satisfies FilePayload;
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function getPublicCloudOauthAppStatus() {
  const config = readRuntimeCloudOauthAppConfig();
  return {
    onedrive: {
      configured: Boolean(config.onedrive?.clientId),
      clientIdMasked: maskClientId(config.onedrive?.clientId),
      authority: config.onedrive?.authority ?? "consumers",
      updatedAt: config.onedrive?.updatedAt ?? null,
      source: config.onedrive?.source ?? null,
      secretExpiresAt: config.onedrive?.secretExpiresAt ?? null,
      ...calculateSecretExpiryStatus(config.onedrive?.secretExpiresAt ?? null),
    },
    gdrive: {
      configured: Boolean(config.gdrive?.clientId && config.gdrive?.clientSecret),
      clientIdMasked: maskClientId(config.gdrive?.clientId),
      updatedAt: config.gdrive?.updatedAt ?? null,
      source: config.gdrive?.source ?? null,
      secretExpiresAt: config.gdrive?.secretExpiresAt ?? null,
      ...calculateSecretExpiryStatus(config.gdrive?.secretExpiresAt ?? null),
    },
  } satisfies {
    onedrive: PublicCloudOauthProviderStatus;
    gdrive: PublicCloudOauthProviderStatus;
  };
}

export function getEffectiveCloudOauthCredentials(
  provider: CloudOauthProvider,
  settings: Record<string, string>,
  secrets: Record<string, string>,
) {
  const globalConfig = readRuntimeCloudOauthAppConfig();

  if (provider === "onedrive") {
    const clientId = globalConfig.onedrive?.clientId ?? settings.clientid ?? "";
    const clientSecret = globalConfig.onedrive?.clientSecret ?? secrets.clientsecret ?? "";
    const authority =
      globalConfig.onedrive?.authority ?? settings.authority ?? settings.tenantid ?? "consumers";
    return {
      settings: {
        ...settings,
        clientid: clientId,
        authority,
      },
      secrets: {
        ...secrets,
        ...(clientSecret ? { clientsecret: clientSecret } : {}),
      },
    };
  }

  const clientId = globalConfig.gdrive?.clientId ?? settings.clientid ?? "";
  const clientSecret = globalConfig.gdrive?.clientSecret ?? secrets.clientsecret ?? "";
  return {
    settings: {
      ...settings,
      clientid: clientId,
    },
    secrets: {
      ...secrets,
      ...(clientSecret ? { clientsecret: clientSecret } : {}),
    },
  };
}
