import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  isAuthEnabled,
  sanitizeNextPath,
  verifySessionToken,
} from "@/lib/auth/session";

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
  return NextResponse.redirect(loginUrl);
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
      return NextResponse.next();
    }

    if (isProtectedApiPath(pathname)) {
      return NextResponse.json(
        { error: "Bootstrap required", next: "/login" },
        { status: 401 },
      );
    }

    return buildLoginRedirect(request);
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  if (!session) {
    if (isProtectedApiPath(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return buildLoginRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
