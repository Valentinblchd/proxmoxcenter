import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";

export type WorkloadKind = "qemu" | "lxc";
export type WorkloadOsFamily = "windows" | "linux" | "unknown";

type ProxmoxClusterResource = {
  id: string;
  type: string;
  node?: string;
  status?: string;
  name?: string;
  vmid?: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
};

export type WorkloadRemoteAccessDetails = {
  running: boolean;
  osFamily: WorkloadOsFamily;
  osLabel: string | null;
  guestIps: string[];
  primaryIp: string | null;
  bridge: string | null;
  vlanTag: string | null;
  qemuAgentEnabled: boolean | null;
  preferredAccess: "rdp" | "ssh";
  remoteReady: boolean;
  reason: string;
};

export type WorkloadDiskDetail = {
  key: string;
  interfaceType: string;
  label: string;
  volume: string;
  size: string | null;
  media: string | null;
  mountPoint: string | null;
  options: string[];
};

export type WorkloadNicDetail = {
  key: string;
  label: string;
  model: string | null;
  mac: string | null;
  bridge: string | null;
  vlanTag: string | null;
  firewall: boolean | null;
  rateLimit: string | null;
  mtu: string | null;
  name: string | null;
  ipConfig: string | null;
};

export type WorkloadSnapshotDetail = {
  name: string;
  description: string | null;
  createdAt: string | null;
  vmState: boolean | null;
  parent: string | null;
  current: boolean;
};

export type WorkloadDetail = {
  id: string;
  kind: WorkloadKind;
  vmid: number;
  name: string;
  node: string;
  status: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptimeSeconds: number;
  tags: string[];
  bios: string | null;
  machine: string | null;
  ostype: string | null;
  cores: string | null;
  sockets: string | null;
  cpuType: string | null;
  bootOrder: string | null;
  agentEnabled: boolean | null;
  remoteAccess: WorkloadRemoteAccessDetails;
  disks: WorkloadDiskDetail[];
  nics: WorkloadNicDetail[];
  snapshots: WorkloadSnapshotDetail[];
  navigation: {
    previous: { kind: WorkloadKind; vmid: number; name: string } | null;
    next: { kind: WorkloadKind; vmid: number; name: string } | null;
  };
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampRatio(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function isTruthyFlag(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isUsefulIp(value: string) {
  return !(
    value.startsWith("127.") ||
    value.startsWith("169.254.") ||
    value === "::1" ||
    value.startsWith("fe80:")
  );
}

function normalizeIp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutMask = trimmed.split("/")[0]?.trim() ?? "";
  if (!withoutMask || !isUsefulIp(withoutMask)) return null;
  return withoutMask;
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
    if (key && rawValue) output[key] = rawValue;
  }
  return output;
}

function parseVolumeValue(value: string) {
  const [volume, ...rest] = value.split(",");
  const options = parseAssignmentList(rest.join(","));
  return {
    volume: volume?.trim() ?? "",
    options,
  };
}

function parseGuestIps(payload: unknown) {
  const output = new Set<string>();
  const interfaces = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.result)
      ? (asRecord(payload)?.result as unknown[])
      : [];

  for (const entry of interfaces) {
    const record = asRecord(entry);
    if (!record) continue;
    const ipAddresses = Array.isArray(record["ip-addresses"]) ? record["ip-addresses"] : [];
    for (const ipEntry of ipAddresses) {
      const ipRecord = asRecord(ipEntry);
      const ip = normalizeIp(asString(ipRecord?.["ip-address"]) ?? "");
      if (ip) output.add(ip);
    }
  }

  return [...output];
}

function inferOsFamily(kind: WorkloadKind, config: Record<string, unknown> | null, osInfo: Record<string, unknown> | null) {
  if (kind === "lxc") return "linux" as const;

  const combined = [
    asString(osInfo?.id),
    asString(osInfo?.name),
    asString(osInfo?.["pretty-name"]),
    asString(config?.ostype),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(windows|win11|win10|win8|win7|w2k)/.test(combined)) return "windows" as const;
  if (/(linux|debian|ubuntu|alma|rocky|centos|fedora|suse|opensuse|l26|l24)/.test(combined)) {
    return "linux" as const;
  }
  return "unknown" as const;
}

function readOsLabel(kind: WorkloadKind, config: Record<string, unknown> | null, osInfo: Record<string, unknown> | null) {
  return (
    asString(osInfo?.["pretty-name"]) ??
    asString(osInfo?.name) ??
    asString(config?.ostype) ??
    (kind === "lxc" ? "Linux container" : null)
  );
}

function parseNetworkHints(kind: WorkloadKind, config: Record<string, unknown> | null) {
  if (!config) {
    return {
      bridge: null,
      vlanTag: null,
      staticIps: [] as string[],
      qemuAgentEnabled: null as boolean | null,
    };
  }

  let bridge: string | null = null;
  let vlanTag: string | null = null;
  const staticIps = new Set<string>();

  for (const [key, rawValue] of Object.entries(config)) {
    if ((key.startsWith("net") || key.startsWith("ipconfig")) && typeof rawValue === "string") {
      const assignments = parseAssignmentList(rawValue);
      if (!bridge && assignments.bridge) bridge = assignments.bridge;
      if (!vlanTag && assignments.tag) vlanTag = assignments.tag;
      const directIp = normalizeIp(assignments.ip ?? "");
      if (directIp) staticIps.add(directIp);
    }
  }

  const qemuAgentRaw = config.agent;
  const qemuAgentEnabled =
    kind === "qemu"
      ? typeof qemuAgentRaw === "string"
        ? qemuAgentRaw.split(",").some((part) => isTruthyFlag(part.split("=")[1] ?? part))
        : isTruthyFlag(qemuAgentRaw)
      : null;

  return {
    bridge,
    vlanTag,
    staticIps: [...staticIps],
    qemuAgentEnabled,
  };
}

function detectNetworkModel(assignments: Record<string, string>) {
  const reserved = new Set([
    "bridge",
    "tag",
    "firewall",
    "rate",
    "queues",
    "name",
    "hwaddr",
    "ip",
    "gw",
    "mtu",
    "trunks",
    "link_down",
    "ip6",
    "gw6",
    "type",
  ]);

  for (const [key, value] of Object.entries(assignments)) {
    if (!reserved.has(key)) {
      return { model: key, mac: value };
    }
  }

  return { model: null, mac: assignments.hwaddr ?? null };
}

function parseWorkloadDisks(kind: WorkloadKind, config: Record<string, unknown> | null) {
  if (!config) return [] as WorkloadDiskDetail[];

  const diskKeys = Object.keys(config)
    .filter((key) =>
      /^(?:ide|sata|scsi|virtio|unused)\d+$/.test(key) ||
      /^(?:efidisk|tpmstate)\d+$/.test(key) ||
      key === "rootfs" ||
      /^mp\d+$/.test(key),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const disks: WorkloadDiskDetail[] = [];
  for (const key of diskKeys) {
    const rawValue = asString(config[key]);
    if (!rawValue) continue;
    const parsed = parseVolumeValue(rawValue);
    const optionPairs = Object.entries(parsed.options)
      .filter(([name]) => !["size", "media", "mp"].includes(name))
      .map(([name, value]) => `${name}=${value}`);

    disks.push({
        key,
        interfaceType:
          key === "rootfs"
            ? "rootfs"
            : /^mp\d+$/.test(key)
              ? "mountpoint"
              : key.replace(/\d+$/, ""),
        label: key.toUpperCase(),
        volume: parsed.volume || "—",
        size: parsed.options.size ?? null,
        media: parsed.options.media ?? null,
        mountPoint: parsed.options.mp ?? null,
        options: optionPairs,
      });
  }

  return disks;
}

function parseWorkloadNics(config: Record<string, unknown> | null) {
  if (!config) return [] as WorkloadNicDetail[];

  const nicKeys = Object.keys(config)
    .filter((key) => /^net\d+$/.test(key))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const nics: WorkloadNicDetail[] = [];
  for (const [index, key] of nicKeys.entries()) {
    const rawValue = asString(config[key]);
    if (!rawValue) continue;
    const assignments = parseAssignmentList(rawValue);
    const modelData = detectNetworkModel(assignments);

    nics.push({
        key,
        label: `NIC ${index}`,
        model: modelData.model,
        mac: modelData.mac,
        bridge: assignments.bridge ?? null,
        vlanTag: assignments.tag ?? null,
        firewall:
          assignments.firewall === undefined ? null : isTruthyFlag(assignments.firewall),
        rateLimit: assignments.rate ?? null,
        mtu: assignments.mtu ?? null,
        name: assignments.name ?? null,
        ipConfig: assignments.ip ?? assignments.ip6 ?? null,
      });
  }

  return nics;
}

function parseSnapshots(payload: unknown) {
  if (!Array.isArray(payload)) return [] as WorkloadSnapshotDetail[];

  return payload
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      const name = asString(record.name) ?? asString(record.snapname) ?? null;
      if (!name || name === "current") return null;

      const createdRaw = record.snaptime;
      const createdAt =
        typeof createdRaw === "number" && Number.isFinite(createdRaw) && createdRaw > 0
          ? new Date(createdRaw * 1000).toISOString()
          : asString(record.snaptime) ?? null;

      return {
        name,
        description: asString(record.description) ?? null,
        createdAt,
        vmState:
          record.vmstate === undefined
            ? null
            : record.vmstate === 1 || record.vmstate === true || record.vmstate === "1",
        parent: asString(record.parent) ?? null,
        current:
          record.current === true ||
          record.current === 1 ||
          record.current === "1" ||
          name === "current",
      } satisfies WorkloadSnapshotDetail;
    })
    .filter((item): item is WorkloadSnapshotDetail => item !== null);
}

export async function getWorkloadDetailById(options: {
  kind: WorkloadKind;
  vmid: number;
}): Promise<WorkloadDetail | null> {
  const resources = await proxmoxRequest<ProxmoxClusterResource[]>("cluster/resources");
  const navigationItems = resources
    .filter(
      (item): item is ProxmoxClusterResource & { vmid: number; node: string } =>
        (item.type === "qemu" || item.type === "lxc") &&
        item.template !== 1 &&
        typeof item.vmid === "number" &&
        typeof item.node === "string",
    )
    .sort((a, b) => a.vmid - b.vmid)
    .map((item) => ({
      kind: item.type as WorkloadKind,
      vmid: item.vmid,
      name: item.name ?? `${item.type}-${item.vmid}`,
    }));
  const resource = resources.find(
    (item) => item.type === options.kind && item.template !== 1 && item.vmid === options.vmid,
  );

  if (!resource || !resource.node) return null;

  const node = resource.node;
  const [configResult, snapshotsResult, remoteAccess] = await Promise.all([
    proxmoxRequest<Record<string, unknown>>(
      `nodes/${encodeURIComponent(node)}/${options.kind}/${options.vmid}/config`,
    ).catch(() => null),
    proxmoxRequest<unknown[]>(
      `nodes/${encodeURIComponent(node)}/${options.kind}/${options.vmid}/snapshot`,
    ).catch(() => []),
    getWorkloadRemoteAccessDetails({ node, vmid: options.vmid, kind: options.kind }),
  ]);

  const config = configResult;
  const navigationIndex = navigationItems.findIndex(
    (item) => item.kind === options.kind && item.vmid === options.vmid,
  );
  const previous = navigationIndex > 0 ? navigationItems[navigationIndex - 1] : null;
  const next =
    navigationIndex >= 0 && navigationIndex < navigationItems.length - 1
      ? navigationItems[navigationIndex + 1]
      : null;

  return {
    id: resource.id,
    kind: options.kind,
    vmid: options.vmid,
    name: resource.name ?? `${options.kind}-${options.vmid}`,
    node,
    status: resource.status ?? "unknown",
    cpuLoad: clampRatio(resource.cpu),
    memoryUsed: asNumber(resource.mem),
    memoryTotal: asNumber(resource.maxmem),
    diskUsed: asNumber(resource.disk),
    diskTotal: asNumber(resource.maxdisk),
    uptimeSeconds: asNumber(resource.uptime),
    tags: [options.kind === "qemu" ? "qemu" : "lxc"],
    bios: asString(config?.bios) ?? null,
    machine: asString(config?.machine) ?? null,
    ostype: asString(config?.ostype) ?? null,
    cores: asString(config?.cores) ?? (typeof config?.cores === "number" ? String(config.cores) : null),
    sockets:
      asString(config?.sockets) ?? (typeof config?.sockets === "number" ? String(config.sockets) : null),
    cpuType: asString(config?.cpu) ?? null,
    bootOrder: asString(config?.boot) ?? null,
    agentEnabled: remoteAccess.qemuAgentEnabled,
    remoteAccess,
    disks: parseWorkloadDisks(options.kind, config),
    nics: parseWorkloadNics(config),
    snapshots: parseSnapshots(snapshotsResult),
    navigation: {
      previous,
      next,
    },
  };
}

export async function getWorkloadRemoteAccessDetails(options: {
  node: string;
  vmid: number;
  kind: WorkloadKind;
}): Promise<WorkloadRemoteAccessDetails> {
  const { node, vmid, kind } = options;

  const [currentResult, configResult] = await Promise.allSettled([
    proxmoxRequest<Record<string, unknown>>(`nodes/${encodeURIComponent(node)}/${kind}/${vmid}/status/current`),
    proxmoxRequest<Record<string, unknown>>(`nodes/${encodeURIComponent(node)}/${kind}/${vmid}/config`),
  ]);

  const current = currentResult.status === "fulfilled" ? currentResult.value : null;
  const config = configResult.status === "fulfilled" ? configResult.value : null;
  const running = asString(current?.status) === "running";

  let osInfo: Record<string, unknown> | null = null;
  let guestIps: string[] = [];

  if (kind === "qemu" && running) {
    const [osInfoResult, interfacesResult] = await Promise.allSettled([
      proxmoxRequest<Record<string, unknown>>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/get-osinfo`,
      ),
      proxmoxRequest<unknown[]>(
        `nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`,
      ),
    ]);

    osInfo = osInfoResult.status === "fulfilled" ? osInfoResult.value : null;
    guestIps = interfacesResult.status === "fulfilled" ? parseGuestIps(interfacesResult.value) : [];
  }

  const { bridge, vlanTag, staticIps, qemuAgentEnabled } = parseNetworkHints(kind, config);
  const mergedIps = [...new Set([...guestIps, ...staticIps])];
  const osFamily = inferOsFamily(kind, config, osInfo);
  const preferredAccess = osFamily === "windows" ? "rdp" : "ssh";

  let reason = "Accès prêt";
  if (!running) {
    reason = "Workload arrêtée";
  } else if (mergedIps.length === 0) {
    reason =
      kind === "qemu"
        ? "IP invitée non remontée. Vérifie le guest agent ou renseigne l’adresse manuellement."
        : "IP non remontée. Renseigne l’adresse manuellement si nécessaire.";
  }

  return {
    running,
    osFamily,
    osLabel: readOsLabel(kind, config, osInfo),
    guestIps: mergedIps,
    primaryIp: mergedIps[0] ?? null,
    bridge,
    vlanTag,
    qemuAgentEnabled,
    preferredAccess,
    remoteReady: running && mergedIps.length > 0,
    reason,
  };
}
