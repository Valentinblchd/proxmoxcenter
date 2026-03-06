import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import AuthUiSettingsPanel from "@/components/auth-ui-settings-panel";
import LocalUsersSettings from "@/components/local-users-settings";
import SecurityAuditLogPanel from "@/components/security-audit-log-panel";
import { buildSecurityAdvisor } from "@/lib/insights/advisor";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { readRuntimeAuthConfig } from "@/lib/auth/runtime-config";
import { readRuntimeAuditLog } from "@/lib/audit/runtime-log";
import { readRuntimeProxmoxConfig } from "@/lib/proxmox/runtime-config";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { formatRelativeTime } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "Sécurité | ProxCenter",
  description: "Sécurité plateforme, accès utilisateurs, sessions et journal sécurité.",
};

export const dynamic = "force-dynamic";

type SecurityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "overview", label: "Vue globale" },
  { id: "users", label: "Utilisateurs" },
  { id: "sessions", label: "Sessions & accès" },
  { id: "logs", label: "Journaux" },
] as const;

async function readSearchParams(
  value: SecurityPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function severityLabel(severity: "critical" | "high" | "medium" | "low") {
  if (severity === "critical") return "Critique";
  if (severity === "high") return "Élevée";
  if (severity === "medium") return "Moyenne";
  return "Faible";
}

export default async function SecurityPage({ searchParams }: SecurityPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const advisor = buildSecurityAdvisor(snapshot);
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  const runtimeAuth = readRuntimeAuthConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const canAdmin = session?.role === "admin";
  const localUsers =
    runtimeAuth?.users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      enabled: user.enabled,
      isPrimary: runtimeAuth.primaryUserId === user.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      sessionRevokedAt: user.sessionRevokedAt,
    })) ?? [];
  const recommendations = [...advisor.recommendations].sort((left, right) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return order[left.severity] - order[right.severity];
  });
  const auditLog = readRuntimeAuditLog();

  const legacySecurityLogs = [
    ...localUsers
      .filter((user) => user.lastLoginAt)
      .map((user) => ({
        id: `login-${user.id}`,
        at: user.lastLoginAt as string,
        severity: "info" as const,
        category: "auth" as const,
        action: "login.success",
        summary: `${user.username} connecté`,
        actor: {
          username: user.username,
          role: user.role,
          authMethod: "local" as const,
          userId: user.id,
        },
        targetType: "session",
        targetId: user.id,
        targetLabel: user.username,
        changes: [],
        details: {},
      })),
    ...localUsers
      .filter((user) => user.sessionRevokedAt)
      .map((user) => ({
        id: `revoke-${user.id}`,
        at: user.sessionRevokedAt as string,
        severity: "warning" as const,
        category: "security" as const,
        action: "session.revoke",
        summary: `Sessions révoquées pour ${user.username}`,
        actor: {
          username: user.username,
          role: user.role,
          authMethod: "local" as const,
          userId: user.id,
        },
        targetType: "session",
        targetId: user.id,
        targetLabel: user.username,
        changes: [],
        details: {},
      })),
  ]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 40);
  const securityLogs = [...auditLog.entries, ...legacySecurityLogs]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 200);

  return (
    <section className="content security-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sécurité</p>
          <h1>Accès, posture et journaux</h1>
          <p className="muted">Comptes locaux, sessions UI et audit des changements sur la plateforme.</p>
        </div>
        <div className="topbar-meta">
          {snapshot.mode === "live" ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
        </div>
      </header>

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
              <h2>Posture sécurité</h2>
              <span className="muted">Score {advisor.score}/100</span>
            </div>
            <div className="mini-list">
              {recommendations.slice(0, 5).map((rec) => (
                <article key={rec.id} className="mini-list-item">
                  <div>
                    <div className="item-title">{rec.title}</div>
                    <div className="item-subtitle">{rec.action}</div>
                  </div>
                  <div className="item-metric">{severityLabel(rec.severity)}</div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Actions immédiates</h2>
              <span className="muted">Sécurité compte</span>
            </div>
            <div className="quick-actions">
              <Link href="/security?tab=users" className="action-btn primary">
                Gérer les utilisateurs
              </Link>
              <Link href="/security?tab=sessions" className="action-btn">
                Gérer les sessions
              </Link>
              <Link href="/security?tab=logs" className="action-btn">
                Voir les journaux
              </Link>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Comptes locaux</span>
                <strong>{localUsers.length}</strong>
              </div>
              <div className="row-line">
                <span>Comptes actifs</span>
                <strong>{localUsers.filter((user) => user.enabled).length}</strong>
              </div>
              <div className="row-line">
                <span>LDAP</span>
                <strong>{proxmoxRuntime?.ldap.enabled ? "Activé" : "Désactivé"}</strong>
              </div>
              <div className="row-line">
                <span>Rôle courant</span>
                <strong>{session?.role ?? "reader"}</strong>
              </div>
              <div className="row-line">
                <span>Capacité opérationnelle</span>
                <strong>{canOperate ? "Oui" : "Lecture seule"}</strong>
              </div>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "users" ? (
        canAdmin ? (
          <section className="panel">
            <LocalUsersSettings initialUsers={localUsers} currentUsername={session?.username ?? null} />
          </section>
        ) : (
          <section className="panel">
            <p className="muted">Compte admin requis pour gérer les utilisateurs.</p>
          </section>
        )
      ) : null}

      {activeTab === "sessions" ? (
        canAdmin ? (
          <section className="panel">
            <AuthUiSettingsPanel
              initialSettings={
                runtimeAuth
                  ? {
                      sessionTtlHours: Math.max(1, Math.round(runtimeAuth.sessionTtlSeconds / 3600)),
                      secureCookie: runtimeAuth.secureCookie,
                      primaryUsername: runtimeAuth.username,
                      localUsersCount: runtimeAuth.users.length,
                      enabledUsersCount: runtimeAuth.users.filter((user) => user.enabled).length,
                    }
                  : null
              }
              ldapSecondaryEnabled={Boolean(proxmoxRuntime?.ldap.enabled)}
            />
          </section>
        ) : (
          <section className="panel">
            <p className="muted">Compte admin requis pour gérer les sessions UI.</p>
          </section>
        )
      ) : null}

      {activeTab === "logs" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Journaux sécurité</h2>
            <span className="muted">{securityLogs.length}</span>
          </div>
          {securityLogs.length === 0 ? (
            <p className="muted">Aucun événement sécurité local récent.</p>
          ) : (
            <SecurityAuditLogPanel entries={securityLogs} />
          )}
          {snapshot.warnings.length > 0 ? (
            <div className="warning">
              {snapshot.warnings[0]}
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
