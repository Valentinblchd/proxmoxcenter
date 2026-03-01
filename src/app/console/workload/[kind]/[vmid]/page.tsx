import Link from "next/link";
import { notFound } from "next/navigation";
import ProxmoxConsoleSession from "@/components/proxmox-console-session";
import { getWorkloadDetailById, type WorkloadKind } from "@/lib/proxmox/workloads";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ kind: string; vmid: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function readParams(value: PageProps["params"]) {
  return await value;
}

async function readSearchParams(
  value: PageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function asKind(value: string): WorkloadKind | null {
  return value === "qemu" || value === "lxc" ? value : null;
}

function parseVmid(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default async function WorkloadConsolePage({ params, searchParams }: PageProps) {
  const resolved = await readParams(params);
  const query = await readSearchParams(searchParams);
  const kind = asKind(resolved.kind);
  const vmid = parseVmid(resolved.vmid);
  const mode = readString(query.mode) ?? (kind === "qemu" ? "novnc" : "xtermjs");

  if (!kind || !vmid) notFound();

  let detail = null;
  try {
    detail = await getWorkloadDetailById({ kind, vmid });
  } catch {
    detail = null;
  }

  if (!detail) notFound();

  return (
    <>
      <section className="content console-nav-strip">
        <div className="quick-actions">
          <Link href={`/inventory/${kind}/${vmid}`} className="action-btn">
            ← Retour à la fiche
          </Link>
          <Link href="/inventory" className="action-btn">
            Inventaire
          </Link>
        </div>
      </section>

      <ProxmoxConsoleSession
        title={kind === "qemu" ? `${detail.name} • console VM` : `${detail.name} • shell CT`}
        subtitle={kind === "qemu" ? "Session graphique intégrée" : "Session shell intégrée"}
        target={
          kind === "qemu"
            ? {
                type: "qemu-vnc",
                node: detail.node,
                vmid: detail.vmid,
                mode: mode === "spice" ? "spice" : mode === "console" ? "console" : "novnc",
              }
            : {
                type: "lxc-shell",
                node: detail.node,
                vmid: detail.vmid,
              }
        }
      />
    </>
  );
}
