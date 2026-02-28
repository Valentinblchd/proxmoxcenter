"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

type ProviderStatus = {
  configured: boolean;
  clientIdMasked: string | null;
  updatedAt: string | null;
  authority?: string;
};

type CloudOauthStatusResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  providers?: {
    onedrive: ProviderStatus;
    gdrive: ProviderStatus;
  };
};

type Props = {
  initialProviders: {
    onedrive: ProviderStatus;
    gdrive: ProviderStatus;
  };
  canAdmin: boolean;
};

function formatUpdatedAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CloudOauthSettings({ initialProviders, canAdmin }: Props) {
  const router = useRouter();
  const [providers, setProviders] = useState(initialProviders);
  const [busy, setBusy] = useState<null | "onedrive" | "gdrive">(null);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [oneDriveClientId, setOneDriveClientId] = useState("");
  const [oneDriveClientSecret, setOneDriveClientSecret] = useState("");
  const [oneDriveAuthority, setOneDriveAuthority] = useState(initialProviders.onedrive.authority ?? "consumers");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  async function saveProvider(provider: "onedrive" | "gdrive") {
    setBusy(provider);
    setFlash(null);
    try {
      const body =
        provider === "onedrive"
          ? {
              provider,
              clientId: oneDriveClientId,
              clientSecret: oneDriveClientSecret,
              authority: oneDriveAuthority,
            }
          : {
              provider,
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            };

      const response = await fetch("/api/settings/cloud-oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as CloudOauthStatusResponse;
      if (!response.ok || !payload.ok || !payload.providers) {
        throw new Error(payload.error || "Impossible d’enregistrer OAuth cloud.");
      }

      setProviders(payload.providers);
      if (provider === "onedrive") {
        setOneDriveClientId("");
        setOneDriveClientSecret("");
      } else {
        setGoogleClientId("");
        setGoogleClientSecret("");
      }
      setFlash({
        type: "success",
        text: payload.message || "OAuth cloud enregistré.",
      });
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function resetProvider(provider: "onedrive" | "gdrive") {
    const label = provider === "onedrive" ? "OneDrive" : "Google Drive";
    if (!window.confirm(`Réinitialiser la configuration OAuth ${label} ?`)) {
      return;
    }

    setBusy(provider);
    setFlash(null);
    try {
      const response = await fetch("/api/settings/cloud-oauth", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = (await response.json()) as CloudOauthStatusResponse;
      if (!response.ok || !payload.ok || !payload.providers) {
        throw new Error(payload.error || "Impossible de réinitialiser OAuth cloud.");
      }

      setProviders(payload.providers);
      if (provider === "onedrive") {
        setOneDriveClientId("");
        setOneDriveClientSecret("");
        setOneDriveAuthority("consumers");
      } else {
        setGoogleClientId("");
        setGoogleClientSecret("");
      }
      setFlash({
        type: "success",
        text: payload.message || "OAuth cloud réinitialisé.",
      });
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-block">
      <div className="panel-head">
        <h2>OAuth cloud</h2>
        <span className="muted">Config globale pour OneDrive et Google Drive</span>
      </div>

      {flash ? (
        <div className="hint-box">
          <p className="muted">{flash.text}</p>
        </div>
      ) : null}

      <div className="settings-sections">
        <section className="settings-block">
          <div className="panel-head">
            <h2>OneDrive</h2>
            <span className={`inventory-badge ${providers.onedrive.configured ? "status-running" : "status-template"}`}>
              {providers.onedrive.configured ? "Configuré" : "À configurer"}
            </span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Client ID actuel</span>
              <strong>{providers.onedrive.clientIdMasked ?? "Non configuré"}</strong>
            </div>
            <div className="row-line">
              <span>Authority</span>
              <strong>{providers.onedrive.authority ?? "consumers"}</strong>
            </div>
            <div className="row-line">
              <span>Dernière mise à jour</span>
              <strong>{formatUpdatedAt(providers.onedrive.updatedAt)}</strong>
            </div>
          </div>
          {canAdmin ? (
            <>
              <div className="provision-grid">
                <label className="provision-field">
                  <span className="provision-field-label">Client ID</span>
                  <input
                    className="provision-input"
                    value={oneDriveClientId}
                    onChange={(event) => setOneDriveClientId(event.target.value)}
                    placeholder="App Microsoft client ID"
                  />
                </label>
                <label className="provision-field">
                  <span className="provision-field-label">Authority</span>
                  <input
                    className="provision-input"
                    value={oneDriveAuthority}
                    onChange={(event) => setOneDriveAuthority(event.target.value)}
                    placeholder="consumers"
                  />
                </label>
                <label className="provision-field">
                  <span className="provision-field-label">Client Secret (optionnel)</span>
                  <input
                    className="provision-input"
                    type="password"
                    value={oneDriveClientSecret}
                    onChange={(event) => setOneDriveClientSecret(event.target.value)}
                    placeholder="Optionnel si app confidentielle"
                  />
                </label>
              </div>
              <div className="hint-box">
                <p className="muted">
                  Callback OneDrive: <strong>/api/backups/oauth/onedrive/callback</strong>
                </p>
              </div>
              <div className="setup-actions">
                <button
                  type="button"
                  className="action-btn primary"
                  onClick={() => void saveProvider("onedrive")}
                  disabled={busy !== null || !oneDriveClientId.trim()}
                >
                  {busy === "onedrive" ? "Enregistrement..." : "Enregistrer OneDrive"}
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => void resetProvider("onedrive")}
                  disabled={busy !== null || !providers.onedrive.configured}
                >
                  Réinitialiser
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="settings-block">
          <div className="panel-head">
            <h2>Google Drive</h2>
            <span className={`inventory-badge ${providers.gdrive.configured ? "status-running" : "status-template"}`}>
              {providers.gdrive.configured ? "Configuré" : "À configurer"}
            </span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Client ID actuel</span>
              <strong>{providers.gdrive.clientIdMasked ?? "Non configuré"}</strong>
            </div>
            <div className="row-line">
              <span>Dernière mise à jour</span>
              <strong>{formatUpdatedAt(providers.gdrive.updatedAt)}</strong>
            </div>
          </div>
          {canAdmin ? (
            <>
              <div className="provision-grid">
                <label className="provision-field">
                  <span className="provision-field-label">Client ID</span>
                  <input
                    className="provision-input"
                    value={googleClientId}
                    onChange={(event) => setGoogleClientId(event.target.value)}
                    placeholder="Google OAuth client ID"
                  />
                </label>
                <label className="provision-field">
                  <span className="provision-field-label">Client Secret</span>
                  <input
                    className="provision-input"
                    type="password"
                    value={googleClientSecret}
                    onChange={(event) => setGoogleClientSecret(event.target.value)}
                    placeholder="Google OAuth client secret"
                  />
                </label>
              </div>
              <div className="hint-box">
                <p className="muted">
                  Callback Google Drive: <strong>/api/backups/oauth/gdrive/callback</strong>
                </p>
              </div>
              <div className="setup-actions">
                <button
                  type="button"
                  className="action-btn primary"
                  onClick={() => void saveProvider("gdrive")}
                  disabled={busy !== null || !googleClientId.trim() || !googleClientSecret.trim()}
                >
                  {busy === "gdrive" ? "Enregistrement..." : "Enregistrer Google Drive"}
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => void resetProvider("gdrive")}
                  disabled={busy !== null || !providers.gdrive.configured}
                >
                  Réinitialiser
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}
