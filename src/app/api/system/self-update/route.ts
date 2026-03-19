import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";
import {
  getSelfUpdateOverview,
  resetSelfUpdateState,
  startSelfUpdate,
} from "@/lib/system/self-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELF_UPDATE_LIMIT = {
  windowMs: 60_000,
  max: 10,
  blockMs: 3 * 60_000,
} as const;

function asString(value: unknown, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) return capability.response;

  return NextResponse.json({
    ok: true,
    ...(await getSelfUpdateOverview()),
  });
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) return capability.response;

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`settings:self-update:${getClientIp(request)}`, SELF_UPDATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "Trop d’actions update. Réessaie plus tard." }, { status: 429 });
  }

  let body: {
    action?: unknown;
    confirmationText?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const action = asString(body.action, 40);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  }

  try {
    if (action === "refresh") {
      const overview = await getSelfUpdateOverview({ refreshAvailability: true });
      return NextResponse.json({ ok: true, ...overview });
    }

    if (action === "start") {
      assertStrongConfirmation(
        body.confirmationText,
        "UPDATE PROXMOXCENTER",
        'Confirmation forte requise. Tape "UPDATE PROXMOXCENTER".',
      );

      const overview = await startSelfUpdate(capability.session.username);
      return NextResponse.json({ ok: true, ...overview });
    }

    if (action === "reset") {
      const overview = await resetSelfUpdateState();
      return NextResponse.json({ ok: true, ...overview });
    }

    return NextResponse.json({ ok: false, error: "Action inconnue." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible d’exécuter la mise à jour.",
      },
      { status: 400 },
    );
  }
}
