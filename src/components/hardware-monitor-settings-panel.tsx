"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";

type HardwareMonitorStatusPayload = {
  ok: boolean;
  configured: boolean;
  runtimeSaved: {
    enabled: boolean;
    nodeName: string | null;
    label: string | null;
    baseUrl: string;
    protocol: "https" | "http";
    host: string;
    port: number;
    username: string;
    tlsMode: "strict" | "insecure" | "custom-ca";
    allowInsecureTls: boolean;
    customCaConfigured: boolean;
    passwordMasked: string;
    updatedAt: string;
  } | null;
  probe: {
    ok: true;
    vendor: string | null;
    model: string | null;
    serial: string | null;
    managerModel: string | null;
    firmwareVersion: string | null;
  } | null;
  saved?: boolean;
  tested?: boolean;
  error?: string;
};

type FormState = {
  enabled: boolean;
  nodeName: string;
  label: string;
  protocol: "https" | "http";
  host: string;
  port: string;
  username: string;
  password: string;
  tlsMode: "strict" | "insecure" | "custom-ca";
  customCaCertPem: string;
};

const EMPTY_FORM: FormState = {
  enabled: true,
  nodeName: "",
  label: "",
  protocol: "https",
  host: "",
  port: "443",
  username: "",
  password: "",
  tlsMode: "strict",
  customCaCertPem: "",
};

function buildBaseUrlPreview(form: FormState) {
  const host = form.host.trim() || "ilo.example.local";
  const port = form.port.trim() || (form.protocol === "https" ? "443" : "80");
  return `${form.protocol}://${host}:${port}`;
}

export default function HardwareMonitorSettingsPanel() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<HardwareMonitorStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "test" | "save" | "save-skip" | "delete">(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const baseUrlPreview = useMemo(() => buildBaseUrlPreview(form), [form]);

  async function loadStatus() {
    setLoading(true);
    setFlash(null);
    try {
      const response = await fetch("/api/settings/hardware-monitor", { cache: "no-store" });
      const payload = (await response.json()) as HardwareMonitorStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger la configuration BMC/iLO.");
      }

      setStatus(payload);
      if (payload.runtimeSaved) {
        setForm((current) => ({
          ...current,
          enabled: payload.runtimeSaved?.enabled ?? true,
          nodeName: payload.runtimeSaved?.nodeName ?? "",
          label: payload.runtimeSaved?.label ?? "",
          protocol: payload.runtimeSaved?.protocol ?? "https",
          host: payload.runtimeSaved?.host ?? "",
          port: String(payload.runtimeSaved?.port ?? 443),
          username: payload.runtimeSaved?.username ?? "",
          password: "",
          tlsMode: payload.runtimeSaved?.tlsMode ?? "strict",
          customCaCertPem: "",
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
      const response = await fetch("/api/settings/hardware-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          nodeName: form.nodeName,
          label: form.label,
          protocol: form.protocol,
          host: form.host,
          port: form.port,
          username: form.username,
          password: form.password,
          tlsMode: form.tlsMode,
          customCaCertPem: form.tlsMode === "custom-ca" ? form.customCaCertPem : "",
          testOnly: kind === "test",
          skipTest: kind === "save-skip",
        }),
      });
      const payload = (await response.json()) as HardwareMonitorStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Échec de la configuration BMC/iLO.");
      }

      setStatus(payload);
      setForm((current) => ({
        ...current,
        password: "",
        customCaCertPem: current.tlsMode === "custom-ca" ? current.customCaCertPem : "",
      }));
      setFlash({
        type: "success",
        text:
          kind === "test"
            ? "Connexion BMC/iLO OK."
            : kind === "save-skip"
              ? "Configuration BMC/iLO enregistrée (sans test)."
              : "Configuration BMC/iLO enregistrée.",
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
      const response = await fetch("/api/settings/hardware-monitor", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText }),
      });
      const payload = (await response.json()) as HardwareMonitorStatusPayload;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de supprimer la config BMC/iLO.");
      }

      setStatus(payload);
      setForm(EMPTY_FORM);
      setDeleteConfirmOpen(false);
      setFlash({ type: "success", text: "Configuration BMC/iLO supprimée." });

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
    <section className="settings-block">
      <div className="panel-head">
        <h2>Sonde serveur BMC / iLO</h2>
        <span className="muted">{loading ? "Chargement..." : "Redfish matériel"}</span>
      </div>

      {flash ? (
        <div className={`setup-flash ${flash.type === "error" ? "error-box" : "setup-success"}`}>
          {flash.text}
        </div>
      ) : null}

      <div className="stack-sm">
        <label className="toggle-row">
          <span className="toggle-label">
            <strong>Collecte activée</strong>
            <span className="muted">Active la remontée BMC/iLO dans Observabilité.</span>
          </span>
          <span className="settings-toggle">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <span />
          </span>
        </label>
      </div>

      <div className="provision-grid">
        <div className="field">
          <label className="field-label" htmlFor="hardware-node-name">
            Nœud Proxmox lié
          </label>
          <input
            id="hardware-node-name"
            className="field-input"
            type="text"
            placeholder="pve01"
            value={form.nodeName}
            onChange={(event) => setForm((current) => ({ ...current, nodeName: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hardware-label">
            Libellé
          </label>
          <input
            id="hardware-label"
            className="field-input"
            type="text"
            placeholder="HPE iLO principal"
            value={form.label}
            onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
          />
        </div>
      </div>

      <div className="provision-grid">
        <div className="field">
          <label className="field-label" htmlFor="hardware-protocol">
            Protocole
          </label>
          <select
            id="hardware-protocol"
            className="field-input"
            value={form.protocol}
            onChange={(event) =>
              setForm((current) => {
                const nextProtocol = event.target.value === "http" ? "http" : "https";
                const trimmedPort = current.port.trim();
                const nextPort =
                  !trimmedPort || trimmedPort === "80" || trimmedPort === "443"
                    ? nextProtocol === "http"
                      ? "80"
                      : "443"
                    : current.port;
                return {
                  ...current,
                  protocol: nextProtocol,
                  port: nextPort,
                };
              })
            }
          >
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hardware-host">
            Host DNS / IP
          </label>
          <input
            id="hardware-host"
            className="field-input"
            type="text"
            placeholder="ilo.example.local"
            value={form.host}
            onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hardware-port">
            Port
          </label>
          <input
            id="hardware-port"
            className="field-input"
            type="number"
            min={1}
            max={65535}
            placeholder={form.protocol === "https" ? "443" : "80"}
            value={form.port}
            onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
          />
        </div>
      </div>

      <div className="provision-grid">
        <div className="field">
          <label className="field-label" htmlFor="hardware-username">
            Login BMC / iLO
          </label>
          <input
            id="hardware-username"
            className="field-input"
            type="text"
            placeholder="Administrator"
            value={form.username}
            onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hardware-password">
            Mot de passe
          </label>
          <input
            id="hardware-password"
            className="field-input"
            type="password"
            placeholder={
              status?.runtimeSaved ? "Laisser vide pour conserver le mot de passe actuel" : "Mot de passe BMC / iLO"
            }
            value={form.password}
            onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="hardware-tls-mode">
            TLS
          </label>
          <select
            id="hardware-tls-mode"
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
            <option value="strict">Strict</option>
            <option value="insecure">Insecure</option>
            <option value="custom-ca">CA personnalisée</option>
          </select>
        </div>
      </div>

      {form.tlsMode === "custom-ca" ? (
        <div className="field">
          <label className="field-label" htmlFor="hardware-custom-ca">
            Certificat CA personnalisé
          </label>
          <textarea
            id="hardware-custom-ca"
            className="field-input field-textarea"
            rows={6}
            placeholder="-----BEGIN CERTIFICATE-----"
            value={form.customCaCertPem}
            onChange={(event) => setForm((current) => ({ ...current, customCaCertPem: event.target.value }))}
          />
        </div>
      ) : null}

      <div className="mini-list-item">
        <div>
          <div className="item-title">Endpoint Redfish</div>
          <div className="item-subtitle">{baseUrlPreview}</div>
        </div>
        <div className="item-metric">
          {status?.runtimeSaved?.passwordMasked ? `Secret ${status.runtimeSaved.passwordMasked}` : "Non configuré"}
        </div>
      </div>

      {status?.probe ? (
        <div className="backup-alert info">
          <strong>Détection BMC</strong>
          <p>
            {[
              status.probe.vendor,
              status.probe.model,
              status.probe.managerModel,
              status.probe.firmwareVersion ? `FW ${status.probe.firmwareVersion}` : null,
              status.probe.serial ? `S/N ${status.probe.serial}` : null,
            ]
              .filter(Boolean)
              .join(" • ")}
          </p>
        </div>
      ) : null}

      <div className="quick-actions">
        <button
          type="button"
          className="action-btn"
          onClick={() => void submit("test")}
          disabled={busy !== null}
        >
          {busy === "test" ? "Test..." : "Tester"}
        </button>
        <button
          type="button"
          className="action-btn primary"
          onClick={() => void submit("save")}
          disabled={busy !== null}
        >
          {busy === "save" ? "Enregistrement..." : "Enregistrer"}
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={() => void submit("save-skip")}
          disabled={busy !== null}
        >
          {busy === "save-skip" ? "Enregistrement..." : "Enregistrer sans test"}
        </button>
        {status?.runtimeSaved ? (
          <button type="button" className="action-btn" onClick={() => setDeleteConfirmOpen(true)} disabled={busy !== null}>
            Supprimer
          </button>
        ) : null}
      </div>

      {deleteConfirmOpen ? (
        <StrongConfirmDialog
          open={deleteConfirmOpen}
          title="Supprimer la sonde BMC / iLO"
          message="Cette action retire les identifiants et l’endpoint Redfish stockés localement."
          expectedText="DELETE HARDWARE MONITOR"
          confirmLabel="Supprimer"
          busy={busy === "delete"}
          onCancel={() => {
            if (busy === "delete") return;
            setDeleteConfirmOpen(false);
          }}
          onConfirm={(confirmationText) => {
            void clearRuntimeConfig(confirmationText);
          }}
        />
      ) : null}
    </section>
  );
}
