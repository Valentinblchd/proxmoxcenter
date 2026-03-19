"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordPolicyLiveStatus from "@/components/password-policy-live-status";
import { getPasswordPolicyError, evaluatePasswordPolicy } from "@/lib/auth/password-policy";

type Props = {
  nextPath?: string;
  bootstrapCodePath: string;
};

type SetupAuthResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

export default function FirstAccountBootstrapForm({ nextPath, bootstrapCodePath }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("");
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const passwordPolicy = evaluatePasswordPolicy(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit =
    !busy &&
    bootstrapCode.trim().length > 0 &&
    username.trim().length > 0 &&
    email.trim().length > 0 &&
    passwordPolicy.isValid &&
    passwordsMatch;

  async function handleCreateAccount() {
    setFlash(null);

    if (!username.trim() || !email.trim() || !password) {
      setFlash({ type: "error", text: "Code bootstrap, utilisateur, e-mail et mot de passe sont requis." });
      return;
    }

    const passwordPolicyError = getPasswordPolicyError(password);
    if (passwordPolicyError) {
      setFlash({ type: "error", text: passwordPolicyError });
      return;
    }

    if (password !== confirmPassword) {
      setFlash({ type: "error", text: "Les mots de passe ne correspondent pas." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/setup/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bootstrapCode,
          username,
          email,
          password,
          autoLogin: true,
        }),
      });

      const payload = (await response.json()) as SetupAuthResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de créer le compte administrateur.");
      }

      setFlash({
        type: "success",
        text: payload.message || "Compte créé. Redirection vers la configuration Proxmox...",
      });

      const target =
        nextPath && nextPath !== "/" && nextPath !== "/login"
          ? `/setup/connection?next=${encodeURIComponent(nextPath)}`
          : "/setup/connection";

      startTransition(() => {
        router.push(target);
        router.refresh();
      });
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
    <div className="login-form" role="form" aria-label="Création du compte administrateur">
      {flash ? (
        <div className={`login-state ${flash.type === "error" ? "error-box" : "setup-success"}`}>
          {flash.text}
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">Code bootstrap</span>
        <input
          className="field-input"
          type="text"
          value={bootstrapCode}
          onChange={(event) => setBootstrapCode(event.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="one-time-code"
          disabled={busy}
          required
        />
      </label>

      <div className="hint-box">
        <p className="muted">
          Première activation sécurisée: lis le code bootstrap sur le serveur dans{" "}
          <strong>{bootstrapCodePath}</strong>.
        </p>
      </div>

      <label className="field">
        <span className="field-label">Utilisateur</span>
        <input
          className="field-input"
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="admin"
          autoComplete="username"
          disabled={busy}
          required
        />
      </label>

      <label className="field">
        <span className="field-label">E-mail</span>
        <input
          className="field-input"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@example.com"
          autoComplete="email"
          disabled={busy}
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Mot de passe</span>
        <input
          className="field-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="12+ chars, 1 maj, 1 chiffre, 1 spécial"
          autoComplete="new-password"
          disabled={busy}
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Confirmer le mot de passe</span>
        <input
          className="field-input"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Répéter le mot de passe"
          autoComplete="new-password"
          disabled={busy}
          required
        />
      </label>

      <PasswordPolicyLiveStatus
        password={password}
        confirmPassword={confirmPassword}
        requireConfirmation
      />

      <button
        className="login-submit"
        type="button"
        disabled={!canSubmit}
        onClick={() => void handleCreateAccount()}
      >
        {busy ? "Création..." : "Créer le compte administrateur"}
      </button>
    </div>
  );
}
