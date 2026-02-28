import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import NodeUpdateStatus from "@/components/node-update-status";
import { buildProxmoxNodeShellUrl } from "@/lib/proxmox/console-url";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { getNodeDetailByName } from "@/lib/proxmox/nodes";
import { formatBytes, formatPercent, formatUptime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type NodePageProps = {
  params:
    | Promise<{ name: string }>
    | { name: string };
};

async function readParams(value: NodePageProps["params"]) {
  if (typeof (value as Promise<{ name: string }>).then === "function") {
    return await (value as Promise<{ name: string }>);
  }
  return value as { name: string };
}

function buildWorkloadHref(kind: "qemu" | "lxc", vmid: number) {
  return `/inventory/${kind}/${vmid}`;
}

function buildStorageHref(node: string, storage: string) {
  return `/inventory/storage/${encodeURIComponent(node)}/${encodeURIComponent(storage)}`;
}

export async function generateMetadata({ params }: NodePageProps): Promise<Metadata> {
  const resolved = await readParams(params);
  return {
    title: `Nœud ${decodeURIComponent(resolved.name)} | ProxCenter`,
  };
}

export default async function InventoryNodeDetailPage({ params }: NodePageProps) {
  const resolved = await readParams(params);
  const nodeName = decodeURIComponent(resolved.name);

  if (!nodeName) notFound();

  let detail = null;
  try {
    detail = await getNodeDetailByName(nodeName);
  } catch {
    detail = null;
  }

  if (!detail) {
    return (
      <section className="content workload-page">
        <header className="topbar">
          <div className="workload-header-copy">
            <Link href="/inventory" className="action-btn workload-back-btn">
              ← Retour
            </Link>
            <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
              <Link href="/inventory">Inventaire</Link>
              <span>›</span>
              <span>Nœud</span>
              <span>›</span>
              <span>Introuvable</span>
            </nav>
            <h1>Nœud indisponible</h1>
          </div>
          <div className="topbar-meta">
            <span className="pill">Introuvable</span>
          </div>
        </header>

        <section className="panel">
          <p className="muted">Impossible de charger ce nœud. Vérifie la connexion Proxmox.</p>
        </section>
      </section>
    );
  }

  const proxmox = getProxmoxConfig();
  const shellHref = proxmox
    ? buildProxmoxNodeShellUrl({
        baseUrl: proxmox.baseUrl,
        node: detail.name,
      })
    : null;

  return (
    <section className="content content-wide workload-page">
      <header className="topbar">
        <div className="workload-header-copy">
          <Link href="/inventory" className="action-btn workload-back-btn">
            ← Retour
          </Link>
          <nav className="inventory-breadcrumb" aria-label="Fil d’Ariane">
            <Link href="/inventory">Inventaire</Link>
            <span>›</span>
            <Link href={`/inventory?node=${encodeURIComponent(detail.name)}`}>Filtre {detail.name}</Link>
            <span>›</span>
            <span>{detail.name}</span>
          </nav>
          <h1>{detail.name}</h1>
        </div>
        <div className="topbar-meta">
          {detail.navigation.previous ? (
            <Link href={`/inventory/node/${encodeURIComponent(detail.navigation.previous.name)}`} className="action-btn">
              ← {detail.navigation.previous.name}
            </Link>
          ) : (
            <span className="pill">Début</span>
          )}
          {detail.navigation.next ? (
            <Link href={`/inventory/node/${encodeURIComponent(detail.navigation.next.name)}`} className="action-btn">
              {detail.navigation.next.name} →
            </Link>
          ) : (
            <span className="pill">Fin</span>
          )}
          <span className={`inventory-badge status-${detail.status === "online" ? "running" : "stopped"}`}>
            NODE • {detail.status}
          </span>
        </div>
      </header>

      <section className="panel workload-hero">
        <div className="workload-hero-copy">
          <div className="row-line">
            <span>Workloads hébergés</span>
            <strong>{detail.summary.workloads}</strong>
          </div>
          <div className="row-line">
            <span>Actifs</span>
            <strong>{detail.summary.running}</strong>
          </div>
          <div className="row-line">
            <span>VM / CT</span>
            <strong>
              {detail.summary.vms} / {detail.summary.cts}
            </strong>
          </div>
          <div className="row-line">
            <span>Uptime</span>
            <strong>{detail.uptimeSeconds > 0 ? formatUptime(detail.uptimeSeconds) : "—"}</strong>
          </div>
        </div>

        <div className="workload-hero-stats">
          <div className="inventory-metric-card">
            <span className="muted">CPU</span>
            <strong>{formatPercent(detail.cpuLoad)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">RAM</span>
            <strong>{formatBytes(detail.memoryUsed)} / {formatBytes(detail.memoryTotal)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Disque</span>
            <strong>{formatBytes(detail.diskUsed)} / {formatBytes(detail.diskTotal)}</strong>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Stockages</span>
            <strong>{detail.storages.length}</strong>
          </div>
        </div>

        <div className="workload-hero-actions">
          <Link href={`/inventory?node=${encodeURIComponent(detail.name)}`} className="action-btn">
            Voir les workloads du nœud
          </Link>
          {shellHref ? (
            <a href={shellHref} target="_blank" rel="noreferrer" className="action-btn primary">
              Shell Proxmox
            </a>
          ) : (
            <span className="pill">Connexion requise</span>
          )}
        </div>
      </section>

      <section className="workload-grid">
        <section className="panel">
          <NodeUpdateStatus live={Boolean(proxmox)} node={detail.name} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Workloads du nœud</h2>
            <span className="muted">{detail.workloads.length}</span>
          </div>
          {detail.workloads.length === 0 ? (
            <p className="muted">Aucun workload remonté sur ce nœud.</p>
          ) : (
            <div className="mini-list">
              {detail.workloads.map((workload) => (
                <Link
                  key={`${workload.kind}-${workload.vmid}`}
                  href={buildWorkloadHref(workload.kind, workload.vmid)}
                  className="mini-list-item mini-list-link"
                >
                  <div>
                    <div className="item-title">
                      {workload.name} <span className="muted">#{workload.vmid}</span>
                    </div>
                    <div className="item-subtitle">
                      {workload.kind.toUpperCase()} • {workload.status}
                    </div>
                  </div>
                  <div className="item-metric">{formatPercent(workload.cpuLoad)}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Stockages</h2>
            <span className="muted">{detail.storages.length}</span>
          </div>
          {detail.storages.length === 0 ? (
            <p className="muted">Aucun stockage remonté.</p>
          ) : (
            <div className="mini-list">
              {detail.storages.map((storage) => (
                <Link
                  key={storage.name}
                  href={buildStorageHref(detail.name, storage.name)}
                  className="mini-list-item mini-list-link"
                >
                  <div>
                    <div className="item-title">{storage.name}</div>
                    <div className="item-subtitle">
                      {[storage.type, storage.content, storage.shared ? "shared" : null]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </div>
                  </div>
                  <div className="item-metric">
                    {storage.total > 0 ? `${formatBytes(storage.used)} / ${formatBytes(storage.total)}` : "—"}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Interfaces réseau</h2>
            <span className="muted">{detail.networks.length}</span>
          </div>
          {detail.networks.length === 0 ? (
            <p className="muted">Aucune interface remontée.</p>
          ) : (
            <div className="mini-list">
              {detail.networks.map((network) => (
                <article key={network.name} className="mini-list-item">
                  <div>
                    <div className="item-title">{network.name}</div>
                    <div className="item-subtitle">
                      {[network.type, network.address, network.method, network.vlanAware ? "VLAN aware" : null]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </div>
                  </div>
                  <div className="item-metric">{network.active === null ? "—" : network.active ? "up" : "down"}</div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
