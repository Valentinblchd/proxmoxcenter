import { cookies } from "next/headers";
import BackupPlannerPanel from "@/components/backup-planner-panel";
import PlatformStateAlerts from "@/components/platform-state-alerts";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

export const dynamic = "force-dynamic";

type BackupsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function readSearchParams(
  value: BackupsPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

export default async function BackupsPage({ searchParams }: BackupsPageProps) {
  const params = await readSearchParams(searchParams);
  const requestedTab = readString(params.tab);
  const initialTab =
    requestedTab === "overview" ||
    requestedTab === "config" ||
    requestedTab === "history" ||
    requestedTab === "restore" ||
    requestedTab === "pbs" ||
    requestedTab === "plans" ||
    requestedTab === "targets"
      ? requestedTab === "plans" || requestedTab === "targets"
        ? "config"
        : requestedTab
      : "overview";
  const initialConfigTab = requestedTab === "plans" ? "plans" : "targets";

  const snapshot = await getDashboardSnapshot();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");

  return (
    <section className="content content-wide backups-page">
      <header className="topbar backup-page-hero backup-page-hero-compact">
        <div className="backup-page-hero-copy">
          <p className="eyebrow">Sauvegardes</p>
          <h1>Centre de sauvegarde</h1>
          <p className="muted">
            Configure les destinations, suis les runs et restaure sans te perdre entre plusieurs écrans.
          </p>
          <div className="backup-page-hero-chips" aria-label="Points clés sauvegardes">
            <span className="inventory-tag">Suivi en direct</span>
            <span className="inventory-tag">Local et cloud</span>
            <span className="inventory-tag">Restauration guidée</span>
          </div>
        </div>
        <div className="topbar-meta backup-page-topbar-meta">
          {snapshot.mode === "live" ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="pill">{canOperate ? "Mode opérateur" : "Lecture seule"}</span>
        </div>
      </header>

      <section className="stats-grid backup-page-summary-strip">
        <article className="stat-tile">
          <div className="stat-label">Environnement</div>
          <div className="stat-value">{snapshot.mode === "live" ? "Connecté" : "Hors ligne"}</div>
          <div className="stat-subtle">
            {snapshot.mode === "live" ? "Connexion Proxmox active" : "Instance hors ligne"}
          </div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Accès</div>
          <div className="stat-value">{canOperate ? "Opérateur" : "Lecture"}</div>
          <div className="stat-subtle">
            {canOperate ? "Actions et restauration disponibles" : "Consultation uniquement"}
          </div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Alertes</div>
          <div className="stat-value">{snapshot.warnings.length}</div>
          <div className="stat-subtle">Blocages et avertissements à traiter</div>
        </article>
      </section>

      <PlatformStateAlerts live={snapshot.mode === "live"} warnings={snapshot.warnings} />

      <BackupPlannerPanel initialTab={initialTab} initialConfigTab={initialConfigTab} canOperate={canOperate} />
    </section>
  );
}
