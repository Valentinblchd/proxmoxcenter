import { NextRequest, NextResponse } from "next/server";
import { readAssistantMemory, resetAssistantMemory } from "@/lib/assistant/memory";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { ensureSameOriginRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getMemoryScopeFromRequest(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return "default";
  const session = await verifySessionToken(token);
  return session?.username ?? "default";
}

export async function GET(request: NextRequest) {
  const scope = await getMemoryScopeFromRequest(request);
  const memory = readAssistantMemory(scope);
  return NextResponse.json({
    ok: true,
    memory,
  });
}

export async function DELETE(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden", details: originCheck.reason },
      { status: 403 },
    );
  }

  const scope = await getMemoryScopeFromRequest(request);
  resetAssistantMemory(scope);
  return NextResponse.json({
    ok: true,
    message: "Mémoire IA réinitialisée.",
  });
}
