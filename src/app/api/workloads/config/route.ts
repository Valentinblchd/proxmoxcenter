import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { appendAuditLogEntry, buildAuditActor, type AuditLogChange } from "@/lib/audit/runtime-log";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["qemu", "lxc"]);
const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const STORAGE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const BRIDGE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const CPU_TYPE_PATTERN = /^[a-zA-Z0-9._:-]{2,64}$/;
const OSTYPE_PATTERN = /^[a-zA-Z0-9._-]{2,32}$/;
const UPDATE_LIMIT = {
  windowMs: 5 * 60_000,
  max: 30,
  blockMs: 10 * 60_000,
} as const;

type ConfigBody = {
  node?: unknown;
  vmid?: unknown;
  kind?: unknown;
  name?: unknown;
  memoryMiB?: unknown;
  cores?: unknown;
  sockets?: unknown;
  cpuType?: unknown;
  ostype?: unknown;
  bridge?: unknown;
  primaryDiskKey?: unknown;
  targetStorage?: unknown;
  diskSizeGb?: unknown;
  currentDiskSizeGb?: unknown;
};

function asNonEmptyString(value: unknown, maxLength = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asNullableString(value: unknown, maxLength = 120) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > maxLength) return null;
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

function parseAssignmentList(value: string) {
  const output: Record<string, string> = {};
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || !rawValue) continue;
    output[key] = rawValue;
  }
  return output;
}

function serializeAssignments(assignments: Record<string, string>, preferredOrder: string[] = []) {
  const output: string[] = [];
  const remaining = new Map(Object.entries(assignments).filter(([, value]) => value.trim().length > 0));
  for (const key of preferredOrder) {
    const value = remaining.get(key);
    if (!value) continue;
    output.push(`${key}=${value}`);
    remaining.delete(key);
  }
  for (const [key, value] of [...remaining.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    output.push(`${key}=${value}`);
  }
  return output.join(",");
}

function parseVolumeStorage(value: unknown) {
  if (typeof value !== "string") return null;
  const [storage] = value.split(":");
  return storage?.trim() || null;
}

function pickPrimaryDiskKey(kind: "qemu" | "lxc", config: Record<string, unknown>) {
  if (kind === "lxc" && typeof config.rootfs === "string") return "rootfs";
  const preferred = ["scsi0", "virtio0", "sata0", "ide0"];
  for (const key of preferred) {
    if (typeof config[key] === "string") return key;
  }
  return Object.keys(config).find((key) => /^(scsi|virtio|sata|ide)\d+$/.test(key) && typeof config[key] === "string") ?? null;
}

function updateQemuNetConfig(rawValue: string | null, bridge: string | null) {
  if (!bridge) return null;
  if (!rawValue) return `virtio,bridge=${bridge}`;
  const parts = rawValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0] ?? "virtio";
  const assignments = parseAssignmentList(parts.slice(1).join(","));
  assignments.bridge = bridge;
  return [first, serializeAssignments(assignments)].filter(Boolean).join(",");
}

function updateLxcNetConfig(rawValue: string | null, bridge: string | null) {
  if (!bridge) return null;
  const assignments = rawValue ? parseAssignmentList(rawValue) : {};
  assignments.name = assignments.name || "eth0";
  assignments.bridge = bridge;
  assignments.ip = assignments.ip || "dhcp";
  return serializeAssignments(assignments, ["name", "bridge", "ip", "gw", "ip6", "gw6", "tag", "hwaddr", "mtu", "firewall"]);
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const gate = consumeRateLimit(`workloads:config:${getClientIp(request)}`, UPDATE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "Trop de modifications. Réessaie plus tard." }, { status: 429 });
  }

  let body: ConfigBody;
  try {
    body = (await request.json()) as ConfigBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const node = asNonEmptyString(body.node, 80);
  const kind = asNonEmptyString(body.kind, 16);
  const vmid = asInt(body.vmid);
  if (!node || !kind || vmid === null || !NODE_NAME_PATTERN.test(node) || !VALID_KINDS.has(kind) || vmid < 1 || vmid > 9_999_999) {
    return NextResponse.json({ ok: false, error: "Workload invalide." }, { status: 400 });
  }

  const typedKind = kind as "qemu" | "lxc";
  const name = asNonEmptyString(body.name, 120);
  const memoryMiB = asInt(body.memoryMiB);
  const cores = asInt(body.cores);
  const sockets = typedKind === "qemu" ? asInt(body.sockets) : null;
  const cpuType = asNullableString(body.cpuType, 64);
  const ostype = typedKind === "qemu" ? asNullableString(body.ostype, 32) : null;
  const bridge = asNullableString(body.bridge, 64);
  const primaryDiskKeyInput = asNonEmptyString(body.primaryDiskKey, 40);
  const targetStorage = asNullableString(body.targetStorage, 120);
  const diskSizeGb = asInt(body.diskSizeGb);
  const currentDiskSizeGb = asInt(body.currentDiskSizeGb);

  if (memoryMiB !== null && (memoryMiB < 256 || memoryMiB > 8_388_608)) {
    return NextResponse.json({ ok: false, error: "Mémoire invalide." }, { status: 400 });
  }
  if (cores !== null && (cores < 1 || cores > 256)) {
    return NextResponse.json({ ok: false, error: "Nombre de CPU invalide." }, { status: 400 });
  }
  if (sockets !== null && (sockets < 1 || sockets > 16)) {
    return NextResponse.json({ ok: false, error: "Nombre de sockets invalide." }, { status: 400 });
  }
  if (cpuType !== null && cpuType !== "" && !CPU_TYPE_PATTERN.test(cpuType)) {
    return NextResponse.json({ ok: false, error: "Type CPU invalide." }, { status: 400 });
  }
  if (ostype !== null && ostype !== "" && !OSTYPE_PATTERN.test(ostype)) {
    return NextResponse.json({ ok: false, error: "OS type invalide." }, { status: 400 });
  }
  if (bridge !== null && bridge !== "" && !BRIDGE_NAME_PATTERN.test(bridge)) {
    return NextResponse.json({ ok: false, error: "Bridge invalide." }, { status: 400 });
  }
  if (targetStorage !== null && targetStorage !== "" && !STORAGE_NAME_PATTERN.test(targetStorage)) {
    return NextResponse.json({ ok: false, error: "Stockage cible invalide." }, { status: 400 });
  }

  try {
    const config = await proxmoxRequest<Record<string, unknown>>(
      `nodes/${encodeURIComponent(node)}/${typedKind}/${vmid}/config`,
    );
    const primaryDiskKey = primaryDiskKeyInput ?? pickPrimaryDiskKey(typedKind, config);
    const currentPrimaryStorage = primaryDiskKey ? parseVolumeStorage(config[primaryDiskKey]) : null;
    const currentBridge = typeof config.net0 === "string"
      ? parseAssignmentList(config.net0).bridge ?? null
      : null;
    const currentName =
      typedKind === "qemu"
        ? asNonEmptyString(config.name, 120)
        : asNonEmptyString(config.hostname, 120);

    const params = new URLSearchParams();
    const deleteKeys = new Set<string>();
    const changes: AuditLogChange[] = [];

    if (name && name !== currentName) {
      params.set(typedKind === "qemu" ? "name" : "hostname", name);
      changes.push({ field: "name", before: currentName, after: name });
    }
    if (memoryMiB !== null) {
      const currentMemory = asInt(config.memory);
      if (currentMemory !== memoryMiB) {
        params.set("memory", String(memoryMiB));
        changes.push({ field: "memoryMiB", before: currentMemory === null ? null : String(currentMemory), after: String(memoryMiB) });
      }
    }
    if (cores !== null) {
      const currentCores = asInt(config.cores);
      if (currentCores !== cores) {
        params.set("cores", String(cores));
        changes.push({ field: "cores", before: currentCores === null ? null : String(currentCores), after: String(cores) });
      }
    }
    if (typedKind === "qemu" && sockets !== null) {
      const currentSockets = asInt(config.sockets);
      if (currentSockets !== sockets) {
        params.set("sockets", String(sockets));
        changes.push({ field: "sockets", before: currentSockets === null ? null : String(currentSockets), after: String(sockets) });
      }
    }
    if (typedKind === "qemu" && cpuType !== null) {
      const currentCpu = asNonEmptyString(config.cpu, 64) ?? "";
      if (currentCpu !== cpuType) {
        if (cpuType) {
          params.set("cpu", cpuType);
        } else {
          deleteKeys.add("cpu");
        }
        changes.push({ field: "cpuType", before: currentCpu || null, after: cpuType || null });
      }
    }
    if (typedKind === "qemu" && ostype !== null) {
      const currentOstype = asNonEmptyString(config.ostype, 32) ?? "";
      if (currentOstype !== ostype) {
        if (ostype) {
          params.set("ostype", ostype);
        } else {
          deleteKeys.add("ostype");
        }
        changes.push({ field: "ostype", before: currentOstype || null, after: ostype || null });
      }
    }
    if (bridge !== null) {
      if (bridge === "") {
        if (typeof config.net0 === "string") {
          deleteKeys.add("net0");
          changes.push({ field: "bridge", before: currentBridge, after: null });
        }
      } else if (bridge !== currentBridge) {
        const nextNet0 =
          typedKind === "qemu"
            ? updateQemuNetConfig(typeof config.net0 === "string" ? config.net0 : null, bridge)
            : updateLxcNetConfig(typeof config.net0 === "string" ? config.net0 : null, bridge);
        if (nextNet0) {
          params.set("net0", nextNet0);
          changes.push({ field: "bridge", before: currentBridge, after: bridge });
        }
      }
    }

    if (deleteKeys.size > 0) {
      params.set("delete", [...deleteKeys].join(","));
    }

    if ([...params.keys()].length > 0) {
      await proxmoxRequest<string>(`nodes/${encodeURIComponent(node)}/${typedKind}/${vmid}/config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: params.toString(),
      });
    }

    if (typedKind === "qemu" && primaryDiskKey && diskSizeGb !== null && currentDiskSizeGb !== null && diskSizeGb > currentDiskSizeGb) {
      const delta = diskSizeGb - currentDiskSizeGb;
      await proxmoxRequest<string>(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/resize`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams({
          disk: primaryDiskKey,
          size: `+${delta}G`,
        }).toString(),
      });
      changes.push({ field: "diskSizeGb", before: String(currentDiskSizeGb), after: String(diskSizeGb) });
    }

    if (
      primaryDiskKey &&
      targetStorage &&
      targetStorage !== "" &&
      currentPrimaryStorage &&
      currentPrimaryStorage !== targetStorage
    ) {
      if (typedKind === "qemu") {
        await proxmoxRequest<string>(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/move_disk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          },
          body: new URLSearchParams({
            disk: primaryDiskKey,
            storage: targetStorage,
            delete: "1",
          }).toString(),
        });
      } else {
        await proxmoxRequest<string>(`nodes/${encodeURIComponent(node)}/lxc/${vmid}/move_volume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          },
          body: new URLSearchParams({
            volume: primaryDiskKey,
            storage: targetStorage,
            delete: "1",
          }).toString(),
        });
      }
      changes.push({ field: "storage", before: currentPrimaryStorage, after: targetStorage });
    }

    if (changes.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Aucun changement à appliquer.",
        changes: [],
      });
    }

    appendAuditLogEntry({
      severity: "info",
      category: "workload",
      action: "workload.config.update",
      summary: `Configuration mise à jour sur ${typedKind.toUpperCase()} #${vmid}`,
      actor: buildAuditActor(capability.session),
      targetType: typedKind,
      targetId: String(vmid),
      targetLabel: `${node}/${typedKind}/${vmid}`,
      changes,
      details: {
        node,
        primaryDiskKey: primaryDiskKey ?? "",
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Configuration ${typedKind.toUpperCase()} mise à jour.`,
      changes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible de modifier la configuration.",
      },
      { status: 400 },
    );
  }
}
