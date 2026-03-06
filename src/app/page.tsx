import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatBytes, formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const topWorkloads = snapshot.workloads.slice(0, 3);
  const avgCpu =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => sum + node.cpuLoad, 0) / snapshot.nodes.length
      : 0;
  const avgMem =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => {
          const ratio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
          return sum + ratio;
        }, 0) / snapshot.nodes.length
      : 0;
  const totalMemUsed = snapshot.nodes.reduce((sum, node) => sum + node.memoryUsed, 0);
  const totalMem = snapshot.nodes.reduce((sum, node) => sum + node.memoryTotal, 0);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Accueil</p>
          <h1>ProxCenter</h1>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
        </div>
      </header>

      {snapshot.warnings.length > 0 ? (
        <div className="warning">
          {snapshot.warnings[0]}
        </div>
      ) : null}

      <section className="panel welcome-panel">
        <div className="stack-sm">
          <h2>Vue d’ensemble</h2>
          <div className="row-line">
            <span>Connexion API</span>
            <strong className={hasLiveData ? "status-good" : undefined}>
              {hasLiveData ? "Opérationnelle" : "À configurer"}
            </strong>
          </div>
          <div className="row-line">
            <span>Dernière synchronisation</span>
            <strong>{formatRelativeTime(snapshot.lastUpdatedAt)}</strong>
          </div>
        </div>

        <div className="quick-actions">
          <Link href="/provision" className="action-btn primary">
            Créer VM / LXC
          </Link>
          <Link href="/inventory" className="action-btn">
            Inventaire
          </Link>
          <Link href="/settings?tab=proxmox" className="action-btn">
            Proxmox
          </Link>
        </div>
      </section>

      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>État infrastructure</h2>
            <span className="muted">Temps réel</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Nœuds</span>
              <strong>{snapshot.summary.nodes}</strong>
            </div>
            <div className="row-line">
              <span>VM</span>
              <strong>{snapshot.summary.vms}</strong>
            </div>
            <div className="row-line">
              <span>CT</span>
              <strong>{snapshot.summary.cts}</strong>
            </div>
            <div className="row-line">
              <span>Workloads actifs</span>
              <strong>{snapshot.summary.running}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Ressources rapides</h2>
            <span className="muted">CPU / RAM cluster</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>CPU moyen</span>
              <strong>{Math.round(avgCpu * 100)}%</strong>
            </div>
            <div className="inventory-progress inventory-progress-wide">
              <span className="tone-green" style={{ width: `${Math.round(avgCpu * 100)}%` }} />
            </div>
            <div className="row-line">
              <span>RAM moyenne</span>
              <strong>{Math.round(avgMem * 100)}%</strong>
            </div>
            <div className="inventory-progress inventory-progress-wide">
              <span className="tone-orange" style={{ width: `${Math.round(avgMem * 100)}%` }} />
            </div>
            <div className="row-line">
              <span>RAM cluster utilisée</span>
              <strong>
                {formatBytes(totalMemUsed)} / {formatBytes(totalMem || 1)}
              </strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Activité récente</h2>
            <span className="muted">Top {topWorkloads.length}</span>
          </div>
          {topWorkloads.length === 0 ? (
            <p className="muted">Aucune VM/CT remontée pour le moment.</p>
          ) : (
            <div className="mini-list">
              {topWorkloads.map((workload) => (
                <article key={workload.id} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {workload.name}
                      <span className="kind-pill">
                        {workload.kind.toUpperCase()} #{workload.vmid}
                      </span>
                    </div>
                    <div className="item-subtitle">
                      {workload.node} • {workload.status}
                    </div>
                  </div>
                  <Link href={`/inventory?q=${encodeURIComponent(String(workload.vmid))}`} className="action-btn">
                    Ouvrir
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </section>
  );
}
