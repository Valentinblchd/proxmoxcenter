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
      bridges: ["vmbr0"],
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
    const [nextidRaw, storagesRaw] = await Promise.all([
      proxmoxRequest<string | number>("cluster/nextid"),
      proxmoxRequest<ProxmoxStorage[]>("storage"),
    ]);

    const nextVmid =
      typeof nextidRaw === "number"
        ? nextidRaw
        : Number.isInteger(Number.parseInt(String(nextidRaw), 10))
          ? Number.parseInt(String(nextidRaw), 10)
          : null;

    return NextResponse.json({
      ...fallback,
      options: {
        ...fallback.options,
        nextVmid,
        storages: parseStorageList(storagesRaw),
      },
    });
  } catch {
    return NextResponse.json(fallback);
  }
}
