"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordPolicyLiveStatus from "@/components/password-policy-live-status";
import { getPasswordPolicyError, evaluatePasswordPolicy } from "@/lib/auth/password-policy";

type AuthSetupStatus = {
  ok: boolean;
  auth: {
    enabledFlag: boolean;
    configured: boolean;
    runtimeConfigured?: boolean;
    source?: "runtime" | "none";
    active: boolean;
  };
  localAccountRequired?: boolean;
  deployment?: {
    recommendedSecureCookie: boolean;
  };
  runtimeSaved: {
    enabled: boolean;
    username: string;
    email: string | null;
    sessionTtlSeconds: number;
    secureCookie: boolean;
    sessionSecretMasked: string;
    updatedAt: string;
  } | null;
  envOverridesRuntime: boolean;
  message?: string;
  error?: string;
};

export default function AppAuthSetupForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secureCookie, setSecureCookie] = useState(false);
  const [ttlHours, setTtlHours] = useState("12");
  const [status, setStatus] = useState<AuthSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "delete" | "reload">(null);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const passwordPolicy = evaluatePasswordPolicy(password);
  const canSave =
    busy === null &&
    username.trim().length > 0 &&
    email.trim().length > 0 &&
    passwordPolicy.isValid;

  async function loadStatus() {
    setBusy("reload");
    setLoading(true);
    setFlash(null);

    try {
      const response = await fetch("/api/setup/auth", { cache: "no-store" });
      const payload = (await response.json()) as AuthSetupStatus;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger l’état auth.");
      }
      setStatus(payload);
      if (payload.runtimeSaved) {
        setUsername(payload.runtimeSaved.username);
        setEmail(payload.runtimeSaved.email ?? "");
        setSecureCookie(payload.runtimeSaved.secureCookie);
        setTtlHours(String(Math.max(1, Math.round(payload.runtimeSaved.sessionTtlSeconds / 3600))));
      } else {
        setSecureCookie(Boolean(payload.deployment?.recommendedSecureCookie));
      }
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur de chargement.",
      });
    } finally {
      setLoading(false);
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function saveAuthConfig() {
    setBusy("save");
    setFlash(null);

    try {
      const ttl = Math.max(1, Number.parseInt(ttlHours || "12", 10) || 12);
      const passwordPolicyError = getPasswordPolicyError(password);
      if (passwordPolicyError) {
        throw new Error(passwordPolicyError);
      }
      const response = await fetch("/api/setup/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          secureCookie,
          sessionTtlSeconds: ttl * 3600,
        }),
      });
      const payload = (await response.json()) as AuthSetupStatus;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Échec de configuration auth.");
      }

      setStatus(payload);
      setPassword("");
      setFlash({ type: "success", text: payload.message || "Auth UI enregistrée." });

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function deleteAuthConfig() {
    setBusy("delete");
    setFlash(null);
    try {
      const response = await fetch("/api/setup/auth", { method: "DELETE" });
      const payload = (await response.json()) as AuthSetupStatus;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Échec suppression.");
      }
      setStatus(payload);
      setFlash({ type: "success", text: payload.message || "Auth UI supprimée." });
      startTransition(() => {
        router.refresh();
      });
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
    <section className="panel setup-panel">
      <div className="panel-head">
        <h2>Authentification de l’interface</h2>
        <span className="muted">{loading ? "Chargement..." : "Configuration UI"}</span>
      </div>

      {flash ? (
        <div className={`setup-flash ${flash.type === "error" ? "error-box" : "setup-success"}`}>
          {flash.text}
        </div>
      ) : null}

      <div className="setup-grid">
        <div className="setup-form-col">
          <div className="field">
            <label className="field-label" htmlFor="auth-username">
              Utilisateur admin
            </label>
            <input
              id="auth-username"
              className="field-input"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-email">
              E-mail admin
            </label>
            <input
              id="auth-email"
              className="field-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-password">
              Mot de passe
            </label>
            <input
              id="auth-password"
              className="field-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="12+ chars, 1 maj, 1 chiffre, 1 spécial"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-ttl">
              Expiration session (heures)
            </label>
            <input
              id="auth-ttl"
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
            <span>Cookie sécurisé (HTTPS direct uniquement)</span>
          </label>

          {status?.deployment?.recommendedSecureCookie && !secureCookie ? (
            <div className="setup-hint warning-box">
              <code>PROXMOXCENTER_PUBLIC_ORIGIN</code> pointe vers une URL HTTPS. Active{" "}
              <code>Secure cookie</code> pour ne plus exposer le cookie de session sur une URL
              non chiffrée.
            </div>
          ) : null}

          <PasswordPolicyLiveStatus password={password} />

          <div className="setup-actions">
            <button
              type="button"
              className="action-btn primary"
              disabled={!canSave}
              onClick={() => void saveAuthConfig()}
            >
              {busy === "save" ? "Enregistrement..." : "Enregistrer auth UI"}
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null}
              onClick={() => void loadStatus()}
            >
              {busy === "reload" ? "Chargement..." : "Recharger"}
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null || status?.localAccountRequired}
              onClick={() => void deleteAuthConfig()}
            >
              {busy === "delete"
                ? "Suppression..."
                : status?.localAccountRequired
                  ? "Compte local requis (LDAP)"
                  : "Supprimer auth UI"}
            </button>
          </div>
        </div>

        <div className="setup-status-col">
          <article className="setup-status-card">
            <div className="row-line">
              <span>Auth active</span>
              <strong className={status?.auth.active ? "status-good" : undefined}>
                {status?.auth.active ? "Oui" : "Non"}
              </strong>
            </div>
            <div className="row-line">
              <span>Source</span>
              <strong>{status?.auth.source ?? "none"}</strong>
            </div>
            <div className="row-line">
              <span>Runtime configuré</span>
              <strong>{status?.runtimeSaved ? "Oui" : "Non"}</strong>
            </div>
            <div className="row-line">
              <span>Utilisateur runtime</span>
              <strong>{status?.runtimeSaved?.username ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>E-mail runtime</span>
              <strong>{status?.runtimeSaved?.email ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>TTL session</span>
              <strong>
                {status?.runtimeSaved ? `${Math.round(status.runtimeSaved.sessionTtlSeconds / 3600)}h` : "-"}
              </strong>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
