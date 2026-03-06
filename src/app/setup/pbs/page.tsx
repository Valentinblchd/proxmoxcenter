import type { Metadata } from "next";
import Link from "next/link";
import PbsConnectionForm from "@/components/pbs-connection-form";

export const metadata: Metadata = {
  title: "Connexion PBS | ProxCenter",
  description: "Configurer Proxmox Backup Server pour les imports directs depuis le cloud.",
};

export const dynamic = "force-dynamic";

export default function SetupPbsPage() {
  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Connexions</p>
          <h1>Configurer Proxmox Backup Server</h1>
        </div>
      </header>

      <PbsConnectionForm />

      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Exemple PBS</h2>
            <span className="muted">Connexion directe</span>
          </div>
          <div className="stack-sm">
            <div className="mini-summary">
              <span className="mini-label">Host</span>
              <code>pbs.home.local</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">Datastore</span>
              <code>backups</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">Auth ID</span>
              <code>backup@pbs!proxcenter</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">Namespace</span>
              <code>imports/cloud</code>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Suite</h2>
            <span className="muted">Usage</span>
          </div>
          <div className="quick-actions">
            <Link href="/backups?tab=restore" className="action-btn primary">
              Ouvrir restauration cloud
            </Link>
            <Link href="/settings?tab=proxmox" className="action-btn">
              Voir Proxmox
            </Link>
          </div>
        </section>
      </section>
    </section>
  );
}
