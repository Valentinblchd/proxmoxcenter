import { NextRequest, NextResponse } from "next/server";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_LIMIT = {
  windowMs: 5 * 60_000,
  max: 10,
  blockMs: 10 * 60_000,
} as const;

type ImportIsoBody = {
  node?: unknown;
  storage?: unknown;
  isoUrl?: unknown;
  isoFilename?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asHttpUrl(value: unknown) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeFilename(raw: string | null) {
  if (!raw) return null;
  const basename = raw.split(/[\\/]/).pop()?.trim() ?? "";
  if (!basename) return null;

  const cleaned = basename
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);

  if (!cleaned) return null;
  return cleaned.toLowerCase().endsWith(".iso") ? cleaned : `${cleaned}.iso`;
}

function deriveFilename(isoUrl: string, requestedFilename: string | null) {
  const direct = sanitizeFilename(requestedFilename);
  if (direct) return direct;

  try {
    const parsed = new URL(isoUrl);
    const fromPath = sanitizeFilename(decodeURIComponent(parsed.pathname.split("/").pop() ?? ""));
    if (fromPath) return fromPath;
  } catch {
    // URL already validated earlier.
  }

  return `imported-${Date.now()}.iso`;
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden", details: originCheck.reason },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`provision:import-iso:${getClientIp(request)}`, IMPORT_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de téléchargements ISO lancés. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: ImportIsoBody;
  try {
    body = (await request.json()) as ImportIsoBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const node = asNonEmptyString(body.node);
  const storage = asNonEmptyString(body.storage);
  const isoUrl = asHttpUrl(body.isoUrl);
  const filename = isoUrl ? deriveFilename(isoUrl, asNonEmptyString(body.isoFilename)) : null;

  if (!node || !storage || !isoUrl || !filename) {
    return NextResponse.json(
      { ok: false, error: "Champs requis: node, storage, isoUrl." },
      { status: 400 },
    );
  }

  try {
    const params = new URLSearchParams();
    params.set("content", "iso");
    params.set("filename", filename);
    params.set("url", isoUrl);

    const upid = await proxmoxRequest<string>(
      `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: params.toString(),
      },
    );

    return NextResponse.json({
      ok: true,
      upid,
      node,
      storage,
      filename,
      isoVolume: `${storage}:iso/${filename}`,
      message: `Téléchargement ISO lancé sur ${storage}.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur Proxmox inconnue",
      },
      { status: 502 },
    );
  }
}
