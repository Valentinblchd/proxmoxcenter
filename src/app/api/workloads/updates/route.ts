import { NextRequest, NextResponse } from "next/server";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["qemu", "lxc"]);
const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const UPDATE_SCAN_LIMIT = {
  windowMs: 60_000,
  max: 20,
  blockMs: 3 * 60_000,
} as const;

type Body = {
  node?: unknown;
  vmid?: unknown;
  kind?: unknown;
};

type GuestExecStatus = {
  exited: boolean;
  exitcode: number | null;
  stdout: string;
  stderr: string;
};

type OsFamily = "windows" | "debian" | "linux" | "unknown";

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

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildExecStartBody(command: string, args: string[], mode: "extra-args" | "arg") {
  const params = new URLSearchParams();
  params.set("command", command);
  params.set("capture-output", "1");
  params.set("synchronous", "0");
  for (const arg of args) {
    params.append(mode, arg);
  }
  return params.toString();
}

function parsePid(payload: unknown) {
  if (typeof payload === "number" && Number.isInteger(payload)) return payload;
  if (typeof payload === "string" && payload.trim()) {
    const parsed = Number.parseInt(payload, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  const record = asRecord(payload);
  if (!record) return null;
  const pid = record.pid;
  if (typeof pid === "number" && Number.isInteger(pid)) return pid;
  if (typeof pid === "string" && pid.trim()) {
    const parsed = Number.parseInt(pid, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function parseExecStatus(payload: unknown): GuestExecStatus | null {
  const record = asRecord(payload);
  if (!record) return null;

  const exitedValue = record.exited;
  const exited = exitedValue === true || exitedValue === 1 || exitedValue === "1";
  const exitCodeValue = record.exitcode;
  const stdout = asString(record["out-data"]) ?? asString(record.stdout) ?? "";
  const stderr = asString(record["err-data"]) ?? asString(record.stderr) ?? "";

  let exitcode: number | null = null;
  if (typeof exitCodeValue === "number" && Number.isInteger(exitCodeValue)) {
    exitcode = exitCodeValue;
  } else if (typeof exitCodeValue === "string" && exitCodeValue.trim()) {
    const parsed = Number.parseInt(exitCodeValue, 10);
    if (Number.isInteger(parsed)) exitcode = parsed;
  }

  return {
    exited,
    exitcode,
    stdout,
    stderr,
  };
}

async function startGuestExec(node: string, vmid: number, command: string, args: string[]) {
  const path = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
  };

  try {
    const payload = await proxmoxRequest<unknown>(path, {
      method: "POST",
      headers,
      body: buildExecStartBody(command, args, "extra-args"),
    });
    const pid = parsePid(payload);
    if (pid !== null) return pid;
  } catch {
    // Fallback below.
  }

  const fallbackPayload = await proxmoxRequest<unknown>(path, {
    method: "POST",
    headers,
    body: buildExecStartBody(command, args, "arg"),
  });
  return parsePid(fallbackPayload);
}

async function fetchExecStatus(node: string, vmid: number, pid: number) {
  const basePath = `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/exec-status`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
  };

  try {
    return await proxmoxRequest<unknown>(basePath, {
      method: "POST",
      headers,
      body: new URLSearchParams({ pid: String(pid) }).toString(),
    });
  } catch {
    return proxmoxRequest<unknown>(`${basePath}?pid=${encodeURIComponent(String(pid))}`);
  }
}

async function guestExec(node: string, vmid: number, command: string, args: string[]) {
  const pid = await startGuestExec(node, vmid, command, args);
  if (pid === null) {
    throw new Error("Impossible de lancer la commande guest-agent.");
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const statusRaw = await fetchExecStatus(node, vmid, pid);
    const status = parseExecStatus(statusRaw);
    if (status?.exited) {
      return status;
    }
    await sleep(900);
  }

  throw new Error("Timeout lors de la récupération du statut guest-agent.");
}

function detectOsFamily(osInfo: Record<string, unknown>) {
  const id = (asString(osInfo.id) ?? "").toLowerCase();
  const name = (asString(osInfo.name) ?? "").toLowerCase();
  const prettyName = (asString(osInfo["pretty-name"]) ?? "").toLowerCase();
  const combined = `${id} ${name} ${prettyName}`;

  if (/(windows|mswindows|win32|win64|microsoft)/.test(combined)) {
    return "windows" as const;
  }
  if (/(debian|ubuntu|linuxmint)/.test(combined)) {
    return "debian" as const;
  }
  if (/(linux|rocky|alma|centos|rhel|fedora|suse|opensuse)/.test(combined)) {
    return "linux" as const;
  }
  return "unknown" as const;
}

function readPendingCount(output: string) {
  const match = output.match(/(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getOsLabel(osInfo: Record<string, unknown>) {
  return (
    asString(osInfo["pretty-name"]) ??
    asString(osInfo.name) ??
    asString(osInfo.id) ??
    "OS inconnu"
  );
}

async function scanDebianUpdates(node: string, vmid: number) {
  const command = "sh";
  const args = [
    "-lc",
    "if command -v apt-get >/dev/null 2>&1; then apt-get update -qq >/dev/null 2>&1 || true; if command -v apt >/dev/null 2>&1; then apt list --upgradable 2>/dev/null | sed '1d' | grep -c '/'; else apt-get -s upgrade 2>/dev/null | awk '/^Inst / {c++} END {print c+0}'; fi; else echo UNSUPPORTED; fi",
  ];
  const result = await guestExec(node, vmid, command, args);
  const raw = (result.stdout || result.stderr || "").trim();
  if (/UNSUPPORTED/i.test(raw)) return null;
  return readPendingCount(raw);
}

async function scanWindowsUpdates(node: string, vmid: number) {
  const command = "powershell.exe";
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$s=New-Object -ComObject Microsoft.Update.Session; $r=$s.CreateUpdateSearcher().Search(\"IsInstalled=0 and Type='Software' and IsHidden=0\"); [Console]::Out.Write($r.Updates.Count)",
  ];
  const result = await guestExec(node, vmid, command, args);
  const raw = (result.stdout || result.stderr || "").trim();
  return readPendingCount(raw);
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden", details: originCheck.reason }, { status: 403 });
  }

  const gate = consumeRateLimit(`workloads:updates:${getClientIp(request)}`, UPDATE_SCAN_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de scans de mises à jour. Réessaie dans quelques instants." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const node = asNonEmptyString(body.node);
  const kind = asNonEmptyString(body.kind);
  const vmid = asInt(body.vmid);

  if (!node || !kind || vmid === null) {
    return NextResponse.json({ ok: false, error: "Missing required fields: node, kind, vmid." }, { status: 400 });
  }

  if (!NODE_NAME_PATTERN.test(node)) {
    return NextResponse.json({ ok: false, error: "Nom de nœud invalide." }, { status: 400 });
  }

  if (vmid < 1 || vmid > 9_999_999) {
    return NextResponse.json({ ok: false, error: "VMID invalide." }, { status: 400 });
  }

  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: `Invalid kind: ${kind}` }, { status: 400 });
  }

  if (kind === "lxc") {
    return NextResponse.json({
      ok: true,
      supported: false,
      osFamily: "linux" satisfies OsFamily,
      pendingCount: null,
      checkedAt: new Date().toISOString(),
      message: "Scan MAJ invité non implémenté pour LXC (VM QEMU uniquement).",
    });
  }

  try {
    const current = await proxmoxRequest<Record<string, unknown>>(
      `nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`,
    );
    const running = asString(current.status) === "running";
    if (!running) {
      return NextResponse.json({
        ok: true,
        supported: false,
        osFamily: "unknown" satisfies OsFamily,
        pendingCount: null,
        checkedAt: new Date().toISOString(),
        message: "VM arrêtée. Démarre la VM pour scanner les mises à jour.",
      });
    }

    const osInfoRaw = await proxmoxRequest<Record<string, unknown>>(
      `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/get-osinfo`,
    );
    const osFamily = detectOsFamily(osInfoRaw);
    const osLabel = getOsLabel(osInfoRaw);

    if (osFamily === "debian") {
      const pendingCount = await scanDebianUpdates(node, vmid);
      if (pendingCount === null) {
        return NextResponse.json({
          ok: true,
          supported: false,
          osFamily,
          osLabel,
          pendingCount: null,
          checkedAt: new Date().toISOString(),
          message: "Apt non détecté dans la VM. Scan indisponible.",
        });
      }
      return NextResponse.json({
        ok: true,
        supported: true,
        osFamily,
        osLabel,
        pendingCount,
        checkedAt: new Date().toISOString(),
        message:
          pendingCount > 0
            ? `${pendingCount} mise(s) à jour disponible(s).`
            : "Aucune mise à jour disponible.",
      });
    }

    if (osFamily === "windows") {
      const pendingCount = await scanWindowsUpdates(node, vmid);
      if (pendingCount === null) {
        return NextResponse.json({
          ok: true,
          supported: false,
          osFamily,
          osLabel,
          pendingCount: null,
          checkedAt: new Date().toISOString(),
          message: "Impossible de lire Windows Update via guest-agent.",
        });
      }
      return NextResponse.json({
        ok: true,
        supported: true,
        osFamily,
        osLabel,
        pendingCount,
        checkedAt: new Date().toISOString(),
        message:
          pendingCount > 0
            ? `${pendingCount} mise(s) à jour disponible(s).`
            : "Aucune mise à jour disponible.",
      });
    }

    return NextResponse.json({
      ok: true,
      supported: false,
      osFamily,
      osLabel,
      pendingCount: null,
      checkedAt: new Date().toISOString(),
      message: "OS invité non supporté pour le scan automatique (Windows/Debian).",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur scan mises à jour invité.",
      },
      { status: 502 },
    );
  }
}
