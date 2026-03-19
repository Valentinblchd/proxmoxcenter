import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifySessionToken, type AuthSession } from "@/lib/auth/session";
import { hasRuntimeCapability, type RuntimeAuthCapability } from "@/lib/auth/rbac";

export async function getSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireRequestCapability(
  request: NextRequest,
  capability: RuntimeAuthCapability,
): Promise<
  | { ok: true; session: AuthSession }
  | { ok: false; response: NextResponse<{ ok: false; error: string }> }
> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Authentification requise." }, { status: 401 }),
    };
  }

  if (!hasRuntimeCapability(session.role, capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Permission insuffisante pour cette action." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session };
}
