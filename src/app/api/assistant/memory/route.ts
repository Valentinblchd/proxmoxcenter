import { NextRequest, NextResponse } from "next/server";
import { readAssistantMemory, resetAssistantMemory } from "@/lib/assistant/memory";
import { requireRequestCapability } from "@/lib/auth/authz";
import { ensureSameOriginRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  const scope = capability.session.username;
  const memory = readAssistantMemory(scope);
  return NextResponse.json({
    ok: true,
    memory,
  });
}

export async function DELETE(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Accès refusé.", details: originCheck.reason },
      { status: 403 },
    );
  }

  resetAssistantMemory(capability.session.username);
  return NextResponse.json({
    ok: true,
    message: "Mémoire IA réinitialisée.",
  });
}
