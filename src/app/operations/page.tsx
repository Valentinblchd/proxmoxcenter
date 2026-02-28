import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type OperationsPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

const TABS = [
  { id: "overview", label: "Vue" },
  { id: "alerts", label: "Alertes" },
  { id: "logs", label: "Journaux" },
] as const;

async function readSearchParams(
  value: OperationsPageProps["searchParams"],
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

export default async function OperationsPage({ searchParams }: OperationsPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const stopped = snapshot.summary.vms + snapshot.summary.cts - snapshot.summary.running;
  const warningCount = snapshot.warnings.length;
  const live = snapshot.mode === "live";

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Opérations</p>
          <h1>Opérations</h1>
        </div>
        <div className="topbar-meta">
          {live ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/operations?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-tile">
          <div className="stat-label">Workloads actifs</div>
          <div className="stat-value">{snapshot.summary.running}</div>
          <div className="stat-subtle">VM + CT</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Workloads arrêtés</div>
          <div className="stat-value">{Math.max(0, stopped)}</div>
          <div className="stat-subtle">Potentiel nettoyage</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Nœuds</div>
          <div className="stat-value">{snapshot.summary.nodes}</div>
          <div className="stat-subtle">Portée opérationnelle</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Alertes actives</div>
          <div className="stat-value">{warningCount}</div>
          <div className="stat-subtle">Warnings API</div>
        </article>
      </section>

      <section className="content-grid hub-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>{TABS.find((tab) => tab.id === activeTab)?.label}</h2>
            <span className="muted">{live ? "Flux live" : "Flux offline"}</span>
          </div>

          {activeTab === "overview" ? (
            <div className="mini-list">
              {[
                { title: "Alertes actives", href: "/operations?tab=alerts", metric: warningCount },
                { title: "Journaux", href: "/operations?tab=logs", metric: live ? "live" : "offline" },
                { title: "Sauvegardes", href: "/backups", metric: "backup" },
                { title: "Observabilité", href: "/observability", metric: "métriques" },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="mini-list-item mini-list-link">
                  <div>
                    <div className="item-title">{item.title}</div>
                  </div>
                  <div className="item-metric">{item.metric}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="stack-sm">
              <div className="row-line">
                <span>Source de données</span>
                <strong className={live ? "status-good" : undefined}>{live ? "Live" : "Offline"}</strong>
              </div>
              <div className="row-line">
                <span>Warnings remontés</span>
                <strong>{warningCount}</strong>
              </div>
              <div className="row-line">
                <span>Dernière synchro</span>
                <strong>{formatRelativeTime(snapshot.lastUpdatedAt)}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>État actuel</h2>
            <span className="muted">Synthèse</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>État global</span>
              <strong className={live ? "status-good" : undefined}>{live ? "Stable" : "Dégradé"}</strong>
            </div>
            <div className="row-line">
              <span>Workloads actifs</span>
              <strong>{snapshot.summary.running}</strong>
            </div>
            <div className="row-line">
              <span>Workloads arrêtés</span>
              <strong>{Math.max(0, stopped)}</strong>
            </div>
          </div>
          <div className="quick-actions">
            <Link href="/inventory" className="action-btn">
              Inventaire
            </Link>
            <Link href="/backups" className="action-btn">
              Sauvegardes
            </Link>
            <Link href="/observability" className="action-btn primary">
              Observabilité
            </Link>
          </div>
        </section>
      </section>
    </section>
  );
}
