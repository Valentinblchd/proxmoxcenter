import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import NodeUpdateStatus from "@/components/node-update-status";
import NodeRollingUpdatePanel from "@/components/node-rolling-update-panel";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getNodeDetailByName } from "@/lib/proxmox/nodes";
import { formatBytes, formatPercent, formatUptime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type NodePageProps = {
  params: Promise<{ name: string }>;
};

async function readParams(value: NodePageProps["params"]) {
  return await value;
}

function buildWorkloadHref(kind: "qemu" | "lxc", vmid: number) {
  return `/inventory/${kind}/${vmid}`;
}

function buildStorageHref(node: string, storage: string) {
  return `/inventory/storage/${encodeURIComponent(node)}/${encodeURIComponent(storage)}`;
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

export async function generateMetadata({ params }: NodePageProps): Promise<Metadata> {
  const resolved = await readParams(params);
  return {
    title: `Nœud ${decodeURIComponent(resolved.name)} | ProxmoxCenter`,
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

  const shellHref = detail ? `/console/node/${encodeURIComponent(detail.name)}` : null;
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const nodeMemoryRatio = detail.memoryTotal > 0 ? detail.memoryUsed / detail.memoryTotal : 0;
  const nodeDiskRatio = detail.diskTotal > 0 ? detail.diskUsed / detail.diskTotal : 0;
  const nodeHeroStyle = {
    gridTemplateColumns: "minmax(0, 0.98fr) minmax(0, 1.02fr)",
    alignItems: "stretch",
  };
  const nodeHeroStatsStyle = {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  };
  const nodeSupportStyle = {
    gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 0.95fr) minmax(280px, 0.8fr)",
  };
  const nodeGridStyle = {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  };
  const networkSummary = `In ${formatRate(detail.networkInBytesPerSecond)} • Out ${formatRate(detail.networkOutBytesPerSecond)}`;

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
          <InventoryRefreshButton auto intervalMs={5000} />
          {detail.navigation.previous ? (
            <Link
              href={`/inventory/node/${encodeURIComponent(detail.navigation.previous.name)}`}
              className="action-btn"
              prefetch
            >
              ← {detail.navigation.previous.name}
            </Link>
          ) : (
            <span className="pill">Début</span>
          )}
          {detail.navigation.next ? (
            <Link
              href={`/inventory/node/${encodeURIComponent(detail.navigation.next.name)}`}
              className="action-btn"
              prefetch
            >
              {detail.navigation.next.name} →
            </Link>
          ) : (
            <span className="pill">Fin</span>
          )}
          <span className={`inventory-badge status-${detail.status === "online" ? "running" : "stopped"}`}>
            NŒUD • {detail.status === "online" ? "en ligne" : "hors ligne"}
          </span>
        </div>
      </header>

      <section className="panel workload-hero" style={nodeHeroStyle}>
        <div className="workload-hero-copy">
          <div className="row-line">
            <span>Statut</span>
            <strong>{detail.status === "online" ? "En ligne" : "Hors ligne"}</strong>
          </div>
          <div className="row-line">
            <span>Workloads hébergés</span>
            <strong>{detail.summary.workloads}</strong>
          </div>
          <div className="row-line">
            <span>VM / CT</span>
            <strong>
              {detail.summary.vms} / {detail.summary.cts}
            </strong>
          </div>
          <div className="row-line">
            <span>Réseau total</span>
            <strong>{networkSummary}</strong>
          </div>
          <div className="row-line">
            <span>Uptime</span>
            <strong>{detail.uptimeSeconds > 0 ? formatUptime(detail.uptimeSeconds) : "—"}</strong>
          </div>
          <div className="row-line">
            <span>Stockages</span>
            <strong>{detail.storages.length}</strong>
          </div>
        </div>

        <div className="workload-hero-stats" style={nodeHeroStatsStyle}>
          <div className="inventory-metric-card">
            <span className="muted">CPU</span>
            <strong>{formatPercent(detail.cpuLoad)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span className="tone-green" style={{ width: `${Math.round(detail.cpuLoad * 100)}%` }} />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">RAM</span>
            <strong>{formatBytes(detail.memoryUsed)} / {formatBytes(detail.memoryTotal)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span className="tone-orange" style={{ width: `${Math.round(nodeMemoryRatio * 100)}%` }} />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Disque</span>
            <strong>{formatBytes(detail.diskUsed)} / {formatBytes(detail.diskTotal)}</strong>
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span className="tone-orange" style={{ width: `${Math.round(nodeDiskRatio * 100)}%` }} />
            </div>
          </div>
          <div className="inventory-metric-card">
            <span className="muted">Débit réseau</span>
            <strong>
              {networkSummary}
            </strong>
          </div>
        </div>

        <div className="workload-hero-actions">
          <Link href={`/inventory?node=${encodeURIComponent(detail.name)}`} className="action-btn">
            Voir les workloads du nœud
          </Link>
          {shellHref ? (
            <Link href={shellHref} className="action-btn primary">
              Console intégrée
            </Link>
          ) : (
            <span className="pill">Connexion requise</span>
          )}
        </div>
      </section>

      <section className="workload-section-head">
        <div>
          <p className="eyebrow">Capacité</p>
          <h2>Workloads, stockages, interfaces et maintenance</h2>
        </div>
        <p className="muted">Vue d’ensemble du nœud pour piloter la charge, le stockage et les mises à jour.</p>
      </section>

      <section className="content-grid workload-support-grid" style={nodeSupportStyle}>
        <section className="panel">
          <div className="panel-head">
            <h2>Maintenance et mise à jour</h2>
            <span className="muted">APT et rolling update</span>
          </div>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <NodeUpdateStatus live={true} node={detail.name} />
            <NodeRollingUpdatePanel
              live={true}
              node={detail.name}
              canOperate={canOperate}
              shellHref={shellHref}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Accès et réseau</h2>
            <span className="muted">{detail.networks.length} interface(s)</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Shell intégré</span>
              <strong>{shellHref ? "Disponible" : "Indisponible"}</strong>
            </div>
            <div className="row-line">
              <span>Débit réseau</span>
              <strong>{networkSummary}</strong>
            </div>
            <div className="row-line">
              <span>Stockages</span>
              <strong>{detail.storages.length}</strong>
            </div>
            <div className="row-line">
              <span>Workloads actifs</span>
              <strong>{detail.summary.running}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Capacité rapide</h2>
            <span className="muted">Lecture opérateur</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>CPU</span>
              <strong>{formatPercent(detail.cpuLoad)}</strong>
            </div>
            <div className="row-line">
              <span>RAM</span>
              <strong>{formatBytes(detail.memoryUsed)} / {formatBytes(detail.memoryTotal)}</strong>
            </div>
            <div className="row-line">
              <span>Disque</span>
              <strong>{formatBytes(detail.diskUsed)} / {formatBytes(detail.diskTotal)}</strong>
            </div>
            <div className="row-line">
              <span>Uptime</span>
              <strong>{detail.uptimeSeconds > 0 ? formatUptime(detail.uptimeSeconds) : "—"}</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="workload-grid" style={nodeGridStyle}>
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
