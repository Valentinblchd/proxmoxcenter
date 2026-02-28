"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";

type SetupStatusPayload = {
  ok: boolean;
  configured: boolean;
  runtimeSaved: {
    host: string;
    port: number;
    datastore: string;
    authId: string;
    namespace: string | null;
    fingerprintConfigured: boolean;
    secretMasked: string;
    updatedAt: string;
  } | null;
  tooling: {
    available: boolean;
    version: string | null;
    error?: string;
  };
  saved?: boolean;
  error?: string;
};

type FormState = {
  host: string;
  port: string;
  datastore: string;
  authId: string;
  secret: string;
  namespace: string;
  fingerprint: string;
};

const EMPTY_FORM: FormState = {
  host: "",
  port: "8007",
  datastore: "",
  authId: "",
  secret: "",
  namespace: "",
  fingerprint: "",
};

function buildRepositoryPreview(form: FormState) {
  const host = form.host.trim() || "pbs.home.local";
  const port = form.port.trim() || "8007";
  const authId = form.authId.trim() || "backup@pbs!proxcenter";
  const datastore = form.datastore.trim() || "backup";
  return `${authId}@${host}:${port}:${datastore}`;
}

export default function PbsConnectionForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<SetupStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const repositoryPreview = useMemo(() => buildRepositoryPreview(form), [form]);

  async function loadStatus() {
    setLoading(true);
    setFlash(null);

    try {
      const response = await fetch("/api/setup/pbs", { cache: "no-store" });
      const payload = (await response.json()) as SetupStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger la configuration PBS.");
      }

      setStatus(payload);
      if (payload.runtimeSaved) {
        setForm((current) => ({
          ...current,
          host: payload.runtimeSaved?.host ?? "",
          port: String(payload.runtimeSaved?.port ?? 8007),
          datastore: payload.runtimeSaved?.datastore ?? "",
          authId: payload.runtimeSaved?.authId ?? "",
          namespace: payload.runtimeSaved?.namespace ?? "",
          secret: "",
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

  async function save() {
    setBusy("save");
    setFlash(null);

    try {
      const response = await fetch("/api/setup/pbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: form.host,
          port: form.port,
          datastore: form.datastore,
          authId: form.authId,
          secret: form.secret,
          namespace: form.namespace,
          fingerprint: form.fingerprint,
        }),
      });
      const payload = (await response.json()) as SetupStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Échec de l’enregistrement PBS.");
      }

      setStatus(payload);
      setForm((current) => ({ ...current, secret: "" }));
      setFlash({ type: "success", text: "Configuration PBS enregistrée." });

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
      const response = await fetch("/api/setup/pbs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText }),
      });
      const payload = (await response.json()) as SetupStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de supprimer la config PBS.");
      }

      setStatus(payload);
      setForm(EMPTY_FORM);
      setDeleteConfirmOpen(false);
      setFlash({ type: "success", text: "Configuration PBS supprimée." });

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
        <h2>Connexion Proxmox Backup Server</h2>
        <span className="muted">{loading ? "Chargement..." : "Connexion PBS directe"}</span>
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
              <label className="field-label" htmlFor="pbs-host">
                Host DNS / IP
              </label>
              <input
                id="pbs-host"
                className="field-input"
                type="text"
                placeholder="pbs.home.local"
                value={form.host}
                onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pbs-port">
                Port
              </label>
              <input
                id="pbs-port"
                className="field-input"
                type="number"
                min={1}
                max={65535}
                placeholder="8007"
                value={form.port}
                onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
              />
            </div>
          </div>

          <div className="provision-grid">
            <div className="field">
              <label className="field-label" htmlFor="pbs-datastore">
                Datastore
              </label>
              <input
                id="pbs-datastore"
                className="field-input"
                type="text"
                placeholder="backup"
                value={form.datastore}
                onChange={(event) => setForm((current) => ({ ...current, datastore: event.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pbs-authid">
                Auth ID
              </label>
              <input
                id="pbs-authid"
                className="field-input"
                type="text"
                placeholder="backup@pbs!proxcenter"
                value={form.authId}
                onChange={(event) => setForm((current) => ({ ...current, authId: event.target.value }))}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pbs-secret">
              Secret / token
            </label>
            <input
              id="pbs-secret"
              className="field-input"
              type="password"
              placeholder="Secret PBS"
              value={form.secret}
              onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))}
            />
          </div>

          <div className="provision-grid">
            <div className="field">
              <label className="field-label" htmlFor="pbs-namespace">
                Namespace (optionnel)
              </label>
              <input
                id="pbs-namespace"
                className="field-input"
                type="text"
                placeholder="imports/cloud"
                value={form.namespace}
                onChange={(event) => setForm((current) => ({ ...current, namespace: event.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="pbs-fingerprint">
                Fingerprint certificat (optionnel)
              </label>
              <input
                id="pbs-fingerprint"
                className="field-input"
                type="text"
                placeholder="AB:CD:..."
                value={form.fingerprint}
                onChange={(event) => setForm((current) => ({ ...current, fingerprint: event.target.value }))}
              />
            </div>
          </div>

          <div className="hint-box">
            <div className="item-title">Repository PBS</div>
            <div className="item-subtitle">{repositoryPreview}</div>
          </div>

          <div className="quick-actions">
            <button type="button" className="action-btn primary" onClick={() => void save()} disabled={busy !== null}>
              {busy === "save" ? "Enregistrement..." : "Enregistrer PBS"}
            </button>
            <button type="button" className="action-btn" onClick={() => setDeleteConfirmOpen(true)} disabled={busy !== null}>
              {busy === "delete" ? "Suppression..." : "Supprimer PBS"}
            </button>
          </div>
        </div>

        <aside className="setup-status-col">
          <div className="setup-status-card">
            <h3>État PBS</h3>
            <div className="setup-status-lines">
              <div className="row-line">
                <span>Config active</span>
                <strong>{status?.configured ? "Oui" : "Non"}</strong>
              </div>
              <div className="row-line">
                <span>Datastore</span>
                <strong>{status?.runtimeSaved?.datastore ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Auth ID</span>
                <strong>{status?.runtimeSaved?.authId ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Secret</span>
                <strong>{status?.runtimeSaved?.secretMasked ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Namespace</span>
                <strong>{status?.runtimeSaved?.namespace ?? "—"}</strong>
              </div>
              <div className="row-line">
                <span>Fingerprint</span>
                <strong>{status?.runtimeSaved?.fingerprintConfigured ? "Oui" : "Non"}</strong>
              </div>
              <div className="row-line">
                <span>Tooling local</span>
                <strong className={status?.tooling.available ? "status-good" : "status-bad"}>
                  {status?.tooling.available ? "OK" : "Absent"}
                </strong>
              </div>
            </div>
            {status?.tooling.version ? <p className="muted">{status.tooling.version}</p> : null}
            {status?.tooling.error ? <p className="muted">{status.tooling.error}</p> : null}
          </div>
        </aside>
      </div>

      <StrongConfirmDialog
        key={deleteConfirmOpen ? "delete-pbs-open" : "delete-pbs-closed"}
        open={deleteConfirmOpen}
        title="Supprimer la connexion PBS"
        message="Cette action retire la configuration Proxmox Backup Server stockée dans ProxmoxCenter."
        expectedText="DELETE PBS CONFIG"
        confirmLabel="Supprimer la configuration"
        busy={busy === "delete"}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={(confirmationText) => void clearRuntimeConfig(confirmationText)}
      />
    </section>
  );
}
