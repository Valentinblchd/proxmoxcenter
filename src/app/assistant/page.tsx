import Link from "next/link";
import ProvisioningStudio from "@/components/provisioning-studio";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Assistant</p>
          <h1>Assistant IA (guidé)</h1>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Live</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <section className="content-grid assistant-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>Exemples de demandes</h2>
            <span className="muted">Prompt assisté</span>
          </div>
          <div className="mini-list">
            {[
              "Crée un serveur Windows 2022, 4 vCPU, 8 Go RAM, 120 Go",
              "Crée une VM Ubuntu 2 CPU 4 Go 40 Go nommée app-web-01",
              "Crée un conteneur Debian LXC 2 CPU 2 Go 16 Go",
            ].map((example) => (
              <article key={example} className="mini-list-item">
                <div>
                  <div className="item-title">Prompt</div>
                  <div className="item-subtitle">{example}</div>
                </div>
                <div className="item-metric">→</div>
              </article>
            ))}
          </div>
          <div className="quick-actions">
            <Link href="/provision" className="action-btn">
              Wizard direct
            </Link>
            <Link href="/console" className="action-btn primary">
              Console / Shell
            </Link>
          </div>
        </section>

        <ProvisioningStudio mode="assistant" />
      </section>
    </section>
  );
}
