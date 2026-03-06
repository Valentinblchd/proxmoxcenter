import type { Metadata } from "next";
import Link from "next/link";
import ProxmoxConnectionForm from "@/components/proxmox-connection-form";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

export const metadata: Metadata = {
  title: "Connexion Proxmox | ProxCenter",
  description: "Assistant de connexion Proxmox VE (DNS/IP, port, TLS/certificats, LDAP, token API)",
};

export const dynamic = "force-dynamic";

export default async function SetupConnectionPage() {
  const snapshot = await getDashboardSnapshot();

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Connexions</p>
          <h1>Configurer Proxmox VE</h1>
        </div>
        <div className="topbar-meta">
          {snapshot.mode === "live" ? (
            <span className="pill live">Proxmox connecté</span>
          ) : (
            <span className="pill">Hors ligne</span>
          )}
        </div>
      </header>

      <ProxmoxConnectionForm />

      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Exemple de token</h2>
            <span className="muted">Proxmox VE</span>
          </div>
          <div className="stack-sm">
            <div className="mini-summary">
              <span className="mini-label">Host DNS</span>
              <code>pve.home.local</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">URL générée</span>
              <code>https://pve.home.local:8006</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">Token ID</span>
              <code>root@pam!proxcenter</code>
            </div>
            <div className="mini-summary">
              <span className="mini-label">TLS</span>
              <span className="mini-value">Strict recommandé (CA custom si interne)</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Après configuration</h2>
            <span className="muted">Étapes suivantes</span>
          </div>
          <div className="quick-actions">
            <Link href="/inventory" className="action-btn primary">
              Ouvrir inventaire
            </Link>
            <Link href="/inventory?tab=nodes" className="action-btn">
              Voir les nœuds
            </Link>
            <Link href="/security" className="action-btn">
              Assistant sécurité
            </Link>
          </div>
        </section>
      </section>
    </section>
  );
}
