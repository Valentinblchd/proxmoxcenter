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
    <section className="content backups-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sauvegardes</p>
          <h1>Sauvegardes locales et cloud</h1>
          <p className="muted">Configuration, suivi des exécutions, historique et restauration au même endroit.</p>
        </div>
        <div className="topbar-meta" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
          {snapshot.mode === "live" ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="pill">{canOperate ? "Mode opérateur" : "Lecture seule"}</span>
        </div>
      </header>

      <PlatformStateAlerts live={snapshot.mode === "live"} warnings={snapshot.warnings} />

      <BackupPlannerPanel initialTab={initialTab} initialConfigTab={initialConfigTab} canOperate={canOperate} />
    </section>
  );
}
