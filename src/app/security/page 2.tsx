import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
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

export const metadata: Metadata = {
  title: "Sécurité | ProxCenter",
  description: "Assistant sécurité (heuristique locale) et recommandations Proxmox",
};

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const advisor = buildSecurityAdvisor(snapshot);
  const recommendations = [...advisor.recommendations].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  const signalCards = [
    {
      label: "Auth UI",
      value: advisor.signals.authEnabled ? "Activée" : "Désactivée",
      state: advisor.signals.authEnabled ? "good" : "bad",
    },
    {
      label: "Auth configurée",
      value: advisor.signals.authConfigured ? "OK" : "Incomplète",
      state: advisor.signals.authConfigured ? "good" : "warn",
    },
    {
      label: "Token Proxmox",
      value: advisor.signals.proxmoxConfigured ? "Configuré" : "Absent",
      state: advisor.signals.proxmoxConfigured ? "good" : "warn",
    },
    {
      label: "TLS Proxmox",
      value: advisor.signals.insecureTls ? "Insecure" : "Vérifié",
      state: advisor.signals.insecureTls ? "bad" : "good",
    },
  ] as const;

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sécurité</p>
          <h1>Assistant sécurité</h1>
          <p className="muted">
            Recommandations automatiques pour l’interface ProxCenter et la connexion Proxmox.
          </p>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="pill">IA locale (heuristique)</span>
          <span className="muted">Sync {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <section className="content-grid">
        <section className="panel advisor-score-panel">
          <div className="panel-head">
            <h2>Score sécurité</h2>
            <span className="muted">Actuel</span>
          </div>

          <div className="advisor-score-wrap">
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

            <div className="advisor-score-meta">
              <div className="row-line">
                <span>Recommandations</span>
                <strong>{recommendations.length}</strong>
              </div>
              <div className="row-line">
                <span>Workloads actifs</span>
                <strong>{snapshot.summary.running}</strong>
              </div>
              <div className="row-line">
                <span>Mode d’analyse</span>
                <strong>Heuristique locale</strong>
              </div>
              <div className="row-line">
                <span>API JSON</span>
                <strong>
                  <Link href="/api/ai/recommendations">/api/ai/recommendations</Link>
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Signaux détectés</h2>
            <span className="muted">Auth / API / TLS</span>
          </div>

          <div className="advisor-signal-grid">
            {signalCards.map((signal) => (
              <article key={signal.label} className={`advisor-signal-card state-${signal.state}`}>
                <span className="advisor-signal-label">{signal.label}</span>
                <strong>{signal.value}</strong>
              </article>
            ))}
          </div>

          <div className="hint-box">
            <p className="muted">
              Les recommandations sont calculées localement à partir de l’état de configuration.
            </p>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Recommandations prioritaires</h2>
          <span className="muted">Triées par sévérité</span>
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

      <section className="panel">
        <div className="panel-head">
          <h2>Actions rapides</h2>
          <span className="muted">Navigation</span>
        </div>
        <div className="quick-actions">
          <Link href="/inventory" className="action-btn primary">
            Ouvrir l’inventaire
          </Link>
          <Link href="/operations?tab=logs" className="action-btn">
            Voir les journaux
          </Link>
          <Link href="/settings?tab=security" className="action-btn">
            Sécurité du compte
          </Link>
        </div>
      </section>
    </section>
  );
}
