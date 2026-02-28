import "server-only";
import { proxmoxRequest, ProxmoxConfigError } from "@/lib/proxmox/client";
import { getProxmoxConfig } from "@/lib/proxmox/config";

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

export type DashboardNode = {
  name: string;
  status: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
};

export type DashboardWorkload = {
  id: string;
  kind: "qemu" | "lxc";
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
};

export type DashboardSnapshot = {
  mode: "offline" | "live";
  lastUpdatedAt: string;
  warnings: string[];
  summary: {
    nodes: number;
    vms: number;
    cts: number;
    running: number;
  };
  nodes: DashboardNode[];
  workloads: DashboardWorkload[];
};

function clampRatio(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function asNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildOfflineSnapshot(warnings: string[] = []): DashboardSnapshot {
  const now = new Date().toISOString();
  const nodes: DashboardNode[] = [];
  const workloads: DashboardWorkload[] = [];

  return {
    mode: "offline",
    lastUpdatedAt: now,
    warnings,
    summary: {
      nodes: nodes.length,
      vms: workloads.filter((w) => w.kind === "qemu").length,
      cts: workloads.filter((w) => w.kind === "lxc").length,
      running: workloads.filter((w) => w.status === "running").length,
    },
    nodes,
    workloads,
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const config = getProxmoxConfig();
  if (!config) {
    return buildOfflineSnapshot(["Aucune donnée Proxmox disponible pour le moment."]);
  }

  try {
    const resources = await proxmoxRequest<ProxmoxClusterResource[]>("cluster/resources");

    const nodes = resources
      .filter((resource) => resource.type === "node")
      .map((resource) => ({
        name: resource.node ?? resource.name ?? resource.id,
        status: resource.status ?? "unknown",
        cpuLoad: clampRatio(resource.cpu),
        memoryUsed: asNumber(resource.mem),
        memoryTotal: asNumber(resource.maxmem),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const workloads = resources
      .filter(
        (resource): resource is ProxmoxClusterResource & { vmid: number } =>
          (resource.type === "qemu" || resource.type === "lxc") &&
          typeof resource.vmid === "number" &&
          resource.template !== 1,
      )
      .map((resource) => ({
        id: resource.id,
        kind: resource.type as "qemu" | "lxc",
        vmid: resource.vmid,
        name: resource.name ?? `${resource.type}-${resource.vmid}`,
        node: resource.node ?? "unknown",
        status: resource.status ?? "unknown",
        cpuLoad: clampRatio(resource.cpu),
        memoryUsed: asNumber(resource.mem),
        memoryTotal: asNumber(resource.maxmem),
        diskUsed: asNumber(resource.disk),
        diskTotal: asNumber(resource.maxdisk),
        uptimeSeconds: asNumber(resource.uptime),
      }))
      .sort((a, b) => {
        if (a.status === "running" && b.status !== "running") return -1;
        if (a.status !== "running" && b.status === "running") return 1;
        return b.cpuLoad - a.cpuLoad;
      })
      .slice(0, 300);

    return {
      mode: "live",
      lastUpdatedAt: new Date().toISOString(),
      warnings: [],
      summary: {
        nodes: nodes.length,
        vms: resources.filter((resource) => resource.type === "qemu").length,
        cts: resources.filter((resource) => resource.type === "lxc").length,
        running: resources.filter(
          (resource) =>
            (resource.type === "qemu" || resource.type === "lxc") &&
            resource.status === "running",
        ).length,
      },
      nodes,
      workloads,
    };
  } catch (error) {
    const details =
      error instanceof ProxmoxConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Erreur inconnue";

    return buildOfflineSnapshot([`Connexion Proxmox indisponible: ${details}`]);
  }
}
