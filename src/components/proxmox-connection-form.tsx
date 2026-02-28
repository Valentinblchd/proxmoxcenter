"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";

type SetupStatusPayload = {
  ok: boolean;
  configured: boolean;
  source: "runtime" | "none";
  effective: {
    baseUrl: string;
    protocol: "https" | "http";
    host: string;
    port: number;
    tokenId: string;
    tlsMode: "strict" | "insecure" | "custom-ca";
    allowInsecureTls: boolean;
    customCaConfigured: boolean;
    tokenSecretMasked: string;
  } | null;
  runtimeSaved: {
    baseUrl: string;
    protocol: "https" | "http";
    host: string;
    port: number;
    tokenId: string;
    tlsMode: "strict" | "insecure" | "custom-ca";
    allowInsecureTls: boolean;
    customCaConfigured: boolean;
    tokenSecretMasked: string;
    ldap: {
      enabled: boolean;
      serverUrl: string;
      baseDn: string;
      bindDn: string;
      bindPasswordConfigured: boolean;
      userFilter: string;
      realm: string;
      startTls: boolean;
      allowInsecureTls: boolean;
    };
    updatedAt: string;
  } | null;
  envOverridesRuntime: boolean;
  test?: {
    ok: true;
    version: {
      version: string;
      release: string | null;
      repoid: string | null;
    };
  } | null;
  saved?: boolean;
  tested?: boolean;
  error?: string;
};

type FormState = {
  protocol: "https" | "http";
  host: string;
  port: string;
  tokenId: string;
  tokenSecret: string;
  tlsMode: "strict" | "insecure" | "custom-ca";
  customCaCertPem: string;
  ldapEnabled: boolean;
  ldapServerUrl: string;
  ldapBaseDn: string;
  ldapBindDn: string;
  ldapBindPassword: string;
  ldapUserFilter: string;
  ldapRealm: string;
  ldapStartTls: boolean;
  ldapAllowInsecureTls: boolean;
};

const EMPTY_FORM: FormState = {
  protocol: "https",
  host: "",
  port: "8006",
  tokenId: "",
  tokenSecret: "",
  tlsMode: "strict",
  customCaCertPem: "",
  ldapEnabled: false,
  ldapServerUrl: "",
  ldapBaseDn: "",
  ldapBindDn: "",
  ldapBindPassword: "",
  ldapUserFilter: "(uid={username})",
  ldapRealm: "ldap",
  ldapStartTls: false,
  ldapAllowInsecureTls: false,
};

function formatSource(source: SetupStatusPayload["source"]) {
  if (source === "runtime") return "UI (fichier local)";
  return "Aucune";
}

function buildBaseUrlPreview(form: FormState) {
  const host = form.host.trim();
  if (!host) return `${form.protocol}://…:${form.port || "8006"}`;
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${form.protocol}://${normalizedHost}:${form.port || "8006"}`;
}

export default function ProxmoxConnectionForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<SetupStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "test" | "save" | "save-skip" | "delete">(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const baseUrlPreview = useMemo(() => buildBaseUrlPreview(form), [form]);

  async function loadStatus() {
    setLoading(true);
    setFlash(null);

    try {
      const response = await fetch("/api/setup/proxmox", { cache: "no-store" });
      const payload = (await response.json()) as SetupStatusPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger la configuration.");
      }

      setStatus(payload);
      const pref = payload.runtimeSaved ?? payload.effective;
      if (pref) {
        setForm((current) => ({
          ...current,
          protocol: pref.protocol,
          host: pref.host,
          port: String(pref.port),
          tokenId: pref.tokenId,
          tlsMode: pref.tlsMode,
          tokenSecret: "",
          customCaCertPem: "",
        }));
      }

      if (payload.runtimeSaved?.ldap) {
        const ldap = payload.runtimeSaved.ldap;
        setForm((current) => ({
          ...current,
          ldapEnabled: ldap.enabled,
          ldapServerUrl: ldap.serverUrl,
          ldapBaseDn: ldap.baseDn,
          ldapBindDn: ldap.bindDn,
          ldapBindPassword: "",
          ldapUserFilter: ldap.userFilter || "(uid={username})",
          ldapRealm: ldap.realm || "ldap",
          ldapStartTls: ldap.startTls,
          ldapAllowInsecureTls: ldap.allowInsecureTls,
        }));
      }
    } catch (error) {
      setFlash({
        type: "error",
        text: error instanceof Error ? error.message : "Erreur de chargement.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function submit(kind: "test" | "save" | "save-skip") {
    setBusy(kind);
    setFlash(null);

    try {
      const body = {
        protocol: form.protocol,
        host: form.host,
        port: form.port,
        tokenId: form.tokenId,
        tokenSecret: form.tokenSecret,
        tlsMode: form.tlsMode,
        customCaCertPem: form.tlsMode === "custom-ca" ? form.customCaCertPem : "",
        ldap: {
          enabled: form.ldapEnabled,
          serverUrl: form.ldapServerUrl,
          baseDn: form.ldapBaseDn,
          bindDn: form.ldapBindDn,
          bindPassword: form.ldapBindPassword,
          userFilter: form.ldapUserFilter,
          realm: form.ldapRealm,
          startTls: form.ldapStartTls,
          allowInsecureTls: form.ldapAllowInsecureTls,
        },
        testOnly: kind === "test",
        skipTest: kind === "save-skip",
      };

      const response = await fetch("/api/setup/proxmox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SetupStatusPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Échec de l’enregistrement.");
      }

      setStatus(payload);
      setForm((current) => ({
        ...current,
        tokenSecret: "",
        ldapBindPassword: "",
      }));

      const suffix = payload.test?.version?.version ? ` (PVE ${payload.test.version.version})` : "";
      setFlash({
        type: "success",
        text:
          kind === "test"
            ? `Connexion OK${suffix}`
            : kind === "save-skip"
              ? "Configuration enregistrée (sans test)."
              : `Configuration enregistrée${suffix}`,
      });

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

  async function clearRuntimeConfig(confirmationText: string) {
    setBusy("delete");
    setFlash(null);

    try {
      const response = await fetch("/api/setup/proxmox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText }),
      });
      const payload = (await response.json()) as SetupStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de supprimer la config.");
      }

      setStatus(payload);
      setDeleteConfirmOpen(false);
      setFlash({ type: "success", text: "Configuration UI supprimée." });
      if (payload.effective == null) {
        setForm(EMPTY_FORM);
      }

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
        <h2>Connexion Proxmox VE</h2>
        <span className="muted">{loading ? "Chargement..." : "DNS/IP + TLS + LDAP"}</span>
      </div>

      {flash ? (
        <div className={`setup-flash ${flash.type === "error" ? "error-box" : "setup-success"}`}>
          {flash.text}
        </div>
      ) : null}

      <div className="setup-grid">
        <div className="setup-form-col">
          <div className="provision-grid">
            <div className="field">
              <label className="field-label" htmlFor="pve-protocol">
                Protocole
              </label>
              <select
                id="pve-protocol"
                className="field-input"
                value={form.protocol}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    protocol: event.target.value === "http" ? "http" : "https",
                  }))
                }
              >
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pve-port">
                Port
              </label>
              <input
                id="pve-port"
                className="field-input"
                type="number"
                min={1}
                max={65535}
                placeholder="8006"
                value={form.port}
                onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pve-host">
              Host DNS / IP
            </label>
            <input
              id="pve-host"
              className="field-input"
              type="text"
              placeholder="pve.home.local ou 192.168.1.10"
              value={form.host}
              onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
            />
            <small className="muted">URL générée: {baseUrlPreview}</small>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pve-token-id">
              Token ID API
            </label>
            <input
              id="pve-token-id"
              className="field-input"
              type="text"
              placeholder="root@pam!proxcenter"
              value={form.tokenId}
              onChange={(event) => setForm((current) => ({ ...current, tokenId: event.target.value }))}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pve-token-secret">
              Token Secret API
            </label>
            <input
              id="pve-token-secret"
              className="field-input"
              type="password"
              placeholder={status?.runtimeSaved ? "Laisser vide pour conserver le secret actuel" : "Secret token"}
              value={form.tokenSecret}
              onChange={(event) =>
                setForm((current) => ({ ...current, tokenSecret: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pve-tls-mode">
              TLS / Certificat
            </label>
            <select
              id="pve-tls-mode"
              className="field-input"
              value={form.tlsMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tlsMode:
                    event.target.value === "insecure"
                      ? "insecure"
                      : event.target.value === "custom-ca"
                        ? "custom-ca"
                        : "strict",
                }))
              }
            >
              <option value="strict">Strict (certificat valide)</option>
              <option value="insecure">Auto-signé (insecure)</option>
              <option value="custom-ca">CA custom (PEM)</option>
            </select>
          </div>

          {form.tlsMode === "custom-ca" ? (
            <div className="field">
              <label className="field-label" htmlFor="pve-custom-ca">
                Certificat CA (PEM)
              </label>
              <textarea
                id="pve-custom-ca"
                className="provision-textarea"
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={5}
                value={form.customCaCertPem}
                onChange={(event) =>
                  setForm((current) => ({ ...current, customCaCertPem: event.target.value }))
                }
              />
            </div>
          ) : null}

          <label className="setup-checkbox">
            <input
              type="checkbox"
              checked={form.ldapEnabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, ldapEnabled: event.target.checked }))
              }
            />
            <span>Activer LDAP/AD (secondaire)</span>
          </label>

          {form.ldapEnabled ? (
            <>
              <div className="field">
                <label className="field-label" htmlFor="ldap-server-url">
                  URL LDAP
                </label>
                <input
                  id="ldap-server-url"
                  className="field-input"
                  type="text"
                  placeholder="ldaps://dc.home.local:636"
                  value={form.ldapServerUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ldapServerUrl: event.target.value }))
                  }
                />
              </div>

              <div className="provision-grid">
                <div className="field">
                  <label className="field-label" htmlFor="ldap-base-dn">
                    Base DN
                  </label>
                  <input
                    id="ldap-base-dn"
                    className="field-input"
                    type="text"
                    placeholder="dc=home,dc=local"
                    value={form.ldapBaseDn}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ldapBaseDn: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="ldap-realm">
                    Realm
                  </label>
                  <input
                    id="ldap-realm"
                    className="field-input"
                    type="text"
                    placeholder="ldap"
                    value={form.ldapRealm}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ldapRealm: event.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ldap-bind-dn">
                  Bind DN (optionnel)
                </label>
                <input
                  id="ldap-bind-dn"
                  className="field-input"
                  type="text"
                  placeholder="cn=svc-proxcenter,ou=service,dc=home,dc=local"
                  value={form.ldapBindDn}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ldapBindDn: event.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ldap-bind-password">
                  Mot de passe Bind (optionnel)
                </label>
                <input
                  id="ldap-bind-password"
                  className="field-input"
                  type="password"
                  placeholder={
                    status?.runtimeSaved?.ldap.bindPasswordConfigured
                      ? "Laisser vide pour conserver"
                      : "Mot de passe bind"
                  }
                  value={form.ldapBindPassword}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ldapBindPassword: event.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="ldap-user-filter">
                  Filtre utilisateur
                </label>
                <input
                  id="ldap-user-filter"
                  className="field-input"
                  type="text"
                  placeholder="(uid={username})"
                  value={form.ldapUserFilter}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, ldapUserFilter: event.target.value }))
                  }
                />
              </div>

              <div className="provision-check-row">
                <label className="provision-check">
                  <input
                    type="checkbox"
                    checked={form.ldapStartTls}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ldapStartTls: event.target.checked }))
                    }
                  />
                  StartTLS LDAP
                </label>
                <label className="provision-check">
                  <input
                    type="checkbox"
                    checked={form.ldapAllowInsecureTls}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ldapAllowInsecureTls: event.target.checked,
                      }))
                    }
                  />
                  TLS LDAP non strict
                </label>
              </div>
            </>
          ) : null}

          <div className="setup-actions">
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null}
              onClick={() => void submit("test")}
            >
              {busy === "test" ? "Test..." : "Tester"}
            </button>
            <button
              type="button"
              className="action-btn primary"
              disabled={busy !== null}
              onClick={() => void submit("save")}
            >
              {busy === "save" ? "Enregistrement..." : "Tester + enregistrer"}
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null}
              onClick={() => void submit("save-skip")}
            >
              {busy === "save-skip" ? "Enregistrement..." : "Enregistrer sans test"}
            </button>
          </div>
        </div>

        <div className="setup-status-col">
          <article className="setup-status-card">
            <div className="row-line">
              <span>Source active</span>
              <strong>{status ? formatSource(status.source) : "..."}</strong>
            </div>
            <div className="row-line">
              <span>Connexion effective</span>
              <strong className={status?.configured ? "status-good" : undefined}>
                {status?.configured ? "Configurée" : "Non configurée"}
              </strong>
            </div>
            <div className="row-line">
              <span>URL active</span>
              <strong>{status?.effective?.baseUrl ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>TLS</span>
              <strong>{status?.effective?.tlsMode ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>Certificat CA custom</span>
              <strong>{status?.effective?.customCaConfigured ? "Oui" : "Non"}</strong>
            </div>
            <div className="row-line">
              <span>Token ID</span>
              <strong>{status?.effective?.tokenId ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>Secret</span>
              <strong>{status?.effective?.tokenSecretMasked ?? "-"}</strong>
            </div>
            <div className="row-line">
              <span>LDAP</span>
              <strong>{status?.runtimeSaved?.ldap.enabled ? "Activé" : "Désactivé"}</strong>
            </div>
          </article>

          <div className="setup-actions">
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null}
              onClick={() => void loadStatus()}
            >
              Recharger
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={busy !== null}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              {busy === "delete" ? "Suppression..." : "Supprimer config UI"}
            </button>
          </div>
        </div>
      </div>

      <StrongConfirmDialog
        key={deleteConfirmOpen ? "delete-proxmox-open" : "delete-proxmox-closed"}
        open={deleteConfirmOpen}
        title="Supprimer la connexion Proxmox"
        message="Cette action retire l’URL, le token API et les paramètres LDAP secondaires stockés dans ProxmoxCenter."
        expectedText="DELETE PROXMOX CONFIG"
        confirmLabel="Supprimer la configuration"
        busy={busy === "delete"}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={(confirmationText) => void clearRuntimeConfig(confirmationText)}
      />
    </section>
  );
}
