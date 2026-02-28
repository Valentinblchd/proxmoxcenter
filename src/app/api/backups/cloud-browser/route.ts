import { NextRequest, NextResponse } from "next/server";
import { readRuntimeBackupConfig } from "@/lib/backups/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "onedrive" | "gdrive";
type Action = "list-folders" | "create-folder";

type RequestBody = {
  provider?: unknown;
  action?: unknown;
  targetId?: unknown;
  settings?: unknown;
  secrets?: unknown;
  folderName?: unknown;
  parentId?: unknown;
  parentPath?: unknown;
};

const CLOUD_BROWSER_LIMIT = {
  windowMs: 5 * 60_000,
  max: 50,
  blockMs: 10 * 60_000,
} as const;

function asNonEmptyString(value: unknown, maxLength = 300) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function sanitizeMap(value: unknown, opts?: { maxKeys?: number; maxValueLength?: number }) {
  if (!value || typeof value !== "object") return {};
  const maxKeys = opts?.maxKeys ?? 40;
  const maxValueLength = opts?.maxValueLength ?? 2000;
  const out: Record<string, string> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
    const safeKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const safeValue = asNonEmptyString(raw, maxValueLength);
    if (!safeKey || !safeValue) continue;
    out[safeKey] = safeValue;
  }

  return out;
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getOAuthToken(endpoint: string, body: URLSearchParams) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  });
  const json = await parseJsonSafe(response);
  if (!response.ok || !json?.access_token || typeof json.access_token !== "string") {
    const message =
      typeof json?.error_description === "string"
        ? json.error_description
        : `OAuth token refresh échoué (${response.status}).`;
    throw new Error(message);
  }
  return json.access_token;
}

async function listGoogleDriveFolders(
  settings: Record<string, string>,
  secrets: Record<string, string>,
  parentId?: string | null,
) {
  const clientId = settings.clientid;
  const clientSecret = secrets.clientsecret;
  const refreshToken = secrets.refreshtoken;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Configuration Google Drive incomplète.");
  }

  const accessToken = await getOAuthToken(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );

  const folderParent = parentId?.trim() || "root";
  const query = new URLSearchParams({
    q: `'${folderParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name,webViewLink)",
    orderBy: "name",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${query.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`Lecture Google Drive refusée (${response.status}).`);
  }

  const files = Array.isArray(json?.files) ? json.files : [];
  return files
    .map((item) => {
      const folder = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!folder) return null;
      const id = typeof folder.id === "string" ? folder.id : null;
      const name = typeof folder.name === "string" ? folder.name : null;
      if (!id || !name) return null;
      return {
        id,
        name,
        value: id,
      };
    })
    .filter((item): item is { id: string; name: string; value: string } => Boolean(item));
}

async function createGoogleDriveFolder(
  settings: Record<string, string>,
  secrets: Record<string, string>,
  folderName: string,
  parentId?: string | null,
) {
  const clientId = settings.clientid;
  const clientSecret = secrets.clientsecret;
  const refreshToken = secrets.refreshtoken;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Configuration Google Drive incomplète.");
  }

  const accessToken = await getOAuthToken(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );

  const response = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId?.trim() || "root"],
    }),
    cache: "no-store",
  });
  const json = await parseJsonSafe(response);
  if (!response.ok || typeof json?.id !== "string" || typeof json?.name !== "string") {
    throw new Error(`Création dossier Google Drive refusée (${response.status}).`);
  }

  return {
    id: json.id,
    name: json.name,
    value: json.id,
  };
}

function getMicrosoftTokenEndpoint(settings: Record<string, string>) {
  const authorityRaw = (settings.authority ?? settings.tenantid ?? "").trim();
  const authority = authorityRaw || "consumers";
  return `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`;
}

function normalizeOneDrivePath(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function toOneDriveChildrenUrl(pathValue: string) {
  const normalized = normalizeOneDrivePath(pathValue);
  if (!normalized) {
    return "https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,folder,webUrl,parentReference";
  }
  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/children?$select=id,name,folder,webUrl,parentReference`;
}

function toOneDriveCreateFolderUrl(pathValue: string) {
  const normalized = normalizeOneDrivePath(pathValue);
  if (!normalized) {
    return "https://graph.microsoft.com/v1.0/me/drive/root/children";
  }
  const encodedPath = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/children`;
}

async function listOneDriveFolders(
  settings: Record<string, string>,
  secrets: Record<string, string>,
  parentPath?: string | null,
) {
  const clientId = settings.clientid;
  const clientSecret = secrets.clientsecret;
  const refreshToken = secrets.refreshtoken;
  if (!clientId || !refreshToken) {
    throw new Error("Configuration OneDrive incomplète.");
  }

  const tokenPayload = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "Files.ReadWrite offline_access",
  });
  if (clientSecret) {
    tokenPayload.set("client_secret", clientSecret);
  }

  const accessToken = await getOAuthToken(getMicrosoftTokenEndpoint(settings), tokenPayload);
  const normalizedParentPath = normalizeOneDrivePath(parentPath);
  const response = await fetch(toOneDriveChildrenUrl(normalizedParentPath), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`Lecture OneDrive refusée (${response.status}).`);
  }

  const values = Array.isArray(json?.value) ? json.value : [];
  return values
    .map((item) => {
      const folder = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!folder || !folder.folder || typeof folder.folder !== "object") return null;
      const id = typeof folder.id === "string" ? folder.id : null;
      const name = typeof folder.name === "string" ? folder.name : null;
      if (!id || !name) return null;
      const fullPath = normalizeOneDrivePath(
        normalizedParentPath ? `${normalizedParentPath}/${name}` : `/${name}`,
      );
      return {
        id,
        name,
        value: fullPath,
      };
    })
    .filter((item): item is { id: string; name: string; value: string } => Boolean(item));
}

async function createOneDriveFolder(
  settings: Record<string, string>,
  secrets: Record<string, string>,
  folderName: string,
  parentPath?: string | null,
) {
  const clientId = settings.clientid;
  const clientSecret = secrets.clientsecret;
  const refreshToken = secrets.refreshtoken;
  if (!clientId || !refreshToken) {
    throw new Error("Configuration OneDrive incomplète.");
  }

  const tokenPayload = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "Files.ReadWrite offline_access",
  });
  if (clientSecret) {
    tokenPayload.set("client_secret", clientSecret);
  }

  const accessToken = await getOAuthToken(getMicrosoftTokenEndpoint(settings), tokenPayload);
  const normalizedParentPath = normalizeOneDrivePath(parentPath);
  const response = await fetch(
    toOneDriveCreateFolderUrl(normalizedParentPath),
    {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
    cache: "no-store",
  });
  const json = await parseJsonSafe(response);
  if (!response.ok || typeof json?.id !== "string" || typeof json?.name !== "string") {
    throw new Error(`Création dossier OneDrive refusée (${response.status}).`);
  }

  return {
    id: json.id,
    name: json.name,
    value: normalizeOneDrivePath(
      normalizedParentPath ? `${normalizedParentPath}/${json.name}` : `/${json.name}`,
    ),
  };
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: origine de requête invalide." },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`backup:cloud-browser:${getClientIp(request)}`, CLOUD_BROWSER_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes cloud. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const provider = asNonEmptyString(body.provider, 30) as Provider | null;
  const action = asNonEmptyString(body.action, 30) as Action | null;
  if (!provider || !["onedrive", "gdrive"].includes(provider)) {
    return NextResponse.json({ ok: false, error: "Provider invalide." }, { status: 400 });
  }
  if (!action || !["list-folders", "create-folder"].includes(action)) {
    return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  }

  const targetId = asNonEmptyString(body.targetId, 120);
  const parentId = asNonEmptyString(body.parentId, 240);
  const parentPath = asNonEmptyString(body.parentPath, 500);
  const persistedTarget = targetId
    ? readRuntimeBackupConfig().cloudTargets.find((target) => target.id === targetId && target.provider === provider) ?? null
    : null;
  const settings = {
    ...(persistedTarget?.settings ?? {}),
    ...sanitizeMap(body.settings),
  };
  const secrets = {
    ...(persistedTarget?.secrets ?? {}),
    ...sanitizeMap(body.secrets, { maxValueLength: 4000 }),
  };

  try {
    if (provider === "gdrive") {
      if (action === "list-folders") {
        const folders = await listGoogleDriveFolders(settings, secrets, parentId);
        return NextResponse.json({ ok: true, folders });
      }

      const folderName = asNonEmptyString(body.folderName, 120);
      if (!folderName) {
        return NextResponse.json({ ok: false, error: "Nom du dossier requis." }, { status: 400 });
      }
      const folder = await createGoogleDriveFolder(settings, secrets, folderName, parentId);
      return NextResponse.json({ ok: true, folder });
    }

    if (action === "list-folders") {
      const folders = await listOneDriveFolders(settings, secrets, parentPath);
      return NextResponse.json({ ok: true, folders });
    }

    const folderName = asNonEmptyString(body.folderName, 120);
    if (!folderName) {
      return NextResponse.json({ ok: false, error: "Nom du dossier requis." }, { status: 400 });
    }
    const folder = await createOneDriveFolder(settings, secrets, folderName, parentPath);
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur cloud." },
      { status: 400 },
    );
  }
}
