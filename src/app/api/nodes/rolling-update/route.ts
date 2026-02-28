import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import {
  cancelRollingUpdateJob,
  getRollingUpdateOverview,
  migrateBackRollingUpdateJob,
  startRollingUpdateJob,
  updateRollingUpdatePolicy,
} from "@/lib/proxmox/rolling-updates";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const ROLLING_LIMIT = {
  windowMs: 60_000,
  max: 20,
  blockMs: 3 * 60_000,
} as const;

function asString(value: unknown, maxLength = 160) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  const node = request.nextUrl.searchParams.get("node")?.trim() ?? "";
  if (!node || !NODE_NAME_PATTERN.test(node)) {
    return NextResponse.json({ ok: false, error: "Nœud invalide." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    node,
    ...getRollingUpdateOverview(node),
  });
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`nodes:rolling:${getClientIp(request)}`, ROLLING_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "Trop d’actions rolling update. Réessaie plus tard." }, { status: 429 });
  }

  let body: {
    action?: unknown;
    node?: unknown;
    jobId?: unknown;
    autoSecurityNoReboot?: unknown;
    confirmationText?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const action = asString(body.action, 48);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  }

  if (action === "set-policy") {
    const capability = await requireRequestCapability(request, "admin");
    if (!capability.ok) {
      return capability.response;
    }

    const node = asString(body.node, 64);
    if (!node || !NODE_NAME_PATTERN.test(node)) {
      return NextResponse.json({ ok: false, error: "Nœud invalide." }, { status: 400 });
    }

    try {
      const policy = updateRollingUpdatePolicy(
        node,
        { autoSecurityNoReboot: asBoolean(body.autoSecurityNoReboot) ?? false },
        capability.session.username,
      );
      return NextResponse.json({ ok: true, node, policy });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Impossible de mettre à jour la politique." },
        { status: 400 },
      );
    }
  }

  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  try {
    if (action === "start") {
      const node = asString(body.node, 64);
      if (!node || !NODE_NAME_PATTERN.test(node)) {
        return NextResponse.json({ ok: false, error: "Nœud invalide." }, { status: 400 });
      }
      assertStrongConfirmation(
        body.confirmationText,
        `ROLLING UPDATE ${node}`,
        `Confirmation forte requise. Tape "ROLLING UPDATE ${node}".`,
      );
      const job = startRollingUpdateJob(node, capability.session.username);
      return NextResponse.json({ ok: true, node, job });
    }

    if (action === "cancel") {
      const jobId = asString(body.jobId, 80);
      if (!jobId) {
        return NextResponse.json({ ok: false, error: "Job invalide." }, { status: 400 });
      }
      const job = cancelRollingUpdateJob(jobId);
      return NextResponse.json({ ok: true, job });
    }

    if (action === "migrate-back") {
      const jobId = asString(body.jobId, 80);
      const node = asString(body.node, 64);
      if (!jobId || !node || !NODE_NAME_PATTERN.test(node)) {
        return NextResponse.json({ ok: false, error: "Job ou nœud invalide." }, { status: 400 });
      }
      assertStrongConfirmation(
        body.confirmationText,
        `REMIGRATE ${node}`,
        `Confirmation forte requise. Tape "REMIGRATE ${node}".`,
      );
      const job = await migrateBackRollingUpdateJob(jobId);
      return NextResponse.json({ ok: true, job });
    }

    return NextResponse.json({ ok: false, error: "Action rolling update inconnue." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Erreur rolling update." },
      { status: 400 },
    );
  }
}
