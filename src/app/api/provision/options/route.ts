import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { proxmoxRequest } from "@/lib/proxmox/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProxmoxStorage = {
  storage?: string;
  type?: string;
  content?: string;
  enabled?: number;
  active?: number;
  shared?: number;
};

type ProxmoxClusterResource = {
  type?: string;
  vmid?: number;
};

type ProxmoxNodeNetwork = {
  iface?: string;
  type?: string;
  active?: number;
};

type ProxmoxStorageContentEntry = {
  volid?: string;
  content?: string;
  ctime?: number;
  size?: number;
};

function parseStorageList(raw: ProxmoxStorage[]) {
  return raw
    .filter((item) => item?.storage && item.enabled !== 0)
    .map((item) => ({
      name: item.storage as string,
      type: item.type ?? "unknown",
      content: item.content ?? "",
      shared: item.shared === 1,
      active: item.active !== 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractUsedVmids(resources: ProxmoxClusterResource[]) {
  return Array.from(
    new Set(
      resources
        .filter((item) => (item.type === "qemu" || item.type === "lxc") && Number.isInteger(item.vmid))
        .map((item) => item.vmid as number),
    ),
  ).sort((a, b) => a - b);
}

function parseBridgeList(rawNetworks: ProxmoxNodeNetwork[][]) {
  const normalized = rawNetworks
    .flat()
    .filter((entry) => entry?.type === "bridge" && typeof entry.iface === "string")
    .map((entry) => (entry.iface as string).trim())
    .filter((name) => name.length > 0);

  const uniqueByLower = new Map<string, string>();
  for (const item of normalized) {
    const key = item.toLowerCase();
    if (!uniqueByLower.has(key)) {
      uniqueByLower.set(key, item);
    }
  }

  return [...uniqueByLower.values()].sort((a, b) => a.localeCompare(b));
}

function parseIsoVolumes(
  node: string,
  byStorage: Array<{ storage: string; entries: ProxmoxStorageContentEntry[] }>,
) {
  return byStorage
    .flatMap((item) =>
      item.entries
        .filter((entry) => entry?.content === "iso" && typeof entry.volid === "string")
        .map((entry) => {
          const value = entry.volid as string;
          const filename = value.split("/").at(-1) ?? value;
          const ctime =
            typeof entry.ctime === "number" && Number.isFinite(entry.ctime) && entry.ctime > 0
              ? new Date(entry.ctime * 1000).toISOString()
              : null;

          return {
            value,
            label: `${filename} • ${item.storage}`,
            storage: item.storage,
            node,
            sizeBytes: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : null,
            createdAt: ctime,
          };
        }),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function GET() {
  const snapshot = await getDashboardSnapshot();

  const fallback = {
    ok: true,
    mode: snapshot.mode,
    configured: snapshot.mode === "live",
    options: {
      nodes: snapshot.nodes.map((node) => node.name),
      nextVmid: null as number | null,
      storages: [] as Array<{
        name: string;
        type: string;
        content: string;
        shared: boolean;
        active: boolean;
      }>,
      bridges: [] as string[],
      usedVmids: [] as number[],
      isoVolumes: [] as Array<{
        value: string;
        label: string;
        storage: string;
        node: string;
        sizeBytes: number | null;
        createdAt: string | null;
      }>,
      vmOstypes: [
        { value: "l26", label: "Linux 2.6/3.x/4.x/5.x" },
        { value: "l24", label: "Linux 2.4" },
        { value: "other", label: "Autre / générique" },
        { value: "win11", label: "Windows 11 / Server recent" },
        { value: "win10", label: "Windows 10 / Server 2019" },
        { value: "win8", label: "Windows 8 / Server 2012" },
        { value: "win7", label: "Windows 7 / Server 2008 R2" },
        { value: "w2k8", label: "Windows Server 2008" },
        { value: "w2k12", label: "Windows Server 2012" },
        { value: "w2k16", label: "Windows Server 2016" },
        { value: "w2k19", label: "Windows Server 2019" },
        { value: "w2k22", label: "Windows Server 2022" },
        { value: "solaris", label: "Solaris" },
      ],
    },
  };

  if (snapshot.mode !== "live") {
    return NextResponse.json(fallback);
  }

  try {
    const [nextidRaw, storagesRaw, resourcesRaw] = await Promise.all([
      proxmoxRequest<string | number>("cluster/nextid"),
      proxmoxRequest<ProxmoxStorage[]>("storage"),
      proxmoxRequest<ProxmoxClusterResource[]>("cluster/resources"),
    ]);

    const nextVmid =
      typeof nextidRaw === "number"
        ? nextidRaw
        : Number.isInteger(Number.parseInt(String(nextidRaw), 10))
          ? Number.parseInt(String(nextidRaw), 10)
          : null;

    const storages = parseStorageList(storagesRaw);
    const nodeNames = snapshot.nodes.map((node) => node.name).filter((name) => name.trim().length > 0);
    const usedVmids = extractUsedVmids(resourcesRaw);
    const isoStorages = storages
      .filter((storage) => storageHasContent(storage.content, "iso"))
      .map((storage) => storage.name);

    const [networksRaw, isoByNodeStorageRaw] = await Promise.all([
      Promise.all(
        nodeNames.map((node) =>
          proxmoxRequest<ProxmoxNodeNetwork[]>(`nodes/${encodeURIComponent(node)}/network`).catch(() => []),
        ),
      ),
      nodeNames.length > 0
        ? Promise.all(
            nodeNames.map(async (node) => {
              const storagesContent = await Promise.all(
                isoStorages.map(async (storageName) => {
                  const entries = await proxmoxRequest<ProxmoxStorageContentEntry[]>(
                    `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storageName)}/content?content=iso`,
                  ).catch(() => []);
                  return { storage: storageName, entries };
                }),
              );
              return { node, storagesContent };
            }),
          )
        : Promise.resolve([] as Array<{ node: string; storagesContent: Array<{ storage: string; entries: ProxmoxStorageContentEntry[] }> }>),
    ]);

    const bridges = parseBridgeList(networksRaw);
    const isoVolumes = isoByNodeStorageRaw
      .flatMap((entry) => parseIsoVolumes(entry.node, entry.storagesContent))
      .sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({
      ...fallback,
      options: {
        ...fallback.options,
        nextVmid,
        storages,
        bridges,
        usedVmids,
        isoVolumes,
      },
    });
  } catch {
    return NextResponse.json(fallback);
  }
}

function storageHasContent(content: string, target: string) {
  return content
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(target.toLowerCase());
}
