import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { buildGreenItAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatPercent, formatRelativeTime } from "@/lib/ui/format";

function formatInt(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function formatEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDecimal(value: number, digits = 2) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

const severityOrder = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

function severityLabel(severity: keyof typeof severityOrder) {
  if (severity === "critical") return "Critique";
  if (severity === "high") return "Élevée";
  if (severity === "medium") return "Moyenne";
  return "Faible";
}

export const metadata: Metadata = {
  title: "Ressources & GreenIT | ProxCenter",
  description: "Capacité, énergie, coût et recommandations GreenIT",
};

export const dynamic = "force-dynamic";

type ResourcesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "overview", label: "Vue" },
  { id: "recommendations", label: "Recommandations" },
  { id: "nodes", label: "Par nœud" },
] as const;

async function readSearchParams(
  value: ResourcesPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResourcesPage({ searchParams }: ResourcesPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const advisor = buildGreenItAdvisor(snapshot);
  const recommendations = [...advisor.recommendations].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  const healthLabel =
    advisor.score >= 80 ? "Excellent" : advisor.score >= 65 ? "Correct" : "À optimiser";

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ressources</p>
          <h1>Capacité & GreenIT</h1>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">Sync {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/resources?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
        <>
          <section className="panel greenit-hero">
            <div className="greenit-hero-left">
              <div
                className={`advisor-score-ring${advisor.score >= 75 ? " good" : advisor.score >= 50 ? " warn" : " bad"}`}
                style={
                  {
                    "--advisor-progress": `${advisor.score}%`,
                  } as CSSProperties
                }
              >
                <strong>{advisor.score}</strong>
                <span>/100</span>
              </div>
              <div>
                <h2>Infrastructure GreenIT</h2>
                <p className="muted">
                  Niveau: <strong>{healthLabel}</strong> • {snapshot.summary.running} workloads actifs
                </p>
                <p className="muted">
                  PUE {formatDecimal(advisor.config.pue)} • CO2{" "}
                  {formatDecimal(advisor.config.co2FactorKgPerKwh, 3)} kg/kWh
                </p>
              </div>
            </div>

            <div className="greenit-hero-bars">
              <div className="greenit-inline-bar">
                <span>CPU moyen nœuds</span>
                <div className="inventory-progress">
                  <span
                    className="tone-orange"
                    style={{ width: `${Math.round(advisor.metrics.avgNodeCpu * 100)}%` }}
                  />
                </div>
                <strong>{formatPercent(advisor.metrics.avgNodeCpu)}</strong>
              </div>
              <div className="greenit-inline-bar">
                <span>RAM moyenne nœuds</span>
                <div className="inventory-progress">
                  <span
                    className="tone-green"
                    style={{ width: `${Math.round(advisor.metrics.avgNodeMem * 100)}%` }}
                  />
                </div>
                <strong>{formatPercent(advisor.metrics.avgNodeMem)}</strong>
              </div>
            </div>
          </section>

          <section className="advisor-kpi-grid">
            <article className="panel advisor-kpi-card">
              <span className="muted">Puissance estimée IT</span>
              <strong>{formatInt(advisor.metrics.estimatedPowerWatts)} W</strong>
              <small>Sans PUE</small>
            </article>
            <article className="panel advisor-kpi-card">
              <span className="muted">Puissance effective (PUE)</span>
              <strong>{formatInt(advisor.metrics.effectivePowerWatts)} W</strong>
              <small>PUE inclus</small>
            </article>
            <article className="panel advisor-kpi-card">
              <span className="muted">Conso annuelle</span>
              <strong>{formatInt(advisor.metrics.annualKwh)} kWh</strong>
              <small>Estimation</small>
            </article>
            <article className="panel advisor-kpi-card">
              <span className="muted">Coût annuel</span>
              <strong>{formatEuro(advisor.metrics.annualCost)}</strong>
              <small>{formatInt(advisor.metrics.annualCo2Kg)} kg CO2 / an</small>
            </article>
          </section>
        </>
      ) : null}

      <section className="content-grid">
        {(activeTab === "overview" || activeTab === "recommendations") ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Recommandations GreenIT</h2>
            <span className="muted">Optimisation</span>
          </div>

          <div className="advisor-recommendation-list">
            {recommendations.map((rec) => (
              <article key={rec.id} className="advisor-recommendation-item">
                <div className="advisor-rec-top">
                  <span className={`advisor-severity severity-${rec.severity}`}>
                    {severityLabel(rec.severity)}
                  </span>
                  <span className="advisor-category">{rec.category}</span>
                </div>
                <h3>{rec.title}</h3>
                <p className="muted">{rec.rationale}</p>
                <div className="advisor-rec-action">
                  <strong>Action conseillée</strong>
                  <p>{rec.action}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
        ) : null}

        {(activeTab === "overview" || activeTab === "nodes") ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Répartition par nœud</h2>
            <span className="muted">
              {snapshot.nodes.length > 0 ? `${snapshot.nodes.length} nœuds` : "Aucun nœud"}
            </span>
          </div>

          {snapshot.nodes.length === 0 ? (
            <p className="muted">Aucun nœud disponible.</p>
          ) : (
            <div className="advisor-node-list">
              {snapshot.nodes.map((node) => {
                const memRatio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
                const estimatedNodeW = Math.round(110 + node.cpuLoad * 220 + memRatio * 90);

                return (
                  <article key={node.name} className="advisor-node-item">
                    <div className="advisor-node-head">
                      <strong>{node.name}</strong>
                      <span className={`inventory-badge status-${node.status === "online" ? "running" : "stopped"}`}>
                        {node.status}
                      </span>
                    </div>
                    <div className="advisor-node-bars">
                      <div className="greenit-inline-bar">
                        <span>CPU</span>
                        <div className="inventory-progress">
                          <span className="tone-orange" style={{ width: `${Math.round(node.cpuLoad * 100)}%` }} />
                        </div>
                        <strong>{formatPercent(node.cpuLoad)}</strong>
                      </div>
                      <div className="greenit-inline-bar">
                        <span>RAM</span>
                        <div className="inventory-progress">
                          <span className="tone-green" style={{ width: `${Math.round(memRatio * 100)}%` }} />
                        </div>
                        <strong>{formatPercent(memRatio)}</strong>
                      </div>
                    </div>
                    <div className="row-line">
                      <span>Puissance estimée nœud</span>
                      <strong>{estimatedNodeW} W</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

        </section>
        ) : null}
      </section>

      {activeTab === "overview" ? (
      <section className="panel">
        <div className="panel-head">
          <h2>Hypothèses GreenIT</h2>
          <span className="muted">Calcul</span>
        </div>

        <div className="mini-list">
          <article className="mini-list-item">
            <div>
              <div className="item-title">GREENIT_PUE</div>
              <div className="item-subtitle">Impact datacenter (clim, pertes, etc.)</div>
            </div>
            <div className="item-metric">{formatDecimal(advisor.config.pue)}</div>
          </article>
          <article className="mini-list-item">
            <div>
              <div className="item-title">GREENIT_CO2_FACTOR_KG_PER_KWH</div>
              <div className="item-subtitle">Facteur carbone local</div>
            </div>
            <div className="item-metric">{formatDecimal(advisor.config.co2FactorKgPerKwh, 3)}</div>
          </article>
          <article className="mini-list-item">
            <div>
              <div className="item-title">GREENIT_ELECTRICITY_PRICE</div>
              <div className="item-subtitle">Prix du kWh pour estimation coût</div>
            </div>
            <div className="item-metric">{formatDecimal(advisor.config.electricityPricePerKwh)}</div>
          </article>
        </div>
      </section>
      ) : null}
    </section>
  );
}
