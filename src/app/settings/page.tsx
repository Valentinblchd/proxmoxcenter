import Link from "next/link";
import { cookies } from "next/headers";
import AssistantMemorySettings from "@/components/assistant-memory-settings";
import CloudOauthSettings from "@/components/cloud-oauth-settings";
import GreenItCalibrationPanel from "@/components/greenit-calibration-panel";
import ProxmoxConnectionForm from "@/components/proxmox-connection-form";
import SelfUpdateSettingsPanel from "@/components/self-update-settings-panel";
import ThemeSettingsPanel from "@/components/theme-settings-panel";
import { readAssistantMemory } from "@/lib/assistant/memory";
import { AUTH_COOKIE_NAME, getAuthStatus, verifySessionToken } from "@/lib/auth/session";
import { getPublicCloudOauthAppStatus } from "@/lib/backups/oauth-app-config";
import { readRuntimeGreenItConfig } from "@/lib/greenit/runtime-config";
import { buildGreenItAdvisor } from "@/lib/insights/advisor";
import { readRuntimePbsConfig } from "@/lib/pbs/runtime-config";
import { readPbsToolingStatus } from "@/lib/pbs/tooling";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

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
  { id: "proxmox", label: "Proxmox" },
  { id: "greenit", label: "GreenIT" },
  { id: "appearance", label: "Apparence" },
  { id: "ai", label: "Mémoire IA" },
] as const;

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "proxmox";

  const authStatus = getAuthStatus();
  const proxmoxConfigured = Boolean(getProxmoxConfig());
  const pbsRuntime = readRuntimePbsConfig();
  const pbsTooling = await readPbsToolingStatus();
  const cloudOauthProviders = getPublicCloudOauthAppStatus();
  const snapshot = await getDashboardSnapshot();
  const greenitRuntime = readRuntimeGreenItConfig();
  const greenit = buildGreenItAdvisor(snapshot, greenitRuntime);
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canAdmin = session?.role === "admin";
  const assistantMemory = readAssistantMemory(session?.username ?? "default");

  return (
    <section className="content settings-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Paramètres</p>
          <h1>Configuration</h1>
          <p className="muted">Connexion Proxmox, PBS, GreenIT, apparence et mémoire IA au même endroit.</p>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${authStatus.active ? "live" : ""}`}>
            {authStatus.active ? "Compte local actif" : "Compte local inactif"}
          </span>
          {proxmoxConfigured ? <span className="pill live">Proxmox configuré</span> : <span className="pill">Proxmox non configuré</span>}
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

      {activeTab === "proxmox" ? (
        <section className="settings-sections">
          <details className="panel">
            <summary className="settings-collapsible-summary">
              <span>Proxmox</span>
              <span className="muted">{proxmoxConfigured ? "Configuré" : "À configurer"}</span>
            </summary>
            <div className="settings-collapsible-content">
              <ProxmoxConnectionForm />
            </div>
          </details>

          <details className="panel">
            <summary className="settings-collapsible-summary">
              <span>Connexion PBS</span>
              <span className="muted">{pbsRuntime ? "Configuré" : "Optionnel"}</span>
            </summary>
            <div className="settings-collapsible-content stack-sm">
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
              <div className="quick-actions">
                <Link href="/setup/pbs" className="action-btn">
                  Ouvrir la config PBS
                </Link>
              </div>
            </div>
          </details>

          {canAdmin ? (
            <details className="panel">
              <summary className="settings-collapsible-summary">
                <span>Mise à jour</span>
                <span className="muted">Update UI automatique</span>
              </summary>
              <div className="settings-collapsible-content">
                <SelfUpdateSettingsPanel />
              </div>
            </details>
          ) : null}

          {canAdmin ? (
            <details className="panel">
              <summary className="settings-collapsible-summary">
                <span>OAuth Cloud</span>
                <span className="muted">Google Drive / OneDrive</span>
              </summary>
              <div className="settings-collapsible-content">
                <CloudOauthSettings initialProviders={cloudOauthProviders} canAdmin={canAdmin} />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {activeTab === "appearance" ? (
        <section className="panel">
          <ThemeSettingsPanel />
        </section>
      ) : null}

      {activeTab === "greenit" ? (
        <GreenItCalibrationPanel
          defaults={{
            estimatedPowerWatts: greenit.metrics.estimatedPowerWatts,
            pue: greenit.config.pue,
            co2FactorKgPerKwh: greenit.config.co2FactorKgPerKwh,
            electricityPricePerKwh: greenit.config.electricityPricePerKwh,
          }}
          initialSettings={greenitRuntime}
        />
      ) : null}

      {activeTab === "ai" ? (
        <section className="panel">
          <AssistantMemorySettings memory={assistantMemory} />
        </section>
      ) : null}
    </section>
  );
}
