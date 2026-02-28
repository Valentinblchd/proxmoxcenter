import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppAuthSetupForm from "@/components/app-auth-setup-form";
import { getAuthStatus } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Auth UI | ProxCenter",
  description: "Configurer l’authentification locale de ProxCenter depuis l’interface",
};

export const dynamic = "force-dynamic";

export default async function SetupAuthPage() {
  const auth = getAuthStatus();
  if (auth.active) {
    redirect("/settings?tab=users");
  }

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Setup Auth</p>
          <h1>Configurer l’authentification locale</h1>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${auth.active ? "live" : ""}`}>
            {auth.active ? "Auth active" : "Auth inactive"}
          </span>
        </div>
      </header>

      <AppAuthSetupForm />

      <section className="panel">
        <div className="panel-head">
          <h2>Suite logique</h2>
          <span className="muted">Bootstrap</span>
        </div>
        <div className="quick-actions">
          <Link href="/setup/connection" className="action-btn primary">
            Configurer Proxmox
          </Link>
          <Link href="/login" className="action-btn">
            Tester le login
          </Link>
          <Link href="/" className="action-btn">
            Retour accueil
          </Link>
        </div>
      </section>
    </section>
  );
}
