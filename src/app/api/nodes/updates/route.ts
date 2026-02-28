import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { scanNodeUpdates } from "@/lib/proxmox/node-updates";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const NODE_UPDATE_LIMIT = {
  windowMs: 60_000,
  max: 20,
  blockMs: 3 * 60_000,
} as const;

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`nodes:updates:${getClientIp(request)}`, NODE_UPDATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de vérifications de mises à jour. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: { node?: unknown; refresh?: unknown };
  try {
    body = (await request.json()) as { node?: unknown; refresh?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const node = asString(body.node);
  if (!node || !NODE_NAME_PATTERN.test(node)) {
    return NextResponse.json({ ok: false, error: "Nœud invalide." }, { status: 400 });
  }

  try {
    const snapshot = await scanNodeUpdates(node, { refresh: asBoolean(body.refresh) ?? false });
    return NextResponse.json({
      ok: true,
      ...snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible de lire les mises à jour Proxmox.",
      },
      { status: 502 },
    );
  }
}
