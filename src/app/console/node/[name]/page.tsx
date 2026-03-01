import Link from "next/link";
import { notFound } from "next/navigation";
import ProxmoxConsoleSession from "@/components/proxmox-console-session";
import { getNodeDetailByName } from "@/lib/proxmox/nodes";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ name: string }>;
};

async function readParams(value: PageProps["params"]) {
  return await value;
}

export default async function NodeConsolePage({ params }: PageProps) {
  const resolved = await readParams(params);
  const nodeName = decodeURIComponent(resolved.name);

  if (!nodeName) notFound();

  let detail = null;
  try {
    detail = await getNodeDetailByName(nodeName);
  } catch {
    detail = null;
  }

  if (!detail) notFound();

  return (
    <>
      <section className="content console-nav-strip">
        <div className="quick-actions">
          <Link href={`/inventory/node/${encodeURIComponent(nodeName)}`} className="action-btn">
            ← Retour au nœud
          </Link>
          <Link href="/console?tab=nodes" className="action-btn">
            Shell nœuds
          </Link>
        </div>
      </section>

      <ProxmoxConsoleSession
        title={`${detail.name} • shell nœud`}
        subtitle="Session xterm intégrée"
        target={{ type: "node-shell", node: detail.name }}
      />
    </>
  );
}
