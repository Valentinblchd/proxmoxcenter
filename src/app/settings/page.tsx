import Link from "next/link";
import { cookies } from "next/headers";
import AssistantMemorySettings from "@/components/assistant-memory-settings";
import { readAssistantMemory } from "@/lib/assistant/memory";
import { AUTH_COOKIE_NAME, getAuthStatus, verifySessionToken } from "@/lib/auth/session";
import { readRuntimeAuthConfig } from "@/lib/auth/runtime-config";
import { readRuntimePbsConfig } from "@/lib/pbs/runtime-config";
import { readPbsToolingStatus } from "@/lib/pbs/tooling";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { readRuntimeProxmoxConfig, maskSecret } from "@/lib/proxmox/runtime-config";
import { formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

async function readSearchParams(
  value: SettingsPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  if (typeof (value as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    return (await value) ?? {};
  }
  return value ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const TABS = [
  { id: "overview", label: "Vue globale" },
  { id: "connection", label: "Connexion Proxmox" },
  { id: "pbs", label: "Connexion PBS" },
  { id: "auth", label: "Auth UI" },
  { id: "profile", label: "Profil" },
  { id: "security", label: "Sécurité compte" },
  { id: "ai", label: "Mémoire IA" },
] as const;

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const authStatus = getAuthStatus();
  const runtimeAuth = readRuntimeAuthConfig();
  const proxmoxEffective = getProxmoxConfig();
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  const pbsRuntime = readRuntimePbsConfig();
  const pbsTooling = await readPbsToolingStatus();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const assistantMemory = readAssistantMemory(session?.username ?? "default");
  const proxmoxConnected = Boolean(proxmoxEffective);
  const ldapEnabled = Boolean(proxmoxRuntime?.ldap.enabled);

  return (
    <section className="content settings-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Paramètres</p>
          <h1>Paramètres unifiés</h1>
        </div>
        <div className="topbar-meta">
          {authStatus.active ? <span className="pill live">Compte local actif</span> : <span className="pill">Compte local inactif</span>}
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

      <section className="content-grid hub-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>
              {TABS.find((tab) => tab.id === activeTab)?.label ?? "Paramètres"}
            </h2>
            <span className="muted">Configuration</span>
          </div>

          {activeTab === "overview" ? (
            <div className="mini-list">
              <article className="mini-list-item">
                <div>
                  <div className="item-title">Connexion Proxmox</div>
                  <div className="item-subtitle">
                    {proxmoxEffective
                      ? `${proxmoxEffective.baseUrl} · ${proxmoxEffective.tokenId}`
                      : "Non configurée"}
                  </div>
                </div>
                <div className="item-metric">
                  {proxmoxEffective ? "OK" : "—"}
                </div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">Auth UI</div>
                  <div className="item-subtitle">
                    {authStatus.active
                      ? `Utilisateur: ${runtimeAuth?.username ?? "admin"}`
                      : "Non configurée"}
                  </div>
                </div>
                <div className="item-metric">{authStatus.active ? "ON" : "OFF"}</div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">Connexion PBS</div>
                  <div className="item-subtitle">
                    {pbsRuntime
                      ? `${pbsRuntime.host}:${pbsRuntime.port} · datastore ${pbsRuntime.datastore}`
                      : "Non configurée"}
                  </div>
                </div>
                <div className="item-metric">{pbsRuntime ? "OK" : "—"}</div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">Sécurité cookie</div>
                  <div className="item-subtitle">
                    {runtimeAuth?.secureCookie ? "Secure cookie activé (HTTPS)" : "Mode local/dev"}
                  </div>
                </div>
                <div className="item-metric">{runtimeAuth?.secureCookie ? "TLS" : "DEV"}</div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">Mémoire IA</div>
                  <div className="item-subtitle">
                    {assistantMemory.firstName
                      ? `Prénom: ${assistantMemory.firstName}`
                      : "Prénom non défini"}{" "}
                    • {assistantMemory.lastQuestions.length} question(s)
                  </div>
                </div>
                <div className="item-metric">
                  {assistantMemory.lastQuestions.length > 0 || assistantMemory.firstName
                    ? "ON"
                    : "OFF"}
                </div>
              </article>
            </div>
          ) : null}

          {activeTab === "connection" ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>URL Proxmox</span>
                <strong>{proxmoxRuntime?.baseUrl ?? "Non configurée"}</strong>
              </div>
              <div className="row-line">
                <span>Host</span>
                <strong>{proxmoxRuntime?.host ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Port</span>
                <strong>{proxmoxRuntime?.port ?? "—"}</strong>
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
                <span>Mode TLS</span>
                <strong>{proxmoxRuntime?.tlsMode ?? "strict"}</strong>
              </div>
              <div className="row-line">
                <span>Certificat CA custom</span>
                <strong>{proxmoxRuntime?.customCaCertPem ? "Oui" : "Non"}</strong>
              </div>
              <div className="row-line">
                <span>LDAP</span>
                <strong>{proxmoxRuntime?.ldap.enabled ? "Activé" : "Désactivé"}</strong>
              </div>
              <div className="row-line">
                <span>Dernière MAJ</span>
                <strong>
                  {proxmoxRuntime?.updatedAt ? formatRelativeTime(proxmoxRuntime.updatedAt) : "—"}
                </strong>
              </div>
              <div className="quick-actions">
                <Link href="/setup/connection" className="action-btn primary">
                  Ouvrir la configuration
                </Link>
              </div>
            </div>
          ) : null}

          {activeTab === "pbs" ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>Host</span>
                <strong>{pbsRuntime?.host ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Port</span>
                <strong>{pbsRuntime?.port ?? "—"}</strong>
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
                <span>Secret</span>
                <strong>{pbsRuntime ? maskSecret(pbsRuntime.secret) : "—"}</strong>
              </div>
              <div className="row-line">
                <span>Namespace</span>
                <strong>{pbsRuntime?.namespace ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Fingerprint</span>
                <strong>{pbsRuntime?.fingerprint ? "Oui" : "Non"}</strong>
              </div>
              <div className="row-line">
                <span>Tooling PBS</span>
                <strong className={pbsTooling.available ? "status-good" : "status-bad"}>
                  {pbsTooling.available ? "OK" : "Absent"}
                </strong>
              </div>
              {pbsTooling.version ? <p className="muted">{pbsTooling.version}</p> : null}
              {pbsTooling.error ? <p className="muted">{pbsTooling.error}</p> : null}
              <div className="quick-actions">
                <Link href="/setup/pbs" className="action-btn primary">
                  Ouvrir la configuration PBS
                </Link>
              </div>
            </div>
          ) : null}

          {activeTab === "auth" ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>Auth active</span>
                <strong className={authStatus.active ? "status-good" : undefined}>
                  {authStatus.active ? "Oui" : "Non"}
                </strong>
              </div>
              <div className="row-line">
                <span>Utilisateur</span>
                <strong>{runtimeAuth?.username ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>E-mail</span>
                <strong>{runtimeAuth?.email ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>TTL session</span>
                <strong>
                  {runtimeAuth ? `${Math.round(runtimeAuth.sessionTtlSeconds / 3600)}h` : "—"}
                </strong>
              </div>
              <div className="quick-actions">
                <Link href="/setup/auth" className="action-btn primary">
                  Gérer l’auth UI
                </Link>
              </div>
            </div>
          ) : null}

          {activeTab === "profile" ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>Profil utilisateur</span>
                <strong>{runtimeAuth?.username ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>E-mail</span>
                <strong>{runtimeAuth?.email ?? "—"}</strong>
              </div>
              <div className="quick-actions">
                <Link href="/setup/auth" className="action-btn">
                  Modifier le compte
                </Link>
              </div>
            </div>
          ) : null}

          {activeTab === "security" ? (
            <div className="stack-sm">
              <div className="row-line">
                <span>Cookie sécurisé</span>
                <strong>{runtimeAuth?.secureCookie ? "Oui" : "Non"}</strong>
              </div>
              <div className="row-line">
                <span>TTL session</span>
                <strong>
                  {runtimeAuth ? `${Math.round(runtimeAuth.sessionTtlSeconds / 3600)}h` : "—"}
                </strong>
              </div>
              <div className="quick-actions">
                <Link href="/setup/auth" className="action-btn">
                  Gérer la sécurité compte
                </Link>
              </div>
            </div>
          ) : null}

          {activeTab === "ai" ? (
            <AssistantMemorySettings memory={assistantMemory} />
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>État rapide</h2>
            <span className="muted">Synthèse</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Authentification locale</span>
              <strong className={authStatus.active ? "status-good" : undefined}>
                {authStatus.active ? "Active" : "Inactive"}
              </strong>
            </div>
            <div className="row-line">
              <span>Utilisateur courant</span>
              <strong>{runtimeAuth?.username ?? "—"}</strong>
            </div>
            <div className="row-line">
              <span>Connexion Proxmox</span>
              <strong className={proxmoxConnected ? "status-good" : undefined}>
                {proxmoxConnected ? "Configurée" : "Non configurée"}
              </strong>
            </div>
            <div className="row-line">
              <span>Mode LDAP</span>
              <strong>{ldapEnabled ? "Activé (optionnel)" : "Désactivé"}</strong>
            </div>
          </div>
          <div className="quick-actions">
            <Link href="/setup/auth" className="action-btn">
              Auth locale
            </Link>
            <Link href="/setup/connection" className="action-btn">
              Connexion Proxmox
            </Link>
            <Link href="/security" className="action-btn primary">
              Sécurité
            </Link>
          </div>
        </section>
      </section>
    </section>
  );
}
