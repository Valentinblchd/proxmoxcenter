import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

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
  confirmationText?: unknown;
};

const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const STORAGE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ALLOWED_HTTPS_PORTS = new Set(["", "443", "8443"]);

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asHttpUrl(value: unknown) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      return null;
    }
    if (!ALLOWED_HTTPS_PORTS.has(parsed.port)) return null;
    if (parsed.username || parsed.password || parsed.hash || parsed.search) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasIsoExtension(raw: string) {
  try {
    const parsed = new URL(raw);
    return decodeURIComponent(parsed.pathname).toLowerCase().endsWith(".iso");
  } catch {
    return false;
  }
}

function isPrivateIpv4(ip: string) {
  const octets = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function isForbiddenAddress(hostname: string, address: string) {
  const loweredHost = hostname.trim().toLowerCase();
  if (["localhost", "localhost.localdomain"].includes(loweredHost)) return true;
  if (loweredHost.endsWith(".local") || loweredHost.endsWith(".internal")) return true;

  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isPrivateIpv4(address);
  if (ipVersion === 6) return isPrivateIpv6(address);
  return false;
}

async function assertSafeIsoSourceUrl(isoUrl: string) {
  const parsed = new URL(isoUrl);
  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    throw new Error("URL ISO invalide.");
  }

  const directIpVersion = net.isIP(hostname);
  if (directIpVersion > 0 && isForbiddenAddress(hostname, hostname)) {
    throw new Error(
      "URL ISO refusée: seules des sources HTTPS publiques sont autorisées pour éviter un pivot réseau via Proxmox.",
    );
  }

  if (["localhost", "localhost.localdomain"].includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error(
      "URL ISO refusée: les hôtes locaux/internes sont bloqués pour éviter un pivot réseau via Proxmox.",
    );
  }

  try {
    const results = await lookup(hostname, { all: true });
    if (results.some((entry) => isForbiddenAddress(hostname, entry.address))) {
      throw new Error(
        "URL ISO refusée: la cible résout vers une adresse privée/interne, ce qui est bloqué par sécurité.",
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Impossible de résoudre l’hôte ISO.");
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

  if (!cleaned || !cleaned.toLowerCase().endsWith(".iso")) return null;
  return cleaned;
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
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

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
  const requestedFilename = asNonEmptyString(body.isoFilename);
  const filename = isoUrl ? deriveFilename(isoUrl, requestedFilename) : null;

  if (!node || !storage || !isoUrl || !filename) {
    return NextResponse.json(
      { ok: false, error: "Champs requis: node, storage, isoUrl." },
      { status: 400 },
    );
  }

  if (!NODE_NAME_PATTERN.test(node)) {
    return NextResponse.json({ ok: false, error: "Nom de nœud invalide." }, { status: 400 });
  }

  if (!STORAGE_NAME_PATTERN.test(storage)) {
    return NextResponse.json({ ok: false, error: "Nom de stockage invalide." }, { status: 400 });
  }

  if (!hasIsoExtension(isoUrl)) {
    return NextResponse.json(
      { ok: false, error: "URL ISO invalide: le fichier distant doit se terminer par .iso." },
      { status: 400 },
    );
  }

  if (new URL(isoUrl).search) {
    return NextResponse.json(
      { ok: false, error: "URL ISO invalide: querystring refusée, utilise une URL directe se terminant par .iso." },
      { status: 400 },
    );
  }

  if (requestedFilename && !requestedFilename.toLowerCase().endsWith(".iso")) {
    return NextResponse.json(
      { ok: false, error: "Nom du fichier invalide: extension .iso obligatoire." },
      { status: 400 },
    );
  }

  try {
    assertStrongConfirmation(
      body.confirmationText,
      "IMPORT ISO",
      'Confirmation forte requise. Tape "IMPORT ISO".',
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Confirmation invalide." },
      { status: 400 },
    );
  }

  try {
    await assertSafeIsoSourceUrl(isoUrl);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "URL ISO refusée.",
      },
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
