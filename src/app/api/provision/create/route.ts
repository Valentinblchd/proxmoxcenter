import { NextRequest, NextResponse } from "next/server";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_LIMIT = {
  windowMs: 5 * 60_000,
  max: 15,
  blockMs: 10 * 60_000,
} as const;

type ProvisionCreateBody = {
  kind?: unknown;
  node?: unknown;
  vmid?: unknown;
  name?: unknown;
  memoryMiB?: unknown;
  cores?: unknown;
  sockets?: unknown;
  diskGb?: unknown;
  storage?: unknown;
  bridge?: unknown;
  ostype?: unknown;
  cpuType?: unknown;
  isoVolume?: unknown;
  bios?: unknown;
  machine?: unknown;
  enableAgent?: unknown;
  enableTpm?: unknown;
  lxcTemplate?: unknown;
  lxcSwapMiB?: unknown;
  lxcPassword?: unknown;
  lxcUnprivileged?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeQemuFirmware(body: ProvisionCreateBody) {
  const bios = body.bios === "seabios" ? "seabios" : "ovmf";
  const requestedMachine = body.machine === "i440fx" ? "i440fx" : "q35";
  const enableTpm = bios === "ovmf" ? asBoolean(body.enableTpm, false) : false;

  // Keep generic chipset names so Proxmox selects a compatible QEMU machine
  // for the host version instead of pinning an incompatible hardcoded release.
  const machine = bios === "ovmf" ? "q35" : requestedMachine;

  return { bios, machine, enableTpm };
}

function validateCommon(body: ProvisionCreateBody) {
  const kind = body.kind === "lxc" ? "lxc" : body.kind === "qemu" ? "qemu" : null;
  const node = asNonEmptyString(body.node);
  const vmid = asPositiveInt(body.vmid);
  const name = asNonEmptyString(body.name);
  const memoryMiB = asPositiveInt(body.memoryMiB);
  const cores = asPositiveInt(body.cores);
  const diskGb = asPositiveInt(body.diskGb);
  const storage = asNonEmptyString(body.storage);
  const bridge = asNonEmptyString(body.bridge);

  if (!kind || !node || !vmid || !name || !memoryMiB || !cores || !diskGb || !storage || !bridge) {
    return null;
  }

  return { kind, node, vmid, name, memoryMiB, cores, diskGb, storage, bridge };
}

function createQemuParams(body: ProvisionCreateBody, common: ReturnType<typeof validateCommon>) {
  if (!common || common.kind !== "qemu") return null;
  const sockets = asPositiveInt(body.sockets) ?? 1;
  const ostype = asNonEmptyString(body.ostype) ?? "l26";
  const cpuType = asNonEmptyString(body.cpuType) ?? "host";
  const isoVolume = asNonEmptyString(body.isoVolume);
  const { bios, machine, enableTpm } = normalizeQemuFirmware(body);
  const enableAgent = asBoolean(body.enableAgent, true);

  const params = new URLSearchParams();
  params.set("vmid", String(common.vmid));
  params.set("name", common.name);
  params.set("memory", String(common.memoryMiB));
  params.set("cores", String(common.cores));
  params.set("sockets", String(sockets));
  params.set("ostype", ostype);
  params.set("cpu", cpuType);
  params.set("scsihw", "virtio-scsi-pci");
  params.set("scsi0", `${common.storage}:${common.diskGb}`);
  params.set("net0", `virtio,bridge=${common.bridge}`);
  params.set("machine", machine);
  params.set("bios", bios);
  params.set("agent", enableAgent ? "1" : "0");
  params.set("onboot", "1");

  if (isoVolume) {
    params.set("ide2", `${isoVolume},media=cdrom`);
    params.set("boot", "order=scsi0;ide2;net0");
  } else {
    params.set("boot", "order=scsi0;net0");
  }

  if (enableTpm && bios === "ovmf") {
    params.set("tpmstate0", `${common.storage}:4,version=v2.0`);
  }

  if (bios === "ovmf") {
    params.set("efidisk0", `${common.storage}:1,pre-enrolled-keys=1`);
  }

  return params;
}

function createLxcParams(body: ProvisionCreateBody, common: ReturnType<typeof validateCommon>) {
  if (!common || common.kind !== "lxc") return null;
  const template = asNonEmptyString(body.lxcTemplate);
  if (!template) return null;

  const swapMiB = asPositiveInt(body.lxcSwapMiB) ?? 512;
  const password = asNonEmptyString(body.lxcPassword);
  const unprivileged = asBoolean(body.lxcUnprivileged, true);

  const params = new URLSearchParams();
  params.set("vmid", String(common.vmid));
  params.set("hostname", common.name);
  params.set("memory", String(common.memoryMiB));
  params.set("cores", String(common.cores));
  params.set("swap", String(swapMiB));
  params.set("rootfs", `${common.storage}:${common.diskGb}`);
  params.set("ostemplate", template);
  params.set("net0", `name=eth0,bridge=${common.bridge},ip=dhcp`);
  params.set("unprivileged", unprivileged ? "1" : "0");
  params.set("onboot", "1");
  if (password) {
    params.set("password", password);
  }

  return params;
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden", details: originCheck.reason },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`provision:create:${getClientIp(request)}`, CREATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de créations/tentatives. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: ProvisionCreateBody;
  try {
    body = (await request.json()) as ProvisionCreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const common = validateCommon(body);
  if (!common) {
    return NextResponse.json(
      { ok: false, error: "Champs requis manquants (kind/node/vmid/name/memory/cores/disk/storage/bridge)." },
      { status: 400 },
    );
  }

  const params =
    common.kind === "qemu" ? createQemuParams(body, common) : createLxcParams(body, common);

  if (!params) {
    return NextResponse.json(
      {
        ok: false,
        error:
          common.kind === "lxc"
            ? "Template LXC requis (`lxcTemplate`)."
            : "Impossible de construire la création VM.",
      },
      { status: 400 },
    );
  }

  try {
    const upid = await proxmoxRequest<string>(`nodes/${encodeURIComponent(common.node)}/${common.kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: params.toString(),
    });

    return NextResponse.json({
      ok: true,
      upid,
      node: common.node,
      kind: common.kind,
      vmid: common.vmid,
      name: common.name,
      message: `${common.kind === "qemu" ? "VM" : "LXC"} #${common.vmid} création lancée.`,
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
