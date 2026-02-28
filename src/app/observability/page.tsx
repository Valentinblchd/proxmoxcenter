import Link from "next/link";
import { buildGreenItAdvisor, buildSecurityAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatBytes, formatPercent, formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type ObservabilityPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

const TABS = [
  { id: "overview", label: "Vue" },
  { id: "health", label: "Santé" },
  { id: "greenit", label: "GreenIT" },
  { id: "ai", label: "Recommandations" },
] as const;

async function readSearchParams(
  value: ObservabilityPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  if (typeof (value as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    return (await value) ?? {};
  }
  return value ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ObservabilityPage({ searchParams }: ObservabilityPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const security = buildSecurityAdvisor(snapshot);
  const greenit = buildGreenItAdvisor(snapshot);
  const warningCount = snapshot.warnings.length;
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

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Observabilité</p>
          <h1>Observabilité</h1>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Live</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/observability?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-tile">
          <div className="stat-label">Nœuds</div>
          <div className="stat-value">{snapshot.summary.nodes}</div>
          <div className="stat-subtle">Cluster</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">CPU moyen</div>
          <div className="stat-value">{hasLiveData ? formatPercent(avgCpu) : "—"}</div>
          <div className="stat-subtle">Tous nœuds</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">RAM moyenne</div>
          <div className="stat-value">{hasLiveData ? formatPercent(avgMem) : "—"}</div>
          <div className="stat-subtle">Tous nœuds</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Score sécurité</div>
          <div className="stat-value">{security.score}</div>
          <div className="stat-subtle">Heuristique</div>
        </article>
      </section>

      <section className="content-grid hub-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>{TABS.find((tab) => tab.id === activeTab)?.label}</h2>
            <span className="muted">Vue unifiée</span>
          </div>

          {(activeTab === "overview" || activeTab === "health") ? (
            <div className="mini-list">
              {snapshot.nodes.map((node) => (
                <article key={node.name} className="mini-list-item">
                  <div>
                    <div className="item-title">{node.name}</div>
                    <div className="item-subtitle">
                      {node.status} • RAM {formatBytes(node.memoryUsed)} / {formatBytes(node.memoryTotal)}
                    </div>
                  </div>
                  <div className="item-metric">{formatPercent(node.cpuLoad)}</div>
                </article>
              ))}
            </div>
          ) : null}

          {(activeTab === "overview" || activeTab === "greenit") ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>Puissance estimée</span>
                <strong>{greenit.metrics.effectivePowerWatts} W</strong>
              </div>
              <div className="row-line">
                <span>Consommation annuelle</span>
                <strong>{greenit.metrics.annualKwh} kWh</strong>
              </div>
              <div className="row-line">
                <span>CO2 annuel</span>
                <strong>{greenit.metrics.annualCo2Kg} kg</strong>
              </div>
              <div className="row-line">
                <span>Coût annuel</span>
                <strong>{greenit.metrics.annualCost} €</strong>
              </div>
            </div>
          ) : null}

          {(activeTab === "overview" || activeTab === "ai") ? (
            <div className="stack-sm">
              <h3 className="subsection-title">Recommandations sécurité</h3>
              <div className="mini-list">
                {security.recommendations.slice(0, 3).map((rec) => (
                  <article key={rec.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{rec.title}</div>
                      <div className="item-subtitle">{rec.action}</div>
                    </div>
                    <div className="item-metric">{rec.severity}</div>
                  </article>
                ))}
              </div>
              <h3 className="subsection-title">Recommandations GreenIT</h3>
              <div className="mini-list">
                {greenit.recommendations.slice(0, 3).map((rec) => (
                  <article key={rec.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{rec.title}</div>
                      <div className="item-subtitle">{rec.action}</div>
                    </div>
                    <div className="item-metric">{rec.severity}</div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>État</h2>
            <span className="muted">Synthèse</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Source données</span>
              <strong className={hasLiveData ? "status-good" : undefined}>{hasLiveData ? "Live" : "Offline"}</strong>
            </div>
            <div className="row-line">
              <span>Warnings API</span>
              <strong>{warningCount}</strong>
            </div>
            <div className="row-line">
              <span>Reco sécurité</span>
              <strong>{security.recommendations.length}</strong>
            </div>
            <div className="row-line">
              <span>Reco GreenIT</span>
              <strong>{greenit.recommendations.length}</strong>
            </div>
          </div>
          <div className="quick-actions">
            <Link href="/security" className="action-btn">
              Sécurité
            </Link>
            <Link href="/resources" className="action-btn">
              GreenIT
            </Link>
            <Link href="/operations" className="action-btn primary">
              Opérations
            </Link>
          </div>
        </section>
      </section>
    </section>
  );
}
