import { NextRequest, NextResponse } from "next/server";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["qemu", "lxc"]);
const VALID_ACTIONS = new Set(["start", "stop", "shutdown", "reboot"]);
const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const ACTION_LIMIT = {
  windowMs: 60_000,
  max: 40,
  blockMs: 3 * 60_000,
} as const;

type ActionBody = {
  node?: unknown;
  vmid?: unknown;
  kind?: unknown;
  action?: unknown;
};

function asNonEmptyString(value: unknown, maxLength = 80) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { error: "Forbidden", details: originCheck.reason },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`workloads:action:${getClientIp(request)}`, ACTION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Trop de requêtes d’action. Réessaie dans quelques instants." },
      { status: 429 },
    );
  }

  let body: ActionBody;

  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const node = asNonEmptyString(body.node);
  const kind = asNonEmptyString(body.kind);
  const action = asNonEmptyString(body.action);
  const vmid = asInt(body.vmid);

  if (!node || !kind || !action || vmid === null) {
    return NextResponse.json(
      { error: "Missing required fields: node, kind, vmid, action." },
      { status: 400 },
    );
  }

  if (!NODE_NAME_PATTERN.test(node)) {
    return NextResponse.json({ error: "Nom de nœud invalide." }, { status: 400 });
  }

  if (vmid < 1 || vmid > 9_999_999) {
    return NextResponse.json({ error: "VMID invalide." }, { status: 400 });
  }

  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: `Invalid kind: ${kind}` }, { status: 400 });
  }

  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Invalid action: ${action}` },
      { status: 400 },
    );
  }

  try {
    const upid = await proxmoxRequest<string>(
      `nodes/${encodeURIComponent(node)}/${kind}/${vmid}/status/${action}`,
      { method: "POST" },
    );

    return NextResponse.json({
      ok: true,
      node,
      kind,
      vmid,
      action,
      upid,
      message: `Action ${action} envoyée à ${kind}/${vmid}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
