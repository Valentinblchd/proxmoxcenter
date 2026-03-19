import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAuthConfig } from "@/lib/auth/session";
import { ensureSameOriginRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearSessionCookie(response: NextResponse) {
  const secureCookie = getAuthConfig()?.secureCookie ?? false;
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST to logout." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { error: "Accès refusé.", details: originCheck.reason },
      { status: 403 },
    );
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/login" },
  });
  return clearSessionCookie(response);
}
