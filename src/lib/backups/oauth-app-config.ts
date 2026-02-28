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
};

export type RuntimeGoogleOauthAppConfig = {
  clientId: string;
  clientSecret: string;
  updatedAt: string;
};

export type RuntimeCloudOauthAppConfig = {
  onedrive: RuntimeOneDriveOauthAppConfig | null;
  gdrive: RuntimeGoogleOauthAppConfig | null;
};

type FilePayload = {
  onedrive?: {
    clientId?: unknown;
    clientSecretCipher?: unknown;
    authority?: unknown;
    updatedAt?: unknown;
  } | null;
  gdrive?: {
    clientId?: unknown;
    clientSecretCipher?: unknown;
    updatedAt?: unknown;
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

function normalizeAuthority(value: unknown) {
  const trimmed = asNonEmptyString(value, 80);
  if (!trimmed) return "consumers";
  if (!/^[a-z0-9._-]+$/i.test(trimmed)) return "consumers";
  return trimmed;
}

function getPath() {
  return path.join(process.cwd(), "data", "cloud-oauth-apps.json");
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function maskClientId(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function readRuntimeCloudOauthAppConfig(): RuntimeCloudOauthAppConfig {
  const filePath = getPath();
  if (!fs.existsSync(filePath)) {
    return { onedrive: null, gdrive: null };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { onedrive: null, gdrive: null };
    const parsed = JSON.parse(raw) as FilePayload;
    const now = new Date().toISOString();

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
            } satisfies RuntimeGoogleOauthAppConfig;
          })()
        : null;

    return {
      onedrive: oneDrive,
      gdrive: google,
    };
  } catch {
    return { onedrive: null, gdrive: null };
  }
}

export function writeRuntimeCloudOauthAppConfig(input: {
  provider: CloudOauthProvider;
  onedrive?: OneDriveInput;
  gdrive?: GoogleInput;
}) {
  const current = readRuntimeCloudOauthAppConfig();
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
        }
      : null,
    gdrive: next.gdrive
      ? {
          clientId: next.gdrive.clientId,
          clientSecretCipher: sealSecret(next.gdrive.clientSecret),
          updatedAt: next.gdrive.updatedAt,
        }
      : null,
  } satisfies FilePayload;

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return next;
}

export function clearRuntimeCloudOauthAppConfig(provider: CloudOauthProvider) {
  const current = readRuntimeCloudOauthAppConfig();
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
        }
      : null,
    gdrive: next.gdrive
      ? {
          clientId: next.gdrive.clientId,
          clientSecretCipher: sealSecret(next.gdrive.clientSecret),
          updatedAt: next.gdrive.updatedAt,
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
    },
    gdrive: {
      configured: Boolean(config.gdrive?.clientId && config.gdrive?.clientSecret),
      clientIdMasked: maskClientId(config.gdrive?.clientId),
      updatedAt: config.gdrive?.updatedAt ?? null,
    },
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
