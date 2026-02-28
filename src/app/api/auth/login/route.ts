import { NextRequest, NextResponse } from "next/server";
import { isLdapSecondaryAuthEnabled, verifyLdapCredentials } from "@/lib/auth/ldap";
import {
  AUTH_COOKIE_NAME,
  authenticateLocalCredentials,
  createSessionToken,
  getAuthStatus,
  sanitizeNextPath,
  type AuthMethod,
} from "@/lib/auth/session";
import { touchRuntimeAuthUserLastLogin } from "@/lib/auth/runtime-config";
import { getDefaultSecondaryAuthRole } from "@/lib/auth/rbac";
import { consumeRateLimit, resetRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_IP_LIMIT = {
  windowMs: 10 * 60_000,
  max: 25,
  blockMs: 15 * 60_000,
} as const;

const LOGIN_USER_LIMIT = {
  windowMs: 10 * 60_000,
  max: 8,
  blockMs: 20 * 60_000,
} as const;

function asAuthMethod(value: unknown): AuthMethod {
  if (typeof value !== "string") return "local";
  const normalized = value.trim().toLowerCase();
  return normalized === "ldap" ? "ldap" : "local";
}

function redirectToLogin(
  request: NextRequest,
  error?: string,
  nextPath?: string,
  authMethod?: AuthMethod,
) {
  const url = new URL("/login", request.url);
  if (error) {
    url.searchParams.set("error", error);
  }
  if (nextPath && nextPath !== "/") {
    url.searchParams.set("next", sanitizeNextPath(nextPath));
  }
  if (authMethod && authMethod !== "local") {
    url.searchParams.set("method", authMethod);
  }
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `${url.pathname}${url.search}`,
    },
  });
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return redirectToLogin(request, "csrf");
  }

  const authStatus = getAuthStatus();
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return redirectToLogin(request, "invalid_request");
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? "/"));
  const authMethod = asAuthMethod(formData.get("authMethod"));
  const clientIp = getClientIp(request);
  const normalizedUser = username.toLowerCase().slice(0, 120) || "_empty";

  const ipGate = consumeRateLimit(`login:ip:${clientIp}`, LOGIN_IP_LIMIT);
  const userGate = consumeRateLimit(
    `login:user:${clientIp}:${authMethod}:${normalizedUser}`,
    LOGIN_USER_LIMIT,
  );
  if (!ipGate.ok || !userGate.ok) {
    return redirectToLogin(request, "rate_limited", nextPath, authMethod);
  }

  if (!authStatus.active) {
    return redirectToLogin(
      request,
      authStatus.enabledFlag ? "misconfigured" : "disabled",
      nextPath,
      authMethod,
    );
  }

  let authenticatedUser:
    | {
        userId: string | null;
        username: string;
        role: ReturnType<typeof getDefaultSecondaryAuthRole>;
        authMethod: AuthMethod;
      }
    | null = null;
  if (authMethod === "local") {
    const localUser = await authenticateLocalCredentials(username, password);
    if (localUser) {
      authenticatedUser = {
        userId: localUser.userId,
        username: localUser.username,
        role: localUser.role,
        authMethod,
      };
    }
  } else {
    if (!isLdapSecondaryAuthEnabled()) {
      return redirectToLogin(request, "ldap_disabled", nextPath, authMethod);
    }
    const ldapResult = await verifyLdapCredentials(username, password);
    if (ldapResult.ok) {
      authenticatedUser = {
        userId: null,
        username: ldapResult.username,
        role: getDefaultSecondaryAuthRole(),
        authMethod,
      };
    }
  }

  if (!authenticatedUser) {
    return redirectToLogin(request, "invalid", nextPath, authMethod);
  }

  resetRateLimit(`login:user:${clientIp}:${authMethod}:${normalizedUser}`);
  if (authMethod === "local") {
    touchRuntimeAuthUserLastLogin(authenticatedUser.username);
  }

  const session = await createSessionToken(authenticatedUser);
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: nextPath,
    },
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: session.token,
    httpOnly: true,
    sameSite: "lax",
    secure: session.secureCookie,
    path: "/",
    maxAge: session.maxAge,
  });

  return response;
}
