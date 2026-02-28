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

function getConfiguredPublicOrigin() {
  return (
    normalizeOrigin(process.env.PROXMOXCENTER_PUBLIC_ORIGIN) ??
    normalizeOrigin(process.env.PROXCENTER_PUBLIC_ORIGIN)
  );
}

export function getTrustedOriginForRequest(request: NextRequest) {
  return getConfiguredPublicOrigin() ?? normalizeOrigin(request.nextUrl.origin);
}

function parseOriginFromReferer(referer: string | null) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

type SameOriginCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export function ensureSameOriginRequest(
  request: NextRequest,
  options?: { allowMissingOrigin?: boolean },
): SameOriginCheckResult {
  const expectedOrigin = getTrustedOriginForRequest(request);
  if (!expectedOrigin) {
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

  if (sourceOrigin !== expectedOrigin) {
    return { ok: false, reason: "Cross-origin request blocked." };
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
