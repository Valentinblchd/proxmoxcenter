import type { NextRequest } from "next/server";

export function getClientIp(request: NextRequest) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeHost(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.split(",")[0]?.trim();
  if (!trimmed) return null;
  if (trimmed.includes("://")) {
    return null;
  }
  if (trimmed.includes("/") || trimmed.includes("?") || trimmed.includes("#")) {
    return null;
  }
  return trimmed;
}

function normalizeProto(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.split(",")[0]?.trim().toLowerCase();
  if (trimmed === "http" || trimmed === "https") {
    return trimmed;
  }
  return null;
}

function buildOriginFromHost(host: string | null | undefined, proto: string | null | undefined) {
  const normalizedHost = normalizeHost(host);
  const normalizedProto = normalizeProto(proto);
  if (!normalizedHost || !normalizedProto) {
    return null;
  }
  return normalizeOrigin(`${normalizedProto}://${normalizedHost}`);
}

function getConfiguredPublicOrigin() {
  return (
    normalizeOrigin(process.env.PROXMOXCENTER_PUBLIC_ORIGIN) ??
    normalizeOrigin(process.env.PROXCENTER_PUBLIC_ORIGIN)
  );
}

export function getTrustedOriginForRequest(request: NextRequest) {
  const configured = getConfiguredPublicOrigin();
  if (configured) {
    return configured;
  }

  const hostOrigin = buildOriginFromHost(
    request.headers.get("host"),
    request.nextUrl.protocol.replace(":", ""),
  );
  if (hostOrigin) {
    return hostOrigin;
  }

  return normalizeOrigin(request.nextUrl.origin);
}

function getAcceptedOriginsForRequest(request: NextRequest) {
  const accepted = new Set<string>();

  const configured = getConfiguredPublicOrigin();
  if (configured) accepted.add(configured);

  const hostOrigin = buildOriginFromHost(
    request.headers.get("host"),
    request.nextUrl.protocol.replace(":", ""),
  );
  if (hostOrigin) accepted.add(hostOrigin);

  const nextOrigin = normalizeOrigin(request.nextUrl.origin);
  if (nextOrigin) accepted.add(nextOrigin);

  return accepted;
}

function parseOriginFromReferer(referer: string | null) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function normalizePort(protocol: string, port: string) {
  if (port) return port;
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
}

function sameHostAndPort(left: string, right: string) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.hostname === rightUrl.hostname &&
      normalizePort(leftUrl.protocol, leftUrl.port) === normalizePort(rightUrl.protocol, rightUrl.port)
    );
  } catch {
    return false;
  }
}

type SameOriginCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export function ensureSameOriginRequest(
  request: NextRequest,
  options?: { allowMissingOrigin?: boolean },
): SameOriginCheckResult {
  const acceptedOrigins = getAcceptedOriginsForRequest(request);
  if (acceptedOrigins.size === 0) {
    return { ok: false, reason: "Host header missing." };
  }

  const origin = request.headers.get("origin")?.trim() ?? null;
  const refererOrigin = parseOriginFromReferer(request.headers.get("referer"));
  const sourceOrigin = origin || refererOrigin;

  if (!sourceOrigin) {
    if (options?.allowMissingOrigin) {
      return { ok: true };
    }
    return { ok: false, reason: "Missing Origin/Referer header." };
  }

  if (!acceptedOrigins.has(sourceOrigin)) {
    const sameEndpoint = [...acceptedOrigins].some((candidate) => sameHostAndPort(candidate, sourceOrigin));
    if (!sameEndpoint) {
      const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";
      if (!["same-origin", "same-site", "none"].includes(secFetchSite)) {
        return { ok: false, reason: "Cross-origin request blocked." };
      }
    }
  }

  return { ok: true };
}

export function ensureTrustedNavigationRequest(request: NextRequest): SameOriginCheckResult {
  const directOriginCheck = ensureSameOriginRequest(request, { allowMissingOrigin: false });
  if (directOriginCheck.ok) {
    return directOriginCheck;
  }

  const secFetchMode = request.headers.get("sec-fetch-mode")?.trim().toLowerCase() ?? "";
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";
  const allowedSites = new Set(["same-origin", "same-site", "none"]);

  if (secFetchMode === "navigate" && allowedSites.has(secFetchSite)) {
    return { ok: true };
  }

  return directOriginCheck;
}
