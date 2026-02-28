import { cookies } from "next/headers";
import BackupPlannerPanel from "@/components/backup-planner-panel";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type BackupsPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function readSearchParams(
  value: BackupsPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  if (typeof (value as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    return (await value) ?? {};
  }
  return value ?? {};
}

export default async function BackupsPage({ searchParams }: BackupsPageProps) {
  const params = await readSearchParams(searchParams);
  const requestedTab = readString(params.tab);
  const initialTab =
    requestedTab === "overview" ||
    requestedTab === "plans" ||
    requestedTab === "targets" ||
    requestedTab === "history" ||
    requestedTab === "restore" ||
    requestedTab === "pbs"
      ? requestedTab
      : "overview";

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
          <h1>Sauvegardes locales, cloud et planification</h1>
        </div>
        <div className="topbar-meta">
          {snapshot.mode === "live" ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

      <BackupPlannerPanel initialTab={initialTab} canOperate={canOperate} />
    </section>
  );
}
