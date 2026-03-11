import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  return NextResponse.json({
    ok: true,
    session: {
      username: capability.session.username,
      role: capability.session.role,
      authMethod: capability.session.authMethod,
      expiresAt: capability.session.expiresAt,
    },
  });
}
