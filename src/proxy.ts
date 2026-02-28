import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  isAuthEnabled,
  sanitizeNextPath,
  verifySessionToken,
} from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";

const BASE_SECURITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-site",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; media-src 'self' data: blob:",
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
  return false;
}

function isProtectedApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function buildLoginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (nextPath !== "/login") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return applySecurityHeaders(NextResponse.redirect(loginUrl), request.nextUrl.pathname);
}

function buildDeniedRedirect(request: NextRequest) {
  const deniedUrl = new URL("/", request.url);
  deniedUrl.searchParams.set("denied", "1");
  return applySecurityHeaders(NextResponse.redirect(deniedUrl), request.nextUrl.pathname);
}

function applySecurityHeaders(response: NextResponse, pathname: string) {
  if (isPublicAssetPath(pathname)) {
    return response;
  }

  Object.entries(BASE_SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAssetPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthEnabled()) {
    if (
      isPublicRoute(pathname) ||
      pathname === "/api/setup/auth"
    ) {
      return applySecurityHeaders(NextResponse.next(), pathname);
    }

    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(NextResponse.json(
        { error: "Bootstrap required", next: "/login" },
        { status: 401 },
      ), pathname);
    }

    return buildLoginRedirect(request);
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    if (session) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/", request.url)), pathname);
    }
    return applySecurityHeaders(NextResponse.next(), pathname);
  }

  if (isPublicRoute(pathname)) {
    return applySecurityHeaders(NextResponse.next(), pathname);
  }

  if (!session) {
    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), pathname);
    }

    return buildLoginRedirect(request);
  }

  if (
    (pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/setup" || pathname.startsWith("/setup/")) &&
    !hasRuntimeCapability(session.role, "admin")
  ) {
    if (isProtectedApiPath(pathname)) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Forbidden" }, { status: 403 }),
        pathname,
      );
    }
    return buildDeniedRedirect(request);
  }

  if (
    (pathname === "/provision" || pathname.startsWith("/provision/")) &&
    !hasRuntimeCapability(session.role, "operate")
  ) {
    return buildDeniedRedirect(request);
  }

  if (pathname.startsWith("/api/settings/") || pathname.startsWith("/api/setup/") || pathname.startsWith("/api/proxmox/")) {
    if (!hasRuntimeCapability(session.role, "admin")) {
      return applySecurityHeaders(NextResponse.json({ error: "Forbidden" }, { status: 403 }), pathname);
    }
  }

  if (
    pathname.startsWith("/api/workloads/") ||
    pathname.startsWith("/api/provision/") ||
    (pathname === "/api/backups/config" && request.method !== "GET")
  ) {
    if (!hasRuntimeCapability(session.role, "operate")) {
      return applySecurityHeaders(NextResponse.json({ error: "Forbidden" }, { status: 403 }), pathname);
    }
  }

  return applySecurityHeaders(NextResponse.next(), pathname);
}

export const config = {
  matcher: "/:path*",
};
