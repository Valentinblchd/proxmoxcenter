import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatBytes, formatPercent, formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

function StatTile({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string | number;
  subtle?: string;
}) {
  return (
    <article className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {subtle ? <div className="stat-subtle">{subtle}</div> : null}
    </article>
  );
}

export default async function HomePage() {
  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const topWorkloads = snapshot.workloads.slice(0, 4);
  const primaryNode = snapshot.nodes[0];

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Accueil</p>
          <h1>Bienvenue sur ProxCenter</h1>
          <p className="muted">
            Vue d’ensemble rapide, sans métriques simulées.
          </p>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">
            Mis à jour {formatRelativeTime(snapshot.lastUpdatedAt)}
          </span>
        </div>
      </header>

      <section className="panel welcome-panel">
        <div>
          <h2>Page d’accueil simple</h2>
          <p className="muted">
            On garde peu d’informations ici. Le menu à gauche ouvre maintenant les
            pages dédiées (nœuds, inventaire, stockage, monitoring, etc.).
          </p>
        </div>
        <div className="quick-actions">
          <Link href="/assistant" className="action-btn primary">
            Assistant IA
          </Link>
          <Link href="/provision" className="action-btn">
            Créer VM / LXC
          </Link>
          <Link href="/inventory" className="action-btn">
            Ouvrir l’inventaire
          </Link>
          <Link href="/observability" className="action-btn">
            Observabilité
          </Link>
          <Link href="/operations" className="action-btn">
            Opérations
          </Link>
          <Link href="/settings" className="action-btn">
            Paramètres
          </Link>
        </div>
      </section>

      <section className="stats-grid">
        <StatTile label="Nœuds" value={snapshot.summary.nodes} />
        <StatTile label="VM" value={snapshot.summary.vms} />
        <StatTile label="CT" value={snapshot.summary.cts} />
        <StatTile
          label="Actifs"
          value={snapshot.summary.running}
          subtle={`${snapshot.summary.vms + snapshot.summary.cts} workloads`}
        />
      </section>

      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Connexion</h2>
            <span className="muted">{hasLiveData ? "Opérationnelle" : "Aucune donnée live"}</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>API Proxmox</span>
              <strong className={hasLiveData ? "status-good" : undefined}>
                {hasLiveData ? "Connectée" : "Indisponible"}
              </strong>
            </div>
            <div className="row-line">
              <span>Dernière synchro</span>
              <strong>{formatRelativeTime(snapshot.lastUpdatedAt)}</strong>
            </div>
            <div className="quick-actions">
              <Link href="/settings?tab=connection" className="action-btn">
                Gérer la connexion
              </Link>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Aperçu rapide</h2>
            <span className="muted">Infos minimales</span>
          </div>

          <div className="stack-sm">
            <div className="mini-summary">
              <span className="mini-label">Nœud principal</span>
              <span className="mini-value">{primaryNode?.name ?? "Aucun nœud"}</span>
            </div>
            <div className="mini-summary">
              <span className="mini-label">Charge CPU</span>
              <span className="mini-value">
                {primaryNode ? formatPercent(primaryNode.cpuLoad) : "—"}
              </span>
            </div>
            <div className="mini-summary">
              <span className="mini-label">RAM utilisée</span>
              <span className="mini-value">
                {primaryNode
                  ? `${formatBytes(primaryNode.memoryUsed)} / ${formatBytes(primaryNode.memoryTotal)}`
                  : "—"}
              </span>
            </div>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Workloads récents</h2>
          <span className="muted">Top {topWorkloads.length}</span>
        </div>

        {topWorkloads.length === 0 ? (
          <p className="muted">Aucune VM/CT détectée.</p>
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
                <div className="item-metric">{formatPercent(workload.cpuLoad)}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
