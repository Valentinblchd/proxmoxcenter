import type { Metadata } from "next";
import Link from "next/link";
import { buildSecurityAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

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

function formatSignal(value: boolean, okLabel: string, badLabel: string) {
  return value ? okLabel : badLabel;
}

export const metadata: Metadata = {
  title: "Sécurité | ProxCenter",
  description: "Audit sécurité local de la configuration ProxCenter / Proxmox",
};

export const dynamic = "force-dynamic";

type SecurityPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

const TABS = [
  { id: "overview", label: "Vue globale" },
  { id: "recommendations", label: "Recommandations" },
  { id: "actions", label: "Actions immédiates" },
] as const;

async function readSearchParams(
  value: SecurityPageProps["searchParams"],
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

export default async function SecurityPage({ searchParams }: SecurityPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const advisor = buildSecurityAdvisor(snapshot);
  const recommendations = [...advisor.recommendations].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
  const topSeverity = recommendations[0]?.severity ?? "low";
  const postureTone =
    topSeverity === "critical" || topSeverity === "high"
      ? "bad"
      : topSeverity === "medium"
        ? "warn"
        : "good";
  const postureLabel =
    topSeverity === "critical" || topSeverity === "high"
      ? "À renforcer"
      : topSeverity === "medium"
        ? "Correcte"
        : "Solide";

  const signalRows = [
    {
      label: "Authentification UI",
      value: formatSignal(advisor.signals.authEnabled, "Activée", "Désactivée"),
    },
    {
      label: "Configuration auth",
      value: formatSignal(advisor.signals.authConfigured, "OK", "Incomplète"),
    },
    {
      label: "Token API Proxmox",
      value: formatSignal(advisor.signals.proxmoxConfigured, "Configuré", "Absent"),
    },
    {
      label: "Validation TLS",
      value: formatSignal(!advisor.signals.insecureTls, "Vérifiée", "Insecure"),
    },
  ] as const;

  return (
    <section className="content security-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sécurité</p>
          <h1>Posture sécurité</h1>
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

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/security?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>État global</h2>
              <span className={`advisor-severity severity-${topSeverity}`}>{postureLabel}</span>
            </div>

            <article className={`advisor-signal-card state-${postureTone}`}>
              <span className="advisor-signal-label">Analyse locale</span>
              <strong>
                {recommendations.length} recommandation{recommendations.length > 1 ? "s" : ""} prioritaire
                {recommendations.length > 1 ? "s" : ""}
              </strong>
            </article>

            <div className="stack-sm" style={{ marginTop: "0.7rem" }}>
              {signalRows.map((item) => (
                <div key={item.label} className="row-line">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Actions immédiates</h2>
              <span className="muted">Sans interruption</span>
            </div>
            <div className="quick-actions">
              <Link href="/settings?tab=security" className="action-btn primary">
                Durcir le compte
              </Link>
              <Link href="/settings?tab=connection" className="action-btn">
                Vérifier le token API
              </Link>
              <Link href="/operations?tab=logs" className="action-btn">
                Contrôler les logs
              </Link>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "actions" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Actions immédiates</h2>
            <span className="muted">Sans interruption</span>
          </div>
          <div className="quick-actions">
            <Link href="/settings?tab=security" className="action-btn primary">
              Durcir le compte
            </Link>
            <Link href="/settings?tab=connection" className="action-btn">
              Vérifier le token API
            </Link>
            <Link href="/operations?tab=logs" className="action-btn">
              Contrôler les logs
            </Link>
          </div>
        </section>
      ) : null}

      {activeTab === "recommendations" || activeTab === "overview" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Recommandations priorisées</h2>
            <span className="muted">Tri par sévérité</span>
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
    </section>
  );
}
