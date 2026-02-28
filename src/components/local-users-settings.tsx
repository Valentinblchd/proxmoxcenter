"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordPolicyLiveStatus from "@/components/password-policy-live-status";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";
import { getPasswordPolicyError, evaluatePasswordPolicy } from "@/lib/auth/password-policy";
import { roleLabel } from "@/lib/auth/rbac";
import { formatRelativeTime } from "@/lib/ui/format";

type LocalUser = {
  id: string;
  username: string;
  email: string | null;
  role: string;
  enabled: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  sessionRevokedAt: string | null;
};

type LocalUsersResponse = {
  ok: boolean;
  users: LocalUser[];
  primaryUserId: string | null;
  message?: string;
  error?: string;
};

type Props = {
  initialUsers: LocalUser[];
  currentUsername?: string | null;
};

export default function LocalUsersSettings({ initialUsers, currentUsername }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<LocalUser[]>(initialUsers);
  const [filterQuery, setFilterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled" | "primary">("all");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"reader" | "operator" | "admin">("operator");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [busy, setBusy] = useState<null | "create" | "reload">(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LocalUser | null>(null);
  const [logoutOthersBusy, setLogoutOthersBusy] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const passwordPolicy = evaluatePasswordPolicy(password);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;
  const resetPasswordPolicy = evaluatePasswordPolicy(resetPassword);
  const resetPasswordsMatch =
    resetConfirmPassword.length > 0 && resetConfirmPassword === resetPassword;
  const canCreate =
    busy === null &&
    rowBusy === null &&
    username.trim().length > 0 &&
    passwordPolicy.isValid &&
    passwordsMatch;

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return left.username.localeCompare(right.username);
      }),
    [users],
  );
  const filteredUsers = useMemo(() => {
    const normalizedQuery = filterQuery.trim().toLowerCase();
    return sortedUsers.filter((user) => {
      if (statusFilter === "active" && !user.enabled) return false;
      if (statusFilter === "disabled" && user.enabled) return false;
      if (statusFilter === "primary" && !user.isPrimary) return false;
      const haystack = [user.username, user.email ?? "", user.role, user.enabled ? "actif" : "desactive"]
        .join(" ")
        .toLowerCase();
      if (!normalizedQuery) return true;
      return haystack.includes(normalizedQuery);
    });
  }, [filterQuery, sortedUsers, statusFilter]);

  function resetPasswordEditor() {
    setResetTargetId(null);
    setResetPassword("");
    setResetConfirmPassword("");
  }

  async function refreshUsers() {
    setBusy("reload");
    setFlash(null);
    try {
      const response = await fetch("/api/settings/local-users", { cache: "no-store" });
      const payload = (await response.json()) as LocalUsersResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger les utilisateurs locaux.");
      }
      setUsers(payload.users);
      resetPasswordEditor();
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur de chargement.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function createUser() {
    setFlash(null);

    const passwordPolicyError = getPasswordPolicyError(password);
    if (passwordPolicyError) {
      setFlash({ type: "error", text: passwordPolicyError });
      return;
    }
    if (password !== confirmPassword) {
      setFlash({ type: "error", text: "Les deux mots de passe doivent correspondre." });
      return;
    }

    setBusy("create");
    try {
      const response = await fetch("/api/settings/local-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email,
          role,
          password,
        }),
      });
      const payload = (await response.json()) as LocalUsersResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible d’ajouter le compte local.");
      }

      setUsers(payload.users);
      setUsername("");
      setEmail("");
      setRole("operator");
      setPassword("");
      setConfirmPassword("");
      resetPasswordEditor();
      setFlash({ type: "success", text: payload.message || "Compte local ajouté." });
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

  async function updateUser(userId: string, body: Record<string, unknown>) {
    setRowBusy(userId);
    setFlash(null);
    try {
      const targetedUser = users.find((entry) => entry.id === userId) ?? null;
      const response = await fetch("/api/settings/local-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const payload = (await response.json()) as LocalUsersResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de modifier le compte local.");
      }
      setUsers(payload.users);
      if (body.action === "password") {
        resetPasswordEditor();
      }
      setFlash({ type: "success", text: payload.message || "Compte local mis à jour." });
      if (
        body.action === "force-logout" &&
        targetedUser &&
        currentUsername?.toLowerCase() === targetedUser.username.toLowerCase() &&
        typeof window !== "undefined"
      ) {
        window.location.assign("/login?revoked=1");
        return;
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteUser(user: LocalUser, confirmationText: string) {
    setRowBusy(user.id);
    setFlash(null);
    try {
      const response = await fetch("/api/settings/local-users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, confirmationText }),
      });
      const payload = (await response.json()) as LocalUsersResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de supprimer le compte local.");
      }
      setUsers(payload.users);
      if (resetTargetId === user.id) {
        resetPasswordEditor();
      }
      setPendingDelete(null);
      setFlash({ type: "success", text: payload.message || "Compte local supprimé." });
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setRowBusy(null);
    }
  }

  async function submitPasswordReset(userId: string) {
    setFlash(null);

    const passwordPolicyError = getPasswordPolicyError(resetPassword);
    if (passwordPolicyError) {
      setFlash({ type: "error", text: passwordPolicyError });
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setFlash({ type: "error", text: "Les deux mots de passe doivent correspondre." });
      return;
    }

    await updateUser(userId, {
      action: "password",
      password: resetPassword,
    });
  }

  async function forceLogoutOtherSessions(user: LocalUser) {
    setLogoutOthersBusy(true);
    setFlash(null);
    try {
      const response = await fetch("/api/settings/local-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, action: "force-logout-others" }),
      });
      const payload = (await response.json()) as LocalUsersResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de déconnecter les autres sessions.");
      }
      setUsers(payload.users);
      setFlash({ type: "success", text: payload.message || "Autres sessions fermées." });
      startTransition(() => router.refresh());
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    } finally {
      setLogoutOthersBusy(false);
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

        <div className="stack-sm">
          <div className="panel-head">
            <h2>Ajouter un compte local</h2>
            <span className="muted">{users.length} compte(s)</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-user-username">
              Utilisateur
            </label>
            <input
              id="local-user-username"
              className="field-input"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="ops-admin"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-user-email">
              E-mail
            </label>
            <input
              id="local-user-email"
              className="field-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ops@example.com"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-user-role">
              Rôle
            </label>
            <select
              id="local-user-role"
              className="field-input"
              value={role}
              onChange={(event) => setRole(event.target.value as "reader" | "operator" | "admin")}
            >
              <option value="reader">Lecture</option>
              <option value="operator">Opérations</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-user-password">
              Mot de passe
            </label>
            <input
              id="local-user-password"
              className="field-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="12+ caractères"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="local-user-password-confirm">
              Confirmer
            </label>
            <input
              id="local-user-password-confirm"
              className="field-input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Répéter le mot de passe"
            />
          </div>

          <PasswordPolicyLiveStatus
            password={password}
            confirmPassword={confirmPassword}
            requireConfirmation
          />

          <div className="setup-actions">
            <button
              type="button"
              className="action-btn primary"
              disabled={!canCreate}
              onClick={() => void createUser()}
            >
              {busy === "create" ? "Ajout..." : "Ajouter le compte"}
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null || rowBusy !== null}
              onClick={() => void refreshUsers()}
            >
              {busy === "reload" ? "Chargement..." : "Recharger"}
            </button>
          </div>
        </div>
      </div>

      <div className="setup-status-col">
        <div className="panel-head">
          <h2>Comptes locaux</h2>
          <span className="muted">{filteredUsers.length} affiché(s) / {users.length}</span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="local-users-filter">
            Filtrer
          </label>
          <input
            id="local-users-filter"
            className="field-input"
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Rechercher un utilisateur, e-mail ou état"
          />
        </div>

        <div className="provision-segment">
          <button
            type="button"
            className={`provision-seg-btn${statusFilter === "all" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            Tous
          </button>
          <button
            type="button"
            className={`provision-seg-btn${statusFilter === "active" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("active")}
          >
            Actifs
          </button>
          <button
            type="button"
            className={`provision-seg-btn${statusFilter === "disabled" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("disabled")}
          >
            Désactivés
          </button>
          <button
            type="button"
            className={`provision-seg-btn${statusFilter === "primary" ? " is-active" : ""}`}
            onClick={() => setStatusFilter("primary")}
          >
            Principal
          </button>
        </div>

        <div className="mini-list">
          {filteredUsers.map((user) => {
            const isSelf = currentUsername?.toLowerCase() === user.username.toLowerCase();
            const isOnlyEnabledUser = users.filter((entry) => entry.enabled).length <= 1 && user.enabled;
            const resetOpen = resetTargetId === user.id;
            const canSubmitReset =
              rowBusy === null &&
              resetPasswordPolicy.isValid &&
              resetPasswordsMatch;
            return (
              <article key={user.id} className="mini-list-item">
                <div className="stack-xs">
                  <div className="item-title">
                    {user.username}
                    {user.isPrimary ? " · principal" : ""}
                    {isSelf ? " · session active" : ""}
                  </div>
                  <div className="item-subtitle">
                    {user.email ?? "Aucun e-mail"} · {roleLabel(user.role as "reader" | "operator" | "admin")} · {user.enabled ? "Actif" : "Désactivé"}
                  </div>
                  <div className="item-subtitle">
                    Dernière connexion: {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : "jamais"}
                  </div>
                  {user.sessionRevokedAt ? (
                    <div className="item-subtitle">
                      Sessions forcées: {formatRelativeTime(user.sessionRevokedAt)}
                    </div>
                  ) : null}
                </div>
                <div className="settings-inline-actions">
                  <select
                    className="field-input settings-role-select"
                    value={user.role}
                    disabled={rowBusy !== null}
                    onChange={(event) =>
                      void updateUser(user.id, {
                        action: "role",
                        role: event.target.value,
                      })
                    }
                  >
                    <option value="reader">Lecture</option>
                    <option value="operator">Opérations</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="button"
                    className="action-btn"
                    disabled={rowBusy !== null}
                    onClick={() => {
                      if (resetOpen) {
                        resetPasswordEditor();
                      } else {
                        setResetTargetId(user.id);
                        setResetPassword("");
                        setResetConfirmPassword("");
                        setFlash(null);
                      }
                    }}
                  >
                    {resetOpen ? "Fermer" : "Mot de passe"}
                  </button>
                  {!user.isPrimary ? (
                    <button
                      type="button"
                      className="action-btn"
                      disabled={rowBusy !== null}
                      onClick={() => void updateUser(user.id, { action: "primary" })}
                    >
                      Principal
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="action-btn"
                    disabled={rowBusy !== null || (isSelf && isOnlyEnabledUser)}
                    onClick={() =>
                      void updateUser(user.id, {
                        action: "enabled",
                        enabled: !user.enabled,
                      })
                    }
                  >
                    {user.enabled ? "Désactiver" : "Activer"}
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    disabled={rowBusy !== null}
                    onClick={() =>
                      void updateUser(user.id, {
                        action: "force-logout",
                      })
                    }
                  >
                    {rowBusy === user.id ? "Application..." : isSelf ? "Me déconnecter" : "Forcer déco"}
                  </button>
                  {isSelf ? (
                    <button
                      type="button"
                      className="action-btn"
                      disabled={rowBusy !== null || logoutOthersBusy}
                      onClick={() => void forceLogoutOtherSessions(user)}
                    >
                      {logoutOthersBusy ? "Application..." : "Fermer autres sessions"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="action-btn"
                    disabled={rowBusy !== null || user.isPrimary || isSelf}
                    onClick={() => setPendingDelete(user)}
                    >
                      Supprimer
                    </button>
                </div>

                {resetOpen ? (
                  <div className="stack-xs" style={{ marginTop: "0.85rem" }}>
                    <div className="field">
                      <label className="field-label" htmlFor={`reset-password-${user.id}`}>
                        Nouveau mot de passe
                      </label>
                      <input
                        id={`reset-password-${user.id}`}
                        className="field-input"
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        placeholder="12+ caractères"
                      />
                    </div>

                    <div className="field">
                      <label className="field-label" htmlFor={`reset-password-confirm-${user.id}`}>
                        Confirmer
                      </label>
                      <input
                        id={`reset-password-confirm-${user.id}`}
                        className="field-input"
                        type="password"
                        value={resetConfirmPassword}
                        onChange={(event) => setResetConfirmPassword(event.target.value)}
                        placeholder="Répéter le mot de passe"
                      />
                    </div>

                    <PasswordPolicyLiveStatus
                      password={resetPassword}
                      confirmPassword={resetConfirmPassword}
                      requireConfirmation
                    />

                    <div className="settings-inline-actions">
                      <button
                        type="button"
                        className="action-btn primary"
                        disabled={!canSubmitReset}
                        onClick={() => void submitPasswordReset(user.id)}
                      >
                        {rowBusy === user.id ? "Enregistrement..." : "Enregistrer"}
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        disabled={rowBusy !== null}
                        onClick={() => resetPasswordEditor()}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}

          {filteredUsers.length === 0 ? (
            <article className="mini-list-item">
              <div className="item-subtitle">Aucun compte ne correspond au filtre.</div>
            </article>
          ) : null}
        </div>
      </div>

      <StrongConfirmDialog
        key={pendingDelete ? `delete-${pendingDelete.id}` : "delete-closed"}
        open={Boolean(pendingDelete)}
        title="Supprimer le compte local"
        message={
          pendingDelete
            ? `Cette suppression est sensible. Le compte ${pendingDelete.username} sera retiré de ProxmoxCenter.`
            : ""
        }
        expectedText={pendingDelete ? `DELETE ${pendingDelete.username}` : "DELETE USER"}
        confirmLabel="Supprimer le compte"
        busy={pendingDelete ? rowBusy === pendingDelete.id : false}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(confirmationText) => {
          if (!pendingDelete) return;
          void deleteUser(pendingDelete, confirmationText);
        }}
      />
    </div>
  );
}
