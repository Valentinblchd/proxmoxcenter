import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const topWorkloads = snapshot.workloads.slice(0, 3);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Accueil</p>
          <h1>ProxCenter</h1>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">Sync {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
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
          <Link href="/settings?tab=connection" className="action-btn">
            Paramètres API
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
