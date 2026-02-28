import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";

type ProxmoxStorageResource = {
  id?: string;
  type?: string;
  node?: string;
  storage?: string;
  status?: string;
  content?: string;
  disk?: number;
  maxdisk?: number;
  shared?: number | boolean;
};

type ProxmoxStorageContent = {
  volid?: string;
  content?: string;
  format?: string;
  size?: number;
  ctime?: number;
  vmid?: number;
  notes?: string;
};

export type StorageContentEntry = {
  id: string;
  volid: string;
  content: string | null;
  format: string | null;
  size: number;
  createdAt: string | null;
  vmid: number | null;
  notes: string | null;
};

export type StorageDetail = {
  node: string;
  storage: string;
  status: string;
  content: string | null;
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
  shared: boolean;
  contentEntries: StorageContentEntry[];
  navigation: {
    previous: { node: string; storage: string } | null;
    next: { node: string; storage: string } | null;
  };
};

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBool(value: unknown) {
  return value === true || value === 1 || value === "1";
}

export async function getStorageDetail(options: {
  node: string;
  storage: string;
}): Promise<StorageDetail | null> {
  const resources = await proxmoxRequest<ProxmoxStorageResource[]>("cluster/resources?type=storage");
  const storageResources = (Array.isArray(resources) ? resources : [])
    .filter(
      (item): item is ProxmoxStorageResource & { node: string; storage: string } =>
        item.type === "storage" &&
        typeof item.node === "string" &&
        typeof item.storage === "string",
    )
    .sort((a, b) => {
      const nodeDelta = a.node.localeCompare(b.node, undefined, { numeric: true });
      if (nodeDelta !== 0) return nodeDelta;
      return a.storage.localeCompare(b.storage, undefined, { numeric: true });
    });

  const resource = storageResources.find(
    (item) => item.node === options.node && item.storage === options.storage,
  );
  if (!resource) return null;

  const navigationItems = storageResources.map((item) => ({ node: item.node, storage: item.storage }));
  const navigationIndex = navigationItems.findIndex(
    (item) => item.node === options.node && item.storage === options.storage,
  );

  const contentEntriesRaw = await proxmoxRequest<ProxmoxStorageContent[]>(
    `nodes/${encodeURIComponent(options.node)}/storage/${encodeURIComponent(options.storage)}/content`,
  ).catch(() => []);

  const contentEntries = (Array.isArray(contentEntriesRaw) ? contentEntriesRaw : [])
    .map((item, index) => {
      const volid = asString(item.volid) ?? null;
      return {
        id: volid ?? `${options.node}-${options.storage}-${index}`,
        volid: volid ?? "—",
        content: asString(item.content),
        format: asString(item.format),
        size: asNumber(item.size),
        createdAt:
          typeof item.ctime === "number" && Number.isFinite(item.ctime) && item.ctime > 0
            ? new Date(item.ctime * 1000).toISOString()
            : null,
        vmid: typeof item.vmid === "number" && Number.isFinite(item.vmid) ? item.vmid : null,
        notes: asString(item.notes),
      } satisfies StorageContentEntry;
    })
    .sort((a, b) => a.volid.localeCompare(b.volid, undefined, { numeric: true }));

  const usedBytes = asNumber(resource.disk);
  const totalBytes = asNumber(resource.maxdisk);

  return {
    node: options.node,
    storage: options.storage,
    status: asString(resource.status) ?? "unknown",
    content: asString(resource.content),
    usedBytes,
    totalBytes,
    freeBytes: Math.max(0, totalBytes - usedBytes),
    shared: asBool(resource.shared),
    contentEntries,
    navigation: {
      previous: navigationIndex > 0 ? navigationItems[navigationIndex - 1] : null,
      next:
        navigationIndex >= 0 && navigationIndex < navigationItems.length - 1
          ? navigationItems[navigationIndex + 1]
          : null,
    },
  };
}
