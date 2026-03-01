import Link from "next/link";
import { cookies } from "next/headers";
import AssistantMemorySettings from "@/components/assistant-memory-settings";
import AuthUiSettingsPanel from "@/components/auth-ui-settings-panel";
import CloudOauthSettings from "@/components/cloud-oauth-settings";
import LocalUsersSettings from "@/components/local-users-settings";
import ThemeSettingsPanel from "@/components/theme-settings-panel";
import { readAssistantMemory } from "@/lib/assistant/memory";
import { AUTH_COOKIE_NAME, getAuthStatus, verifySessionToken } from "@/lib/auth/session";
import { getPublicCloudOauthAppStatus } from "@/lib/backups/oauth-app-config";
import { readRuntimeAuthConfig } from "@/lib/auth/runtime-config";
import { readRuntimePbsConfig } from "@/lib/pbs/runtime-config";
import { readPbsToolingStatus } from "@/lib/pbs/tooling";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { readRuntimeProxmoxConfig, maskSecret } from "@/lib/proxmox/runtime-config";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function readSearchParams(
  value: SettingsPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const TABS = [
  { id: "connections", label: "Connexions" },
  { id: "users", label: "Utilisateurs locaux" },
  { id: "access", label: "Session & accès" },
  { id: "appearance", label: "Apparence" },
  { id: "ai", label: "Mémoire IA" },
] as const;

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "connections";

  const authStatus = getAuthStatus();
  const runtimeAuth = readRuntimeAuthConfig();
  const proxmoxEffective = getProxmoxConfig();
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  const pbsRuntime = readRuntimePbsConfig();
  const pbsTooling = await readPbsToolingStatus();
  const cloudOauthProviders = getPublicCloudOauthAppStatus();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const assistantMemory = readAssistantMemory(session?.username ?? "default");
  const proxmoxConnected = Boolean(proxmoxEffective);
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

  return (
    <section className="content settings-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Paramètres</p>
          <h1>Paramètres</h1>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${authStatus.active ? "live" : ""}`}>
            {authStatus.active ? "Compte local actif" : "Compte local inactif"}
          </span>
          {proxmoxConnected ? <span className="pill live">Proxmox configuré</span> : <span className="pill">Proxmox non configuré</span>}
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/settings?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{TABS.find((tab) => tab.id === activeTab)?.label ?? "Paramètres"}</h2>
          <span className="muted">
            {activeTab === "users" ? `${localUsers.length} compte(s)` : null}
            {activeTab === "connections" ? `${proxmoxConnected ? "Proxmox actif" : "Proxmox non configuré"}` : null}
            {activeTab === "access" ? `${runtimeAuth ? Math.max(1, Math.round(runtimeAuth.sessionTtlSeconds / 3600)) : 12}h session` : null}
            {activeTab === "appearance" ? "Thèmes" : null}
            {activeTab === "ai" ? "Mémoire" : null}
          </span>
        </div>

        {activeTab === "connections" ? (
          <div className="settings-sections">
            <section className="settings-block">
              <div className="panel-head">
                <h2>Connexion Proxmox</h2>
                <span className="muted">{proxmoxEffective ? "Active" : "À configurer"}</span>
              </div>
              <div className="stack-sm">
                <div className="row-line">
                  <span>URL</span>
                  <strong>{proxmoxRuntime?.baseUrl ?? "Non configurée"}</strong>
                </div>
                <div className="row-line">
                  <span>Token ID</span>
                  <strong>{proxmoxRuntime?.tokenId ?? "—"}</strong>
                </div>
                <div className="row-line">
                  <span>Token secret</span>
                  <strong>{proxmoxRuntime ? maskSecret(proxmoxRuntime.tokenSecret) : "—"}</strong>
                </div>
                <div className="row-line">
                  <span>LDAP secondaire</span>
                  <strong>{proxmoxRuntime?.ldap.enabled ? "Activé" : "Désactivé"}</strong>
                </div>
                <div className="row-line">
                  <span>Dernière MAJ</span>
                  <strong>
                    {proxmoxRuntime?.updatedAt ? formatRelativeTime(proxmoxRuntime.updatedAt) : "—"}
                  </strong>
                </div>
                <div className="setup-actions">
                  <Link href="/setup/connection" className="action-btn primary">
                    Ouvrir la connexion Proxmox
                  </Link>
                </div>
              </div>
            </section>

            <section className="settings-block">
              <div className="panel-head">
                <h2>Connexion PBS</h2>
                <span className="muted">{pbsRuntime ? "Optionnel actif" : "Optionnel"}</span>
              </div>
              <div className="stack-sm">
                <div className="row-line">
                  <span>Host</span>
                  <strong>{pbsRuntime?.host ?? "Non configuré"}</strong>
                </div>
                <div className="row-line">
                  <span>Datastore</span>
                  <strong>{pbsRuntime?.datastore ?? "—"}</strong>
                </div>
                <div className="row-line">
                  <span>Auth ID</span>
                  <strong>{pbsRuntime?.authId ?? "—"}</strong>
                </div>
                <div className="row-line">
                  <span>Tooling PBS</span>
                  <strong className={pbsTooling.available ? "status-good" : "status-bad"}>
                    {pbsTooling.available ? "OK" : "Absent"}
                  </strong>
                </div>
                <div className="setup-actions">
                  <Link href="/setup/pbs" className="action-btn">
                    Ouvrir la connexion PBS
                  </Link>
                </div>
              </div>
            </section>

            {canAdmin ? <CloudOauthSettings initialProviders={cloudOauthProviders} canAdmin={canAdmin} /> : null}
          </div>
        ) : null}

        {activeTab === "users" ? (
          <LocalUsersSettings
            initialUsers={localUsers}
            currentUsername={session?.username ?? null}
          />
        ) : null}

        {activeTab === "access" ? (
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
        ) : null}

        {activeTab === "appearance" ? <ThemeSettingsPanel /> : null}

        {activeTab === "ai" ? <AssistantMemorySettings memory={assistantMemory} /> : null}
      </section>
    </section>
  );
}
