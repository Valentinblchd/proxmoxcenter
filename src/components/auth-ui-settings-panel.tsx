"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type AuthUiState = {
  ok: boolean;
  auth: {
    active: boolean;
  };
  settings: {
    sessionTtlHours: number;
    secureCookie: boolean;
    primaryUsername: string;
    localUsersCount: number;
    enabledUsersCount: number;
  } | null;
  ldapSecondaryEnabled: boolean;
  message?: string;
  error?: string;
};

type Props = {
  initialSettings: AuthUiState["settings"];
  ldapSecondaryEnabled: boolean;
};

export default function AuthUiSettingsPanel({ initialSettings, ldapSecondaryEnabled }: Props) {
  const router = useRouter();
  const [ttlHours, setTtlHours] = useState(String(initialSettings?.sessionTtlHours ?? 12));
  const [secureCookie, setSecureCookie] = useState(initialSettings?.secureCookie ?? false);
  const [stats, setStats] = useState(initialSettings);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function saveSettings() {
    setBusy(true);
    setFlash(null);
    try {
      const response = await fetch("/api/settings/auth-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionTtlHours: Math.max(1, Number.parseInt(ttlHours || "12", 10) || 12),
          secureCookie,
        }),
      });
      const payload = (await response.json()) as AuthUiState;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible d’enregistrer les réglages.");
      }

      setStats(payload.settings);
      setTtlHours(String(payload.settings?.sessionTtlHours ?? 12));
      setSecureCookie(payload.settings?.secureCookie ?? false);
      setFlash({ type: "success", text: payload.message || "Réglages enregistrés." });
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-grid">
      <div className="setup-form-col">
        {flash ? (
          <div className={`setup-flash ${flash.type === "error" ? "error-box" : "setup-success"}`}>
            {flash.text}
          </div>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor="auth-ui-ttl">
            Expiration session (heures)
          </label>
          <input
            id="auth-ui-ttl"
            className="field-input"
            type="number"
            min={1}
            max={168}
            value={ttlHours}
            onChange={(event) => setTtlHours(event.target.value)}
          />
        </div>

        <label className="setup-checkbox">
          <input
            type="checkbox"
            checked={secureCookie}
            onChange={(event) => setSecureCookie(event.target.checked)}
          />
          <span>Cookie sécurisé si accès HTTPS direct</span>
        </label>

        <div className="setup-actions">
          <button
            type="button"
            className="action-btn primary"
            disabled={busy}
            onClick={() => void saveSettings()}
          >
            {busy ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="setup-status-col">
        <div className="row-line">
          <span>Compte principal</span>
          <strong>{stats?.primaryUsername ?? "—"}</strong>
        </div>
        <div className="row-line">
          <span>Comptes locaux</span>
          <strong>{stats?.localUsersCount ?? 0}</strong>
        </div>
        <div className="row-line">
          <span>Comptes actifs</span>
          <strong>{stats?.enabledUsersCount ?? 0}</strong>
        </div>
        <div className="row-line">
          <span>LDAP</span>
          <strong>{ldapSecondaryEnabled ? "Activé" : "Désactivé"}</strong>
        </div>
        <div className="row-line">
          <span>Mode local</span>
          <strong>Toujours disponible</strong>
        </div>
        <div className="setup-actions">
          <Link href="/settings?tab=proxmox" className="action-btn">
            Proxmox
          </Link>
        </div>
      </div>
    </div>
  );
}
