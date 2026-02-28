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

export function getTrustedOriginForRequest(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;

  const protoHeader = request.headers.get("x-forwarded-proto");
  const protocol = protoHeader ? `${protoHeader}:` : request.nextUrl.protocol;
  if (!protocol) return null;

  return `${protocol}//${host}`;
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
