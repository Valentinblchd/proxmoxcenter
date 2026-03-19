import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";

type WorkloadKind = "qemu" | "lxc";

type ProxmoxClusterResource = {
  id: string;
  type: string;
  node?: string;
  status?: string;
  name?: string;
  vmid?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: number;
};

type ProxmoxNodeNetwork = {
  iface?: string;
  type?: string;
  method?: string;
  address?: string;
  cidr?: string | number;
  active?: boolean | number;
  mtu?: string | number;
  comments?: string;
  bridge_ports?: string;
  bridge_vlan_aware?: boolean | number;
};

type ProxmoxNodeStorage = {
  storage?: string;
  type?: string;
  content?: string | string[];
  shared?: boolean | number;
  enabled?: boolean | number;
  active?: boolean | number;
  used?: number;
  total?: number;
  avail?: number;
};

type ProxmoxNodeRrdPoint = {
  netin?: number;
  netout?: number;
};

export type NodeHostedWorkload = {
  kind: WorkloadKind;
  vmid: number;
  name: string;
  status: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptimeSeconds: number;
};

export type NodeNetworkDetail = {
  name: string;
  type: string | null;
  address: string | null;
  method: string | null;
  mtu: string | null;
  active: boolean | null;
  bridgePorts: string | null;
  vlanAware: boolean | null;
  comments: string | null;
};

export type NodeStorageDetail = {
  name: string;
  type: string | null;
  content: string | null;
  shared: boolean | null;
  enabled: boolean | null;
  active: boolean | null;
  used: number;
  total: number;
  available: number;
};

export type NodeDetail = {
  name: string;
  status: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  networkInBytesPerSecond: number;
  networkOutBytesPerSecond: number;
  uptimeSeconds: number;
  summary: {
    workloads: number;
    running: number;
    vms: number;
    cts: number;
  };
  workloads: NodeHostedWorkload[];
  networks: NodeNetworkDetail[];
  storages: NodeStorageDetail[];
  navigation: {
    previous: { name: string } | null;
    next: { name: string } | null;
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

function asNullableBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

function clampRatio(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function resolveNodeName(resource: ProxmoxClusterResource) {
  return resource.node ?? resource.name ?? resource.id;
}

function parseNodeNetworks(payload: unknown) {
  if (!Array.isArray(payload)) return [] as NodeNetworkDetail[];

  return payload
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const name = asString(record.iface);
      if (!name) return null;
      const address = asString(record.address);
      const cidr = record.cidr;
      const addressLabel =
        address && (typeof cidr === "number" || typeof cidr === "string")
          ? `${address}/${String(cidr)}`
          : address ?? null;

      return {
        name,
        type: asString(record.type),
        address: addressLabel,
        method: asString(record.method),
        mtu:
          asString(record.mtu) ??
          (typeof record.mtu === "number" && Number.isFinite(record.mtu) ? String(record.mtu) : null),
        active: asNullableBool(record.active),
        bridgePorts: asString(record.bridge_ports),
        vlanAware: asNullableBool(record.bridge_vlan_aware),
        comments: asString(record.comments),
      } satisfies NodeNetworkDetail;
    })
    .filter((entry): entry is NodeNetworkDetail => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function parseNodeStorages(payload: unknown) {
  if (!Array.isArray(payload)) return [] as NodeStorageDetail[];

  return payload
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const name = asString(record.storage);
      if (!name) return null;
      const contentValue = record.content;

      return {
        name,
        type: asString(record.type),
        content: Array.isArray(contentValue)
          ? contentValue.filter((item): item is string => typeof item === "string").join(", ")
          : asString(contentValue),
        shared: asNullableBool(record.shared),
        enabled: asNullableBool(record.enabled),
        active: asNullableBool(record.active),
        used: asNumber(record.used),
        total: asNumber(record.total),
        available: asNumber(record.avail),
      } satisfies NodeStorageDetail;
    })
    .filter((entry): entry is NodeStorageDetail => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function readLatestNodeNetworkRates(nodeName: string) {
  const history = await proxmoxRequest<ProxmoxNodeRrdPoint[]>(
    `nodes/${encodeURIComponent(nodeName)}/rrddata?timeframe=hour&cf=AVERAGE`,
  ).catch(() => []);
  const point = Array.isArray(history)
    ? [...history].reverse().find((entry) => typeof entry.netin === "number" || typeof entry.netout === "number")
    : null;

  return {
    netIn: point && typeof point.netin === "number" && Number.isFinite(point.netin) ? Math.max(0, point.netin) : 0,
    netOut: point && typeof point.netout === "number" && Number.isFinite(point.netout) ? Math.max(0, point.netout) : 0,
  };
}

export async function getNodeDetailByName(nodeName: string): Promise<NodeDetail | null> {
  const resources = await proxmoxRequest<ProxmoxClusterResource[]>("cluster/resources");
  const nodeResources = resources
    .filter((item) => item.type === "node")
    .sort((a, b) =>
      resolveNodeName(a).localeCompare(resolveNodeName(b), undefined, { numeric: true }),
    );

  const resource = nodeResources.find((item) => resolveNodeName(item) === nodeName);
  if (!resource) return null;

  const navigationItems = nodeResources.map((item) => ({ name: resolveNodeName(item) }));
  const navigationIndex = navigationItems.findIndex((item) => item.name === nodeName);

  const workloads = resources
    .filter(
      (item): item is ProxmoxClusterResource & { vmid: number; node: string } =>
        (item.type === "qemu" || item.type === "lxc") &&
        item.template !== 1 &&
        typeof item.vmid === "number" &&
        typeof item.node === "string" &&
        item.node === nodeName,
    )
    .map((item) => ({
      kind: item.type as WorkloadKind,
      vmid: item.vmid,
      name: item.name ?? `${item.type}-${item.vmid}`,
      status: item.status ?? "unknown",
      cpuLoad: clampRatio(item.cpu),
      memoryUsed: asNumber(item.mem),
      memoryTotal: asNumber(item.maxmem),
      diskUsed: asNumber(item.disk),
      diskTotal: asNumber(item.maxdisk),
      uptimeSeconds: asNumber(item.uptime),
    }))
    .sort((a, b) => a.vmid - b.vmid);

  const [networkResult, storageResult, latestNetworkRates] = await Promise.all([
    proxmoxRequest<ProxmoxNodeNetwork[]>(`nodes/${encodeURIComponent(nodeName)}/network`).catch(() => []),
    proxmoxRequest<ProxmoxNodeStorage[]>(`nodes/${encodeURIComponent(nodeName)}/storage`).catch(() => []),
    readLatestNodeNetworkRates(nodeName),
  ]);

  return {
    name: nodeName,
    status: resource.status ?? "unknown",
    cpuLoad: clampRatio(resource.cpu),
    memoryUsed: asNumber(resource.mem),
    memoryTotal: asNumber(resource.maxmem),
    diskUsed: asNumber(resource.disk),
    diskTotal: asNumber(resource.maxdisk),
    networkInBytesPerSecond: latestNetworkRates.netIn,
    networkOutBytesPerSecond: latestNetworkRates.netOut,
    uptimeSeconds: asNumber(resource.uptime),
    summary: {
      workloads: workloads.length,
      running: workloads.filter((item) => item.status === "running").length,
      vms: workloads.filter((item) => item.kind === "qemu").length,
      cts: workloads.filter((item) => item.kind === "lxc").length,
    },
    workloads,
    networks: parseNodeNetworks(networkResult),
    storages: parseNodeStorages(storageResult),
    navigation: {
      previous: navigationIndex > 0 ? navigationItems[navigationIndex - 1] : null,
      next:
        navigationIndex >= 0 && navigationIndex < navigationItems.length - 1
          ? navigationItems[navigationIndex + 1]
          : null,
    },
  };
}
