import "server-only";
import { createHmac, createHash } from "node:crypto";
import type { RuntimeBackupCloudTarget } from "@/lib/backups/runtime-config";

type UploadPayload = {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
  signal?: AbortSignal;
};

type UploadResult = {
  provider: string;
  objectKey: string;
};

export type CloudBackupObject = {
  key: string;
  name: string;
  sizeBytes: number | null;
  updatedAt: string | null;
  encrypted: boolean;
};

export type DownloadedCloudObject = {
  key: string;
  filename: string;
  bytes: Uint8Array;
  contentType: string;
};

export type CloudTargetSpaceMetrics = {
  targetId: string;
  provider: RuntimeBackupCloudTarget["provider"];
  mode: "quota" | "prefix";
  usedBytes: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  usageRatio: number | null;
  source: string;
  error: string | null;
  updatedAt: string;
};

type SpaceProbeResult = {
  mode: "quota" | "prefix";
  usedBytes: number | null;
  totalBytes: number | null;
  source: string;
};

type AwsV4SignedRequest = {
  amzDate: string;
  payloadHash: string;
  authorization: string;
};

type SpaceMetricsCacheEntry = {
  cacheKey: string;
  expiresAt: number;
  value: CloudTargetSpaceMetrics;
};

const SPACE_METRICS_CACHE_KEY = "__proxcenter_cloud_space_metrics_cache__";
const SPACE_METRICS_CACHE_TTL_MS = 90_000;
const S3_LIST_MAX_PAGES = 20;
const AZURE_LIST_MAX_PAGES = 20;

function toIsoBasicDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(payload: Uint8Array | string) {
  return createHash("sha256").update(payload).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function urlJoinPath(parts: string[]) {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCanonicalQuery(pairs: Array<[string, string]>) {
  return pairs
    .slice()
    .sort((a, b) => {
      if (a[0] === b[0]) return a[1].localeCompare(b[1]);
      return a[0].localeCompare(b[0]);
    })
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function toSafeBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function parseNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCapacityBytesFromSettings(target: RuntimeBackupCloudTarget) {
  const quotaGb = parseNumeric(target.settings.capacitygb);
  if (quotaGb === null || quotaGb <= 0) return null;
  return toSafeBytes(quotaGb * 1024 * 1024 * 1024);
}

function extractXmlValues(xml: string, tagName: string) {
  const values: string[] = [];
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    values.push(match[1].trim());
  }
  return values;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getSpaceMetricsCache() {
  const globalRef = globalThis as typeof globalThis & {
    [SPACE_METRICS_CACHE_KEY]?: Map<string, SpaceMetricsCacheEntry>;
  };

  if (!globalRef[SPACE_METRICS_CACHE_KEY]) {
    globalRef[SPACE_METRICS_CACHE_KEY] = new Map<string, SpaceMetricsCacheEntry>();
  }
  return globalRef[SPACE_METRICS_CACHE_KEY];
}

function signAwsV4Request(options: {
  method: "GET" | "PUT";
  region: string;
  service: string;
  host: string;
  path: string;
  queryPairs: Array<[string, string]>;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  extraHeaders?: Record<string, string>;
  now?: Date;
}): AwsV4SignedRequest {
  const now = options.now ?? new Date();
  const amzDate = toIsoBasicDate(now);
  const shortDate = amzDate.slice(0, 8);
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${shortDate}/${options.region}/${options.service}/aws4_request`;

  const lowerHeaders: Record<string, string> = {
    host: options.host,
    "x-amz-content-sha256": options.payloadHash,
    "x-amz-date": amzDate,
  };

  for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
    lowerHeaders[key.trim().toLowerCase()] = value.trim();
  }

  const sortedHeaderKeys = Object.keys(lowerHeaders).sort((a, b) => a.localeCompare(b));
  const canonicalHeaders = `${sortedHeaderKeys.map((key) => `${key}:${lowerHeaders[key]}`).join("\n")}\n`;
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest =
    `${options.method}\n` +
    `${options.path}\n` +
    `${buildCanonicalQuery(options.queryPairs)}\n` +
    canonicalHeaders +
    "\n" +
    signedHeaders +
    "\n" +
    options.payloadHash;

  const stringToSign =
    `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${options.secretAccessKey}`, shortDate);
  const kRegion = hmac(kDate, options.region);
  const kService = hmac(kRegion, options.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${algorithm} Credential=${options.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    amzDate,
    payloadHash: options.payloadHash,
    authorization,
  };
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

function ensureArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function normalizeCloudUpdatedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asPositiveSize(value: unknown) {
  const parsed = parseNumeric(value);
  if (parsed === null || parsed < 0) return null;
  return toSafeBytes(parsed);
}

function isEncryptedObjectName(name: string) {
  return /\.pxenc$/i.test(name);
}

function getMicrosoftOauthTokenEndpoint(target: RuntimeBackupCloudTarget) {
  const authorityRaw = (target.settings.authority ?? target.settings.tenantid ?? "").trim();
  const authority = authorityRaw || "consumers";
  return `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`;
}

async function uploadAwsS3(target: RuntimeBackupCloudTarget, payload: UploadPayload): Promise<UploadResult> {
  const region = target.settings.region;
  const bucket = target.settings.bucket;
  const prefix = target.settings.prefix ?? "";
  const accessKeyId = target.secrets.accesskeyid;
  const secretAccessKey = target.secrets.secretaccesskey;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Configuration AWS S3 incomplète.");
  }

  const objectKey = urlJoinPath([prefix, payload.filename]);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const endpoint = `https://${host}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;

  const hashedPayload = sha256Hex(payload.bytes);
  const signed = signAwsV4Request({
    method: "PUT",
    region,
    service: "s3",
    host,
    path: `/${objectKey.split("/").map(encodeURIComponent).join("/")}`,
    queryPairs: [],
    accessKeyId,
    secretAccessKey,
    payloadHash: hashedPayload,
  });

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "content-type": payload.contentType,
      "content-length": String(payload.bytes.byteLength),
      "x-amz-date": signed.amzDate,
      "x-amz-content-sha256": signed.payloadHash,
      Authorization: signed.authorization,
    },
    body: Buffer.from(payload.bytes),
    signal: payload.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload AWS S3 refusé (${response.status}): ${text || "no details"}`);
  }

  return {
    provider: "aws-s3",
    objectKey: `s3://${bucket}/${objectKey}`,
  };
}

async function uploadAzureBlob(target: RuntimeBackupCloudTarget, payload: UploadPayload): Promise<UploadResult> {
  const accountName = target.settings.accountname;
  const container = target.settings.container;
  const prefix = target.settings.prefix ?? "";
  const accountKey = target.secrets.accountkey;
  const sasToken = target.secrets.sastoken;

  if (!accountName || !container) {
    throw new Error("Configuration Azure Blob incomplète.");
  }

  const objectPath = urlJoinPath([prefix, payload.filename]);
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const baseUrl = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedPath}`;

  if (sasToken) {
    const query = sasToken.startsWith("?") ? sasToken : `?${sasToken}`;
    const response = await fetch(`${baseUrl}${query}`, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": "2023-11-03",
        "content-type": payload.contentType,
        "content-length": String(payload.bytes.byteLength),
      },
      body: Buffer.from(payload.bytes),
      signal: payload.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload Azure Blob refusé (${response.status}): ${text || "no details"}`);
    }
    return {
      provider: "azure-blob",
      objectKey: `https://${accountName}.blob.core.windows.net/${container}/${objectPath}`,
    };
  }

  if (!accountKey) {
    throw new Error("Account key Azure manquante.");
  }

  const date = new Date().toUTCString();
  const version = "2023-11-03";
  const canonicalHeaders =
    `x-ms-blob-type:BlockBlob\n` +
    `x-ms-date:${date}\n` +
    `x-ms-version:${version}\n`;
  const canonicalResource = `/${accountName}/${container}/${objectPath}`;
  const stringToSign =
    "PUT\n" +
    "\n" +
    "\n" +
    `${payload.bytes.byteLength}\n` +
    "\n" +
    `${payload.contentType}\n` +
    "\n" +
    "\n" +
    "\n" +
    "\n" +
    "\n" +
    "\n" +
    canonicalHeaders +
    canonicalResource;

  const signature = createHmac("sha256", Buffer.from(accountKey, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  const auth = `SharedKey ${accountName}:${signature}`;

  const response = await fetch(baseUrl, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "x-ms-date": date,
      "x-ms-version": version,
      "x-ms-blob-type": "BlockBlob",
      "content-length": String(payload.bytes.byteLength),
      "content-type": payload.contentType,
    },
    body: Buffer.from(payload.bytes),
    signal: payload.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload Azure Blob refusé (${response.status}): ${text || "no details"}`);
  }

  return {
    provider: "azure-blob",
    objectKey: `https://${accountName}.blob.core.windows.net/${container}/${objectPath}`,
  };
}

async function getOAuthToken(
  endpoint: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal,
  });
  const json = await parseJsonSafe(response);
  if (!response.ok || !json?.access_token || typeof json.access_token !== "string") {
    throw new Error(
      `OAuth token refresh échoué (${response.status}).`,
    );
  }
  return json.access_token;
}

async function uploadGoogleDrive(target: RuntimeBackupCloudTarget, payload: UploadPayload): Promise<UploadResult> {
  const clientId = target.settings.clientid;
  const folderId = target.settings.folderid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;

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
    payload.signal,
  );

  const metadata: Record<string, unknown> = {
    name: payload.filename,
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const boundary = `proxcenter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const metadataPart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n`;
  const mediaHeader =
    `--${boundary}\r\n` +
    `Content-Type: ${payload.contentType}\r\n\r\n`;
  const mediaFooter = `\r\n--${boundary}--\r\n`;

  const requestBody = Buffer.concat([
    Buffer.from(metadataPart, "utf8"),
    Buffer.from(mediaHeader, "utf8"),
    Buffer.from(payload.bytes),
    Buffer.from(mediaFooter, "utf8"),
  ]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: requestBody,
      signal: payload.signal,
    },
  );

  const json = await parseJsonSafe(response);
  if (!response.ok || !json?.id || typeof json.id !== "string") {
    throw new Error(`Upload Google Drive refusé (${response.status}).`);
  }

  return {
    provider: "gdrive",
    objectKey: `gdrive:file:${json.id}`,
  };
}

async function uploadOneDrive(target: RuntimeBackupCloudTarget, payload: UploadPayload): Promise<UploadResult> {
  const clientId = target.settings.clientid;
  const rootPath = target.settings.rootpath ?? "/proxmox";
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;

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

  const accessToken = await getOAuthToken(
    getMicrosoftOauthTokenEndpoint(target),
    tokenPayload,
    payload.signal,
  );

  const remotePath = `${rootPath.replace(/\/+$/, "")}/${payload.filename}`.replace(/^\/+/, "");
  const encodedPath = remotePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const endpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": payload.contentType,
    },
    body: Buffer.from(payload.bytes),
    signal: payload.signal,
  });

  const json = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`Upload OneDrive refusé (${response.status}).`);
  }

  return {
    provider: "onedrive",
    objectKey:
      json?.id && typeof json.id === "string"
        ? `onedrive:item:${json.id}`
        : `onedrive:path:${remotePath}`,
  };
}

async function probeAwsS3Space(target: RuntimeBackupCloudTarget): Promise<SpaceProbeResult> {
  const region = target.settings.region;
  const bucket = target.settings.bucket;
  const prefix = target.settings.prefix ?? "";
  const accessKeyId = target.secrets.accesskeyid;
  const secretAccessKey = target.secrets.secretaccesskey;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Configuration AWS S3 incomplète.");
  }

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const payloadHash = sha256Hex("");
  let continuationToken: string | null = null;
  let usedBytes = 0;
  let objectCount = 0;

  for (let page = 0; page < S3_LIST_MAX_PAGES; page += 1) {
    const queryPairs: Array<[string, string]> = [
      ["list-type", "2"],
      ["max-keys", "1000"],
    ];
    if (prefix) queryPairs.push(["prefix", prefix]);
    if (continuationToken) queryPairs.push(["continuation-token", continuationToken]);
    const query = buildCanonicalQuery(queryPairs);

    const signed = signAwsV4Request({
      method: "GET",
      region,
      service: "s3",
      host,
      path: "/",
      queryPairs,
      accessKeyId,
      secretAccessKey,
      payloadHash,
    });

    const response = await fetch(`https://${host}/?${query}`, {
      method: "GET",
      headers: {
        Authorization: signed.authorization,
        "x-amz-date": signed.amzDate,
        "x-amz-content-sha256": signed.payloadHash,
      },
    });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`AWS S3 list refusé (${response.status}).`);
    }

    const pageSizes = extractXmlValues(xml, "Size").map((value) => Number.parseInt(value, 10));
    for (const size of pageSizes) {
      if (!Number.isFinite(size) || size < 0) continue;
      usedBytes += size;
      objectCount += 1;
    }

    const truncatedRaw = extractXmlValues(xml, "IsTruncated")[0] ?? "false";
    const isTruncated = truncatedRaw.toLowerCase() === "true";
    const nextTokenRaw = extractXmlValues(xml, "NextContinuationToken")[0] ?? "";
    continuationToken = nextTokenRaw ? decodeXmlEntities(nextTokenRaw) : null;

    if (!isTruncated || !continuationToken) {
      break;
    }
  }

  return {
    mode: "prefix",
    usedBytes: toSafeBytes(usedBytes),
    totalBytes: null,
    source: `AWS S3 prefix (${objectCount} objet(s))`,
  };
}

function buildAzureCanonicalResource(
  accountName: string,
  container: string,
  params: Array<[string, string]>,
) {
  const sorted = params
    .slice()
    .map(([key, value]) => [key.toLowerCase(), decodeXmlEntities(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  let resource = `/${accountName}/${container}`;
  for (const [key, value] of sorted) {
    resource += `\n${key}:${value}`;
  }
  return resource;
}

function buildAzureListQuery(prefix: string, marker: string | null) {
  const pairs: Array<[string, string]> = [
    ["comp", "list"],
    ["restype", "container"],
    ["maxresults", "5000"],
  ];
  if (prefix) {
    pairs.push(["prefix", prefix]);
  }
  if (marker) {
    pairs.push(["marker", marker]);
  }
  return pairs;
}

async function probeAzureBlobSpace(target: RuntimeBackupCloudTarget): Promise<SpaceProbeResult> {
  const accountName = target.settings.accountname;
  const container = target.settings.container;
  const prefix = target.settings.prefix ?? "";
  const accountKey = target.secrets.accountkey;
  const sasToken = target.secrets.sastoken;

  if (!accountName || !container) {
    throw new Error("Configuration Azure Blob incomplète.");
  }

  let marker: string | null = null;
  let usedBytes = 0;
  let objectCount = 0;
  const base = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(container)}`;

  for (let page = 0; page < AZURE_LIST_MAX_PAGES; page += 1) {
    const queryPairs = buildAzureListQuery(prefix, marker);
    const listParams = new URLSearchParams();
    for (const [key, value] of queryPairs) {
      listParams.append(key, value);
    }

    if (sasToken) {
      const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;
      const sasParams = new URLSearchParams(cleanSas);
      for (const [key, value] of sasParams.entries()) {
        listParams.append(key, value);
      }

      const response = await fetch(`${base}?${listParams.toString()}`, {
        method: "GET",
      });
      const xml = await response.text();
      if (!response.ok) {
        throw new Error(`Azure Blob list refusé (${response.status}).`);
      }

      const sizes = extractXmlValues(xml, "Content-Length").map((value) => Number.parseInt(value, 10));
      for (const size of sizes) {
        if (!Number.isFinite(size) || size < 0) continue;
        usedBytes += size;
        objectCount += 1;
      }
      const nextMarkerRaw = extractXmlValues(xml, "NextMarker")[0] ?? "";
      marker = nextMarkerRaw ? decodeXmlEntities(nextMarkerRaw) : null;
      if (!marker) break;
      continue;
    }

    if (!accountKey) {
      throw new Error("Account key Azure manquante pour inspecter l'espace.");
    }

    const xMsDate = new Date().toUTCString();
    const xMsVersion = "2023-11-03";
    const canonicalHeaders = `x-ms-date:${xMsDate}\nx-ms-version:${xMsVersion}\n`;
    const canonicalResource = buildAzureCanonicalResource(accountName, container, queryPairs);
    const stringToSign =
      "GET\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      "\n" +
      canonicalHeaders +
      canonicalResource;
    const signature = createHmac("sha256", Buffer.from(accountKey, "base64"))
      .update(stringToSign, "utf8")
      .digest("base64");
    const response = await fetch(`${base}?${listParams.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `SharedKey ${accountName}:${signature}`,
        "x-ms-date": xMsDate,
        "x-ms-version": xMsVersion,
      },
    });

    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`Azure Blob list refusé (${response.status}).`);
    }

    const sizes = extractXmlValues(xml, "Content-Length").map((value) => Number.parseInt(value, 10));
    for (const size of sizes) {
      if (!Number.isFinite(size) || size < 0) continue;
      usedBytes += size;
      objectCount += 1;
    }
    const nextMarkerRaw = extractXmlValues(xml, "NextMarker")[0] ?? "";
    marker = nextMarkerRaw ? decodeXmlEntities(nextMarkerRaw) : null;
    if (!marker) break;
  }

  return {
    mode: "prefix",
    usedBytes: toSafeBytes(usedBytes),
    totalBytes: null,
    source: `Azure Blob prefix (${objectCount} objet(s))`,
  };
}

async function probeGoogleDriveSpace(target: RuntimeBackupCloudTarget): Promise<SpaceProbeResult> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;

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

  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const json = await parseJsonSafe(response);
  if (!response.ok || !json) {
    throw new Error(`Google Drive quota refusé (${response.status}).`);
  }

  const storageQuota =
    json.storageQuota && typeof json.storageQuota === "object"
      ? (json.storageQuota as Record<string, unknown>)
      : null;
  if (!storageQuota) {
    throw new Error("Quota Google Drive indisponible.");
  }

  const used =
    parseNumeric(storageQuota.usageInDrive) ??
    parseNumeric(storageQuota.usage) ??
    null;
  const total = parseNumeric(storageQuota.limit);

  return {
    mode: "quota",
    usedBytes: used === null ? null : toSafeBytes(used),
    totalBytes: total === null || total <= 0 ? null : toSafeBytes(total),
    source: "Google Drive quota",
  };
}

async function probeOneDriveSpace(target: RuntimeBackupCloudTarget): Promise<SpaceProbeResult> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;

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

  const accessToken = await getOAuthToken(
    getMicrosoftOauthTokenEndpoint(target),
    tokenPayload,
  );

  const response = await fetch("https://graph.microsoft.com/v1.0/me/drive?$select=quota", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const json = await parseJsonSafe(response);
  if (!response.ok || !json) {
    throw new Error(`OneDrive quota refusé (${response.status}).`);
  }

  const quota = json.quota && typeof json.quota === "object" ? (json.quota as Record<string, unknown>) : null;
  if (!quota) {
    throw new Error("Quota OneDrive indisponible.");
  }

  const used = parseNumeric(quota.used);
  const total = parseNumeric(quota.total);

  return {
    mode: "quota",
    usedBytes: used === null ? null : toSafeBytes(used),
    totalBytes: total === null || total <= 0 ? null : toSafeBytes(total),
    source: "OneDrive quota",
  };
}

function toCloudTargetSpaceMetrics(
  target: RuntimeBackupCloudTarget,
  probe: SpaceProbeResult,
  error: string | null,
): CloudTargetSpaceMetrics {
  const manualCapacity = parseCapacityBytesFromSettings(target);
  const totalBytes = probe.totalBytes ?? manualCapacity;
  const usedBytes = probe.usedBytes;
  const freeBytes =
    totalBytes !== null && usedBytes !== null
      ? Math.max(0, toSafeBytes(totalBytes - usedBytes))
      : null;
  const usageRatio =
    totalBytes !== null && totalBytes > 0 && usedBytes !== null
      ? Math.max(0, Math.min(usedBytes / totalBytes, 1))
      : null;

  return {
    targetId: target.id,
    provider: target.provider,
    mode: probe.mode,
    usedBytes,
    totalBytes,
    freeBytes,
    usageRatio,
    source: probe.source,
    error,
    updatedAt: new Date().toISOString(),
  };
}

async function probeTargetSpace(target: RuntimeBackupCloudTarget): Promise<SpaceProbeResult> {
  if (!target.enabled) {
    return {
      mode: "prefix",
      usedBytes: null,
      totalBytes: parseCapacityBytesFromSettings(target),
      source: "Cible désactivée",
    };
  }

  if (target.provider === "aws-s3") {
    return probeAwsS3Space(target);
  }
  if (target.provider === "azure-blob") {
    return probeAzureBlobSpace(target);
  }
  if (target.provider === "gdrive") {
    return probeGoogleDriveSpace(target);
  }
  return probeOneDriveSpace(target);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout après ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readCloudTargetSpaceMetrics(target: RuntimeBackupCloudTarget): Promise<CloudTargetSpaceMetrics> {
  const cache = getSpaceMetricsCache();
  const cacheKey = `${target.id}:${target.updatedAt}:${target.enabled ? "1" : "0"}`;
  const cached = cache.get(target.id);
  if (cached && cached.cacheKey === cacheKey && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  try {
    const probe = await withTimeout(probeTargetSpace(target), 12_000);
    const metrics = toCloudTargetSpaceMetrics(target, probe, null);
    cache.set(target.id, {
      cacheKey,
      value: metrics,
      expiresAt: Date.now() + SPACE_METRICS_CACHE_TTL_MS,
    });
    return metrics;
  } catch (error) {
    const fallback = toCloudTargetSpaceMetrics(
      target,
      {
        mode: "prefix",
        usedBytes: null,
        totalBytes: parseCapacityBytesFromSettings(target),
        source: "Probe indisponible",
      },
      error instanceof Error ? error.message : "Erreur de lecture du quota.",
    );
    cache.set(target.id, {
      cacheKey,
      value: fallback,
      expiresAt: Date.now() + 10_000,
    });
    return fallback;
  }
}

export async function readCloudTargetsSpaceMetrics(targets: RuntimeBackupCloudTarget[]) {
  const entries = await Promise.all(
    targets.map(async (target) => [target.id, await readCloudTargetSpaceMetrics(target)] as const),
  );
  return Object.fromEntries(entries) as Record<string, CloudTargetSpaceMetrics>;
}

export async function uploadBackupObjectToCloud(
  target: RuntimeBackupCloudTarget,
  payload: UploadPayload,
): Promise<UploadResult> {
  if (!target.enabled) {
    throw new Error("La cible cloud est désactivée.");
  }

  if (target.provider === "aws-s3") {
    return uploadAwsS3(target, payload);
  }
  if (target.provider === "azure-blob") {
    return uploadAzureBlob(target, payload);
  }
  if (target.provider === "gdrive") {
    return uploadGoogleDrive(target, payload);
  }
  return uploadOneDrive(target, payload);
}

async function listGoogleDriveObjects(target: RuntimeBackupCloudTarget): Promise<CloudBackupObject[]> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;
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

  const folderId = (target.settings.folderid ?? "").trim() || "root";
  const query = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,size,modifiedTime,mimeType)",
    orderBy: "modifiedTime desc,name",
    pageSize: "100",
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

  return ensureArray(json?.files as Record<string, unknown>[] | undefined)
    .map((item) => {
      const id = typeof item.id === "string" ? item.id : null;
      const name = typeof item.name === "string" ? item.name : null;
      if (!id || !name) return null;
      return {
        key: id,
        name,
        sizeBytes: asPositiveSize(item.size),
        updatedAt: normalizeCloudUpdatedAt(item.modifiedTime),
        encrypted: isEncryptedObjectName(name),
      } satisfies CloudBackupObject;
    })
    .filter((item): item is CloudBackupObject => Boolean(item));
}

async function downloadGoogleDriveObject(
  target: RuntimeBackupCloudTarget,
  objectKey: string,
): Promise<DownloadedCloudObject> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;
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

  const metaResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(objectKey)}?fields=id,name,mimeType`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const metaJson = await parseJsonSafe(metaResponse);
  if (!metaResponse.ok || typeof metaJson?.name !== "string") {
    throw new Error(`Métadonnées Google Drive refusées (${metaResponse.status}).`);
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(objectKey)}?alt=media`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/octet-stream",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Téléchargement Google Drive refusé (${response.status}).`);
  }

  return {
    key: objectKey,
    filename: metaJson.name,
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function listOneDriveObjects(target: RuntimeBackupCloudTarget): Promise<CloudBackupObject[]> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;
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

  const accessToken = await getOAuthToken(getMicrosoftOauthTokenEndpoint(target), tokenPayload);
  const rootPath = (target.settings.rootpath ?? "").trim();
  const listUrl = rootPath
    ? `https://graph.microsoft.com/v1.0/me/drive/root:${rootPath.replace(/\/+$/, "")}:/children?$select=id,name,file,lastModifiedDateTime,size,parentReference`
    : "https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,file,lastModifiedDateTime,size,parentReference";
  const response = await fetch(listUrl, {
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

  return ensureArray(json?.value as Record<string, unknown>[] | undefined)
    .map((item) => {
      if (!item.file || typeof item.file !== "object") return null;
      const id = typeof item.id === "string" ? item.id : null;
      const name = typeof item.name === "string" ? item.name : null;
      if (!id || !name) return null;
      return {
        key: id,
        name,
        sizeBytes: asPositiveSize(item.size),
        updatedAt: normalizeCloudUpdatedAt(item.lastModifiedDateTime),
        encrypted: isEncryptedObjectName(name),
      } satisfies CloudBackupObject;
    })
    .filter((item): item is CloudBackupObject => Boolean(item));
}

async function downloadOneDriveObject(
  target: RuntimeBackupCloudTarget,
  objectKey: string,
): Promise<DownloadedCloudObject> {
  const clientId = target.settings.clientid;
  const clientSecret = target.secrets.clientsecret;
  const refreshToken = target.secrets.refreshtoken;
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

  const accessToken = await getOAuthToken(getMicrosoftOauthTokenEndpoint(target), tokenPayload);
  const metaResponse = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(objectKey)}?$select=id,name,@microsoft.graph.downloadUrl,file`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const metaJson = await parseJsonSafe(metaResponse);
  const downloadUrl =
    typeof metaJson?.["@microsoft.graph.downloadUrl"] === "string"
      ? metaJson["@microsoft.graph.downloadUrl"]
      : null;
  const filename = typeof metaJson?.name === "string" ? metaJson.name : null;
  if (!metaResponse.ok || !downloadUrl || !filename) {
    throw new Error(`Métadonnées OneDrive refusées (${metaResponse.status}).`);
  }

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Téléchargement OneDrive refusé (${response.status}).`);
  }

  return {
    key: objectKey,
    filename,
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function listAwsS3Objects(target: RuntimeBackupCloudTarget): Promise<CloudBackupObject[]> {
  const region = target.settings.region;
  const bucket = target.settings.bucket;
  const prefix = target.settings.prefix ?? "";
  const accessKeyId = target.secrets.accesskeyid;
  const secretAccessKey = target.secrets.secretaccesskey;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Configuration AWS S3 incomplète.");
  }

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const payloadHash = sha256Hex("");
  let continuationToken: string | null = null;
  const objects: CloudBackupObject[] = [];

  for (let page = 0; page < S3_LIST_MAX_PAGES; page += 1) {
    const queryPairs: Array<[string, string]> = [
      ["list-type", "2"],
      ["max-keys", "200"],
    ];
    if (prefix) queryPairs.push(["prefix", prefix]);
    if (continuationToken) queryPairs.push(["continuation-token", continuationToken]);
    const query = buildCanonicalQuery(queryPairs);

    const signed = signAwsV4Request({
      method: "GET",
      region,
      service: "s3",
      host,
      path: "/",
      queryPairs,
      accessKeyId,
      secretAccessKey,
      payloadHash,
    });

    const response = await fetch(`https://${host}/?${query}`, {
      method: "GET",
      headers: {
        Authorization: signed.authorization,
        "x-amz-date": signed.amzDate,
        "x-amz-content-sha256": signed.payloadHash,
      },
      cache: "no-store",
    });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`AWS S3 list refusé (${response.status}).`);
    }

    const keyMatches = [...xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<LastModified>([\s\S]*?)<\/LastModified>[\s\S]*?<Size>([\s\S]*?)<\/Size>[\s\S]*?<\/Contents>/g)];
    for (const match of keyMatches) {
      const key = decodeXmlEntities(match[1].trim());
      const name = key.split("/").pop() ?? key;
      objects.push({
        key,
        name,
        sizeBytes: asPositiveSize(match[3].trim()),
        updatedAt: normalizeCloudUpdatedAt(match[2].trim()),
        encrypted: isEncryptedObjectName(name),
      });
    }

    const truncatedRaw = extractXmlValues(xml, "IsTruncated")[0] ?? "false";
    const isTruncated = truncatedRaw.toLowerCase() === "true";
    const nextTokenRaw = extractXmlValues(xml, "NextContinuationToken")[0] ?? "";
    continuationToken = nextTokenRaw ? decodeXmlEntities(nextTokenRaw) : null;
    if (!isTruncated || !continuationToken) break;
  }

  return objects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

async function downloadAwsS3Object(
  target: RuntimeBackupCloudTarget,
  objectKey: string,
): Promise<DownloadedCloudObject> {
  const region = target.settings.region;
  const bucket = target.settings.bucket;
  const accessKeyId = target.secrets.accesskeyid;
  const secretAccessKey = target.secrets.secretaccesskey;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Configuration AWS S3 incomplète.");
  }

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const payloadHash = sha256Hex("");
  const encodedPath = `/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const signed = signAwsV4Request({
    method: "GET",
    region,
    service: "s3",
    host,
    path: encodedPath,
    queryPairs: [],
    accessKeyId,
    secretAccessKey,
    payloadHash,
  });

  const response = await fetch(`https://${host}${encodedPath}`, {
    method: "GET",
    headers: {
      Authorization: signed.authorization,
      "x-amz-date": signed.amzDate,
      "x-amz-content-sha256": signed.payloadHash,
      Accept: "application/octet-stream",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Téléchargement AWS S3 refusé (${response.status}).`);
  }

  return {
    key: objectKey,
    filename: objectKey.split("/").pop() ?? objectKey,
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function listAzureBlobObjects(target: RuntimeBackupCloudTarget): Promise<CloudBackupObject[]> {
  const accountName = target.settings.accountname;
  const container = target.settings.container;
  const prefix = target.settings.prefix ?? "";
  const accountKey = target.secrets.accountkey;
  const sasToken = target.secrets.sastoken;

  if (!accountName || !container) {
    throw new Error("Configuration Azure Blob incomplète.");
  }

  let marker: string | null = null;
  const objects: CloudBackupObject[] = [];
  const base = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(container)}`;

  for (let page = 0; page < AZURE_LIST_MAX_PAGES; page += 1) {
    const queryPairs = buildAzureListQuery(prefix, marker);
    const listParams = new URLSearchParams();
    for (const [key, value] of queryPairs) listParams.append(key, value);

    let response: Response;
    if (sasToken) {
      const cleanSas = sasToken.startsWith("?") ? sasToken.slice(1) : sasToken;
      for (const [key, value] of new URLSearchParams(cleanSas).entries()) {
        listParams.append(key, value);
      }
      response = await fetch(`${base}?${listParams.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
    } else {
      if (!accountKey) {
        throw new Error("Account key Azure manquante pour lister les objets.");
      }
      const xMsDate = new Date().toUTCString();
      const xMsVersion = "2023-11-03";
      const canonicalHeaders = `x-ms-date:${xMsDate}\nx-ms-version:${xMsVersion}\n`;
      const canonicalResource = buildAzureCanonicalResource(accountName, container, queryPairs);
      const stringToSign =
        "GET\n\n\n\n\n\n\n\n\n\n\n\n" +
        canonicalHeaders +
        canonicalResource;
      const signature = createHmac("sha256", Buffer.from(accountKey, "base64"))
        .update(stringToSign, "utf8")
        .digest("base64");
      response = await fetch(`${base}?${listParams.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `SharedKey ${accountName}:${signature}`,
          "x-ms-date": xMsDate,
          "x-ms-version": xMsVersion,
        },
        cache: "no-store",
      });
    }

    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`Azure Blob list refusé (${response.status}).`);
    }

    const blobMatches = [...xml.matchAll(/<Blob>[\s\S]*?<Name>([\s\S]*?)<\/Name>[\s\S]*?<Content-Length>([\s\S]*?)<\/Content-Length>[\s\S]*?<Last-Modified>([\s\S]*?)<\/Last-Modified>[\s\S]*?<\/Blob>/g)];
    for (const match of blobMatches) {
      const key = decodeXmlEntities(match[1].trim());
      const name = key.split("/").pop() ?? key;
      objects.push({
        key,
        name,
        sizeBytes: asPositiveSize(match[2].trim()),
        updatedAt: normalizeCloudUpdatedAt(match[3].trim()),
        encrypted: isEncryptedObjectName(name),
      });
    }

    const nextMarkerRaw = extractXmlValues(xml, "NextMarker")[0] ?? "";
    marker = nextMarkerRaw ? decodeXmlEntities(nextMarkerRaw) : null;
    if (!marker) break;
  }

  return objects.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

async function downloadAzureBlobObject(
  target: RuntimeBackupCloudTarget,
  objectKey: string,
): Promise<DownloadedCloudObject> {
  const accountName = target.settings.accountname;
  const container = target.settings.container;
  const accountKey = target.secrets.accountkey;
  const sasToken = target.secrets.sastoken;

  if (!accountName || !container) {
    throw new Error("Configuration Azure Blob incomplète.");
  }

  const encodedPath = objectKey.split("/").map(encodeURIComponent).join("/");
  const base = `https://${accountName}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedPath}`;
  let response: Response;

  if (sasToken) {
    const query = sasToken.startsWith("?") ? sasToken : `?${sasToken}`;
    response = await fetch(`${base}${query}`, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
      },
      cache: "no-store",
    });
  } else {
    if (!accountKey) {
      throw new Error("Account key Azure manquante pour le téléchargement.");
    }
    const xMsDate = new Date().toUTCString();
    const xMsVersion = "2023-11-03";
    const canonicalHeaders = `x-ms-date:${xMsDate}\nx-ms-version:${xMsVersion}\n`;
    const canonicalResource = `/${accountName}/${container}/${objectKey}`;
    const stringToSign =
      "GET\n\n\n\n\n\n\n\n\n\n\n\n" +
      canonicalHeaders +
      canonicalResource;
    const signature = createHmac("sha256", Buffer.from(accountKey, "base64"))
      .update(stringToSign, "utf8")
      .digest("base64");
    response = await fetch(base, {
      method: "GET",
      headers: {
        Authorization: `SharedKey ${accountName}:${signature}`,
        "x-ms-date": xMsDate,
        "x-ms-version": xMsVersion,
        Accept: "application/octet-stream",
      },
      cache: "no-store",
    });
  }

  if (!response.ok) {
    throw new Error(`Téléchargement Azure Blob refusé (${response.status}).`);
  }

  return {
    key: objectKey,
    filename: objectKey.split("/").pop() ?? objectKey,
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function listBackupObjectsOnCloud(target: RuntimeBackupCloudTarget): Promise<CloudBackupObject[]> {
  if (target.provider === "aws-s3") {
    return listAwsS3Objects(target);
  }
  if (target.provider === "azure-blob") {
    return listAzureBlobObjects(target);
  }
  if (target.provider === "gdrive") {
    return listGoogleDriveObjects(target);
  }
  return listOneDriveObjects(target);
}

export async function downloadBackupObjectFromCloud(
  target: RuntimeBackupCloudTarget,
  objectKey: string,
): Promise<DownloadedCloudObject> {
  if (target.provider === "aws-s3") {
    return downloadAwsS3Object(target, objectKey);
  }
  if (target.provider === "azure-blob") {
    return downloadAzureBlobObject(target, objectKey);
  }
  if (target.provider === "gdrive") {
    return downloadGoogleDriveObject(target, objectKey);
  }
  return downloadOneDriveObject(target, objectKey);
}
