"use client";

import { useState } from "react";

type HardwareMonitorStatusPanelProps = {
  configured: boolean;
  canRetest: boolean;
  initialStatus: "idle" | "ok" | "error";
  initialFetchedAt: string | null;
  initialAttemptedAt: string | null;
  initialError: string | null;
};

type ProbeResponse = {
  ok?: boolean;
  error?: string;
};

function formatTimestamp(value: string | null) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function buildStatusLabel(status: "idle" | "ok" | "error", attemptedAt: string | null) {
  if (status === "ok") return `OK${attemptedAt ? ` • ${formatTimestamp(attemptedAt)}` : ""}`;
  if (status === "error") return `Erreur${attemptedAt ? ` • ${formatTimestamp(attemptedAt)}` : ""}`;
  return attemptedAt ? `En attente • ${formatTimestamp(attemptedAt)}` : "En attente";
}

export default function HardwareMonitorStatusPanel({
  configured,
  canRetest,
  initialStatus,
  initialFetchedAt,
  initialAttemptedAt,
  initialError,
}: HardwareMonitorStatusPanelProps) {
  const [status, setStatus] = useState(initialStatus);
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const [attemptedAt, setAttemptedAt] = useState(initialAttemptedAt);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function retest() {
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      const response = await fetch("/api/settings/hardware-monitor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ testOnly: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as ProbeResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Retest BMC/iLO impossible.");
      }
      setStatus("ok");
      setAttemptedAt(now);
    } catch (nextError) {
      setStatus("error");
      setAttemptedAt(now);
      setError(nextError instanceof Error ? nextError.message : "Retest BMC/iLO impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return null;
  }

  return (
    <div className="stack-sm">
      <div className="row-line">
        <span>Statut sonde</span>
        <strong>{buildStatusLabel(status, attemptedAt)}</strong>
      </div>
      <div className="row-line">
        <span>Dernière collecte métriques</span>
        <strong>{formatTimestamp(fetchedAt)}</strong>
      </div>
      {error ? (
        <div className="backup-alert error">
          <strong>Erreur sonde</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {canRetest ? (
        <div className="quick-actions">
          <button type="button" className="action-btn" onClick={() => void retest()} disabled={busy}>
            {busy ? "Retest..." : "Retester la sonde"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
