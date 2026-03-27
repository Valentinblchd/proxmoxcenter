"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";

type UpdateStatus = "idle" | "running" | "success" | "failed";

type UpdateJob = {
  id: string;
  status: UpdateStatus;
  requestedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  branch: string;
  service: string;
  message: string | null;
  error: string | null;
};

type UpdateAvailabilityStatus = "disabled" | "unknown" | "up-to-date" | "update-available" | "error";

type UpdateAvailability = {
  status: UpdateAvailabilityStatus;
  message: string;
  checkedAt: string | null;
  currentRef: string | null;
  availableRef: string | null;
  serviceImage: string | null;
};

type UpdateOverview = {
  ok?: boolean;
  error?: string;
  enabled: boolean;
  config: {
    branch: string;
    service: string;
    runnerImage: string;
    installDir: string;
  };
  prerequisites: {
    dockerSocketAvailable: boolean;
    dockerCliAvailable: boolean;
  };
  current: UpdateJob | null;
  history: UpdateJob[];
  logs: string[];
  availability: UpdateAvailability;
};

const EXPECTED_CONFIRM = "UPDATE PROXMOXCENTER";
const AUTO_UPDATE_CHECK_MS = 10 * 60_000;

function statusLabel(status: UpdateStatus | null | undefined) {
  switch (status) {
    case "running":
      return "En cours";
    case "success":
      return "Terminé";
    case "failed":
      return "Échec";
    default:
      return "Prêt";
  }
}

function availabilityLabel(status: UpdateAvailabilityStatus | null | undefined) {
  switch (status) {
    case "update-available":
      return "Mise à jour disponible";
    case "up-to-date":
      return "À jour";
    case "error":
      return "Erreur";
    case "disabled":
      return "Désactivé";
    default:
      return "En attente";
  }
}

export default function SelfUpdateSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<UpdateOverview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [offlineDuringRestart, setOfflineDuringRestart] = useState(false);
  const [reloadNotice, setReloadNotice] = useState("");
  const reloadTimerRef = useRef<number | null>(null);
  const previousStatusRef = useRef<UpdateStatus | null>(null);
  const currentStatusRef = useRef<UpdateStatus | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const response = await fetch("/api/system/self-update", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as UpdateOverview;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Impossible de lire l’état update.");
      }
      setOverview(payload);
      setError("");
      setOfflineDuringRestart(false);
      return payload;
    } catch (requestError) {
      if (currentStatusRef.current === "running") {
        setOfflineDuringRestart(true);
        return null;
      }
      throw requestError;
    }
  }, []);

  const refreshAvailability = useCallback(async () => {
    try {
      const response = await fetch("/api/system/self-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ action: "refresh" }),
      });
      const payload = (await response.json().catch(() => ({}))) as UpdateOverview;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Impossible de vérifier les mises à jour.");
      }
      setOverview(payload);
      setError("");
      setOfflineDuringRestart(false);
      return payload;
    } catch (requestError) {
      if (currentStatusRef.current === "running") {
        setOfflineDuringRestart(true);
        return null;
      }
      throw requestError;
    }
  }, []);

  const currentStatus = overview?.current?.status ?? null;

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    loadOverview()
      .catch((requestError) => {
        if (disposed) return;
        setError(requestError instanceof Error ? requestError.message : "Erreur de chargement.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [loadOverview]);

  useEffect(() => {
    currentStatusRef.current = currentStatus;
    const previous = previousStatusRef.current;
    if (previous === "running" && currentStatus === "success") {
      setReloadNotice("Mise à jour terminée. Rechargement automatique...");
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
      }
      reloadTimerRef.current = window.setTimeout(() => {
        window.location.reload();
      }, 1800);
    }
    previousStatusRef.current = currentStatus;
  }, [currentStatus]);

  useEffect(() => {
    if (currentStatus === "running") {
      const timer = window.setInterval(() => {
        void loadOverview().catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : "Erreur update.");
        });
      }, 2500);
      return () => {
        window.clearInterval(timer);
      };
    }

    const timer = window.setInterval(() => {
      void refreshAvailability().catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Erreur update.");
      });
    }, AUTO_UPDATE_CHECK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [currentStatus, loadOverview, refreshAvailability]);

  useEffect(
    () => () => {
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
      }
    },
    [],
  );

  const canStart = useMemo(() => {
    if (!overview?.enabled) return false;
    if (!overview.prerequisites.dockerSocketAvailable) return false;
    if (overview.availability.status === "up-to-date") return false;
    return overview.current?.status !== "running" && !busy;
  }, [busy, overview]);

  const updateButtonLabel =
    busy
      ? "Lancement..."
      : overview?.availability.status === "up-to-date"
        ? "Déjà à jour"
        : "Mettre à jour";

  async function postAction(action: "start" | "reset" | "refresh", confirmationText?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/system/self-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ action, confirmationText }),
      });
      const payload = (await response.json().catch(() => ({}))) as UpdateOverview;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Action update impossible.");
      }
      setOverview(payload);
      if (action === "start") {
        setConfirmOpen(false);
        setOfflineDuringRestart(false);
        setReloadNotice("");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Erreur update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-block">
      <div className="panel-head">
        <h2>Mise à jour ProxmoxCenter</h2>
        <span
          className={`inventory-badge ${
            overview?.current?.status === "success"
              ? "status-running"
              : overview?.current?.status === "failed"
                ? "status-stopped"
                : overview?.current?.status === "running"
                  ? "status-template"
                  : "status-template"
          }`}
        >
          {statusLabel(overview?.current?.status)}
        </span>
      </div>

      {loading ? (
        <div className="inline-loader" role="status" aria-live="polite">
          <span className="inline-loader-dots" aria-hidden="true">
            <span />
          </span>
          <span className="inline-loader-label">Chargement de l’état de mise à jour</span>
        </div>
      ) : null}

      {!loading && overview ? (
        <>
          <div className="row-line">
            <span>Mise à jour depuis l’interface</span>
            <strong>{overview.enabled ? "Activé" : "Désactivé"}</strong>
          </div>
          <div className="row-line">
            <span>Détection des mises à jour</span>
            <strong
              className={
                overview.availability.status === "update-available"
                  ? "status-bad"
                  : overview.availability.status === "up-to-date"
                    ? "status-good"
                    : ""
              }
            >
              {availabilityLabel(overview.availability.status)}
            </strong>
          </div>
          <div className="row-line">
            <span>Dernière vérification</span>
            <strong>
              {overview.availability.checkedAt
                ? new Date(overview.availability.checkedAt).toLocaleString()
                : "Jamais"}
            </strong>
          </div>
          <div className="row-line">
            <span>Vérification automatique</span>
            <strong>Toutes les 10 min</strong>
          </div>
          {overview.availability.currentRef ? (
            <div className="row-line">
              <span>Version active</span>
              <strong>{overview.availability.currentRef}</strong>
            </div>
          ) : null}
          {overview.availability.availableRef ? (
            <div className="row-line">
              <span>Version disponible</span>
              <strong>{overview.availability.availableRef}</strong>
            </div>
          ) : null}
          <div className="backup-alert info">
            <strong>État</strong>
            <p>{overview.availability.message}</p>
          </div>

          <details className="self-update-log-wrap">
            <summary>Diagnostic technique</summary>
            <div className="stack-sm">
              <div className="row-line">
                <span>Docker socket</span>
                <strong className={overview.prerequisites.dockerSocketAvailable ? "status-good" : "status-bad"}>
                  {overview.prerequisites.dockerSocketAvailable ? "Monté" : "Absent"}
                </strong>
              </div>
              <div className="row-line">
                <span>Docker CLI</span>
                <strong className={overview.prerequisites.dockerCliAvailable ? "status-good" : "status-bad"}>
                  {overview.prerequisites.dockerCliAvailable ? "Disponible" : "Absent"}
                </strong>
              </div>
              <div className="row-line">
                <span>Branche</span>
                <strong>{overview.config.branch}</strong>
              </div>
              <div className="row-line">
                <span>Service Compose</span>
                <strong>{overview.config.service}</strong>
              </div>
              {overview.availability.serviceImage ? (
                <div className="row-line">
                  <span>Image du service</span>
                  <strong>{overview.availability.serviceImage}</strong>
                </div>
              ) : null}
            </div>
          </details>

          {overview.current ? (
            <div className="mini-list-item">
              <div>
                <div className="item-title">Job de mise à jour: {overview.current.id}</div>
                <div className="item-subtitle">
                  {overview.current.requestedBy ? `Demandé par ${overview.current.requestedBy}` : "Demandé depuis l’interface"}
                  {overview.current.finishedAt ? ` • fini à ${new Date(overview.current.finishedAt).toLocaleString()}` : ""}
                </div>
                {overview.current.message ? <div className="item-subtitle">{overview.current.message}</div> : null}
                {overview.current.error ? <div className="item-subtitle status-bad">{overview.current.error}</div> : null}
              </div>
            </div>
          ) : null}

          <div className="quick-actions">
            <button
              type="button"
              className="action-btn primary"
              onClick={() => setConfirmOpen(true)}
              disabled={!canStart}
            >
              {updateButtonLabel}
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => void postAction("refresh")}
              disabled={busy}
            >
              Vérifier les mises à jour
            </button>
            {overview.current && overview.current.status !== "running" ? (
              <button
                type="button"
                className="action-btn"
                onClick={() => void postAction("reset")}
                disabled={busy}
              >
                Nettoyer l’état
              </button>
            ) : null}
          </div>

          <details className="self-update-log-wrap">
            <summary>Journal d’exécution</summary>
            <pre className="self-update-log">
              {overview.logs.length > 0 ? overview.logs.join("\n") : "Aucun log pour le moment."}
            </pre>
          </details>
        </>
      ) : null}

      {error ? <p className="warning-text">{error}</p> : null}

      {confirmOpen ? (
        <StrongConfirmDialog
          open={confirmOpen}
          title="Confirmer la mise à jour"
          message="Cette action va redémarrer ProxmoxCenter pendant la reconstruction du service."
          expectedText={EXPECTED_CONFIRM}
          confirmLabel="Lancer la mise à jour"
          busy={busy}
          onCancel={() => {
            if (busy) return;
            setConfirmOpen(false);
          }}
          onConfirm={(confirmationText) => {
            void postAction("start", confirmationText);
          }}
        />
      ) : null}

      {overview?.current?.status === "running" || offlineDuringRestart ? (
        <div className="self-update-overlay" role="status" aria-live="polite">
          <div className="self-update-overlay-card">
            <h3>Mise à jour en cours</h3>
            <p className="muted">
              {offlineDuringRestart
                ? "Redémarrage du service détecté. Reconnexion automatique..."
                : "ProxmoxCenter applique la mise à jour, merci de patienter."}
            </p>
            {reloadNotice ? <p className="status-good">{reloadNotice}</p> : null}
            <div className="inventory-progress inventory-progress-wide" aria-hidden>
              <span className="tone-orange" style={{ width: "72%" }} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
