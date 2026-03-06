import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  isAuthEnabled,
  sanitizeNextPath,
  verifySessionToken,
} from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import {
  buildContentSecurityPolicy,
  createCspNonce,
  CSP_NONCE_HEADER,
} from "@/lib/security/csp";

const BASE_SECURITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-site",
} as const;

function isPublicAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/install-assets/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

function isPublicRoute(pathname: string) {
  if (pathname === "/login") return true;
  if (pathname === "/install" || pathname.startsWith("/install/")) return true;
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/cloud-broker/")) return true;
  return false;
}

function isProtectedApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function buildLoginRedirect(request: NextRequest, nonce: string) {
  const loginUrl = new URL("/login", request.url);
  const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (nextPath !== "/login") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return applySecurityHeaders(NextResponse.redirect(loginUrl), request.nextUrl.pathname, nonce);
}

function buildDeniedRedirect(request: NextRequest, nonce: string) {
  const deniedUrl = new URL("/", request.url);
  deniedUrl.searchParams.set("denied", "1");
  return applySecurityHeaders(NextResponse.redirect(deniedUrl), request.nextUrl.pathname, nonce);
}

function applySecurityHeaders(response: NextResponse, pathname: string, nonce: string) {
  if (isPublicAssetPath(pathname)) {
    return response;
  }

  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));
  return response;
}

function buildPassThroughResponse(request: NextRequest, pathname: string, nonce: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  return applySecurityHeaders(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    pathname,
    nonce,
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = createCspNonce();

  if (isPublicAssetPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthEnabled()) {
    if (
      isPublicRoute(pathname) ||
      pathname === "/api/setup/auth"
    ) {
      return buildPassThroughResponse(request, pathname, nonce);
    }

    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(NextResponse.json(
        { error: "Bootstrap required", next: "/login" },
        { status: 401 },
      ), pathname, nonce);
    }

    return buildLoginRedirect(request, nonce);
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    if (session) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/", request.url)), pathname, nonce);
    }
    return buildPassThroughResponse(request, pathname, nonce);
  }

  if (isPublicRoute(pathname)) {
    return buildPassThroughResponse(request, pathname, nonce);
  }

  if (!session) {
    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), pathname, nonce);
    }

    return buildLoginRedirect(request, nonce);
  }

  if (
    (pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/setup" || pathname.startsWith("/setup/")) &&
    !hasRuntimeCapability(session.role, "admin")
  ) {
    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        pathname,
        nonce,
      );
    }
    return buildDeniedRedirect(request, nonce);
  }

  if (
    (pathname === "/provision" || pathname.startsWith("/provision/")) &&
    !hasRuntimeCapability(session.role, "operate")
  ) {
    return buildDeniedRedirect(request, nonce);
  }

  if (pathname.startsWith("/api/settings/") || pathname.startsWith("/api/setup/") || pathname.startsWith("/api/proxmox/")) {
    if (!hasRuntimeCapability(session.role, "admin")) {
      return applySecurityHeaders(NextResponse.json({ error: "Forbidden" }, { status: 403 }), pathname, nonce);
    }
  }

  if (
    pathname.startsWith("/api/workloads/") ||
    pathname.startsWith("/api/provision/") ||
    (pathname === "/api/backups/config" && request.method !== "GET")
  ) {
    if (!hasRuntimeCapability(session.role, "operate")) {
      return applySecurityHeaders(NextResponse.json({ error: "Forbidden" }, { status: 403 }), pathname, nonce);
    }
  }

  return buildPassThroughResponse(request, pathname, nonce);
}

export const config = {
  matcher: "/:path*",
};
