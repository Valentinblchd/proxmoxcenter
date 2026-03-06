"use client";

import Link from "next/link";
import BrandLogo from "@/components/brand-logo";

type DiagnosticTone = "default" | "good" | "warn" | "bad";

type DiagnosticItem = {
  label: string;
  value: string;
  tone?: DiagnosticTone;
};

export default function ErrorStateScreen({
  eyebrow,
  code,
  title,
  description,
  detail,
  diagnostics,
  actions,
  standalone = false,
}: {
  eyebrow: string;
  code: string;
  title: string;
  description: string;
  detail?: React.ReactNode;
  diagnostics?: DiagnosticItem[];
  actions?: React.ReactNode;
  standalone?: boolean;
}) {
  return (
    <main className={standalone ? "error-state-standalone" : undefined}>
      <section className={`content error-state-shell${standalone ? " is-standalone" : ""}`}>
        <div className="error-state-grid">
          <section className="panel error-state-hero">
            <div className="error-state-brand">
              <span className="brand-logo-wrap">
                <BrandLogo className="brand-logo" />
              </span>
              <span>ProxCenter</span>
            </div>
            <p className="eyebrow">{eyebrow}</p>
            <div className="error-state-code">{code}</div>
            <h1>{title}</h1>
            <p className="muted error-state-description">{description}</p>
            {detail ? <div className="error-state-detail">{detail}</div> : null}
            <div className="quick-actions error-state-actions">
              {actions ?? (
                <>
                  <Link href="/" className="action-btn primary">
                    Retour accueil
                  </Link>
                  <Link href="/inventory" className="action-btn">
                    Ouvrir inventaire
                  </Link>
                </>
              )}
            </div>
          </section>

          <aside className="panel error-state-panel">
            <div className="panel-head">
              <h2>Diagnostic rapide</h2>
              <span className="muted">Actionnable</span>
            </div>
            <div className="stack-sm">
              {(diagnostics ?? []).map((item) => (
                <div key={`${item.label}-${item.value}`} className="row-line">
                  <span>{item.label}</span>
                  <strong
                    className={
                      item.tone === "good"
                        ? "status-good"
                        : item.tone === "warn"
                          ? "status-warn"
                          : item.tone === "bad"
                            ? "status-bad"
                            : undefined
                    }
                  >
                    {item.value}
                  </strong>
                </div>
              ))}
              <div className="hint-box error-state-note">
                <p className="muted">
                  Si le problème persiste, repasse par l’accueil ou l’inventaire puis vérifie les
                  journaux et la connexion Proxmox.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
