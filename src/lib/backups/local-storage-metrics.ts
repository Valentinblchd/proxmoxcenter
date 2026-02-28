import "server-only";
import { ProxmoxConfigError, proxmoxRequest } from "@/lib/proxmox/client";
import { getProxmoxConfig } from "@/lib/proxmox/config";

type ProxmoxStorageResource = {
  id?: string;
  type?: string;
  node?: string;
  storage?: string;
  status?: string;
  content?: string;
  disk?: number;
  maxdisk?: number;
  shared?: number;
};

export type LocalBackupStorageMetrics = {
  id: string;
  node: string | null;
  storage: string;
  usedBytes: number | null;
  totalBytes: number | null;
  freeBytes: number | null;
  usageRatio: number | null;
  shared: boolean;
  source: string;
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toSafeBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function hasBackupContent(content: string | undefined) {
  if (typeof content !== "string") return false;
  return content
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes("backup");
}

function normalizeStorageResource(item: ProxmoxStorageResource): LocalBackupStorageMetrics | null {
  const storage = typeof item.storage === "string" ? item.storage.trim() : "";
  if (!storage) return null;

  const node = typeof item.node === "string" && item.node.trim() ? item.node.trim() : null;
  const identifier = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `${node ?? "cluster"}/${storage}`;
  const used = toNumber(item.disk);
  const total = toNumber(item.maxdisk);
  const free = used !== null && total !== null ? Math.max(0, total - used) : null;
  const usageRatio =
    used !== null && total !== null && total > 0
      ? Math.max(0, Math.min(used / total, 1))
      : null;

  return {
    id: identifier,
    node,
    storage,
    usedBytes: used === null ? null : toSafeBytes(used),
    totalBytes: total === null ? null : toSafeBytes(total),
    freeBytes: free === null ? null : toSafeBytes(free),
    usageRatio,
    shared: item.shared === 1,
    source: item.status === "available" ? "Proxmox storage available" : "Proxmox storage",
  };
}

export async function readLocalBackupStorageMetrics() {
  if (!getProxmoxConfig()) {
    return {
      mode: "offline" as const,
      warnings: ["Aucune connexion Proxmox, métriques stockage local indisponibles."],
      storages: [] as LocalBackupStorageMetrics[],
    };
  }

  try {
    const resources = await proxmoxRequest<ProxmoxStorageResource[]>("cluster/resources?type=storage");
    const storages = (Array.isArray(resources) ? resources : [])
      .filter((item) => item.type === "storage")
      .filter((item) => hasBackupContent(item.content))
      .map((item) => normalizeStorageResource(item))
      .filter((item): item is LocalBackupStorageMetrics => Boolean(item))
      .sort((a, b) => {
        const nodeA = a.node ?? "";
        const nodeB = b.node ?? "";
        if (nodeA !== nodeB) return nodeA.localeCompare(nodeB);
        return a.storage.localeCompare(b.storage);
      });

    return {
      mode: "live" as const,
      warnings: [] as string[],
      storages,
    };
  } catch (error) {
    const reason =
      error instanceof ProxmoxConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Erreur inconnue";
    return {
      mode: "offline" as const,
      warnings: [`Métriques stockage local indisponibles: ${reason}`],
      storages: [] as LocalBackupStorageMetrics[],
    };
  }
}

