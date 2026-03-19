"use client";

import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/ui/format";

type WorkloadKind = "qemu" | "lxc";
type WorkloadStatus = "running" | "stopped" | "template";

type InventoryUpdateStatusProps = {
  live: boolean;
  node?: string;
  vmid?: number;
  kind?: WorkloadKind;
  status?: WorkloadStatus;
  shellHref?: string | null;
};

type UpdateScanResponse = {
  ok?: boolean;
  supported?: boolean;
  osFamily?: "windows" | "debian" | "linux" | "unknown";
  osLabel?: string;
  pendingCount?: number | null;
  checkedAt?: string;
  message?: string;
  error?: string;
  scanMode?: "guest-agent" | "manual-shell" | "unsupported";
  commands?: string[];
};

type ViewTone = "neutral" | "ok" | "warn" | "error";

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function presentUpdateError(raw: string) {
  const text = raw.trim();
  if (/guest agent is not running/i.test(text)) {
    return "L’agent invité n’est pas actif dans cette VM.";
  }
  if (/401|403|forbidden|unauthorized/i.test(text)) {
    return "Le scan a été refusé par Proxmox.";
  }
  return text;
}

export default function InventoryUpdateStatus({
  live,
  node,
  vmid,
  kind,
  status,
  shellHref = null,
}: InventoryUpdateStatusProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpdateScanResponse | null>(null);
  const [error, setError] = useState<string>("");
  const autoScanKeyRef = useRef("");

  const hasTarget = Boolean(node) && typeof vmid === "number" && vmid > 0 && Boolean(kind) && Boolean(status);
  const canScan = live && hasTarget && status === "running" && (kind === "qemu" || kind === "lxc");
  const scopeKey = `${live ? "1" : "0"}:${node ?? ""}:${vmid ?? ""}:${kind ?? ""}:${status ?? ""}`;

  async function requestScan(nodeName: string, vmId: number, workloadKind: WorkloadKind) {
    const response = await fetch("/api/workloads/updates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: nodeName, vmid: vmId, kind: workloadKind }),
    });
    const payload = (await response.json().catch(() => ({}))) as UpdateScanResponse;

    if (!response.ok || payload.ok === false) {
      throw new Error(presentUpdateError(payload.error || payload.message || `Scan impossible (${response.status}).`));
    }

    return payload;
  }

  async function runScan() {
    if (!canScan || !node || typeof vmid !== "number" || !kind) return;

    setLoading(true);
    setError("");

    try {
      const payload = await requestScan(node, vmid, kind);
      setResult(payload);
    } catch (scanError) {
      setError(
        scanError instanceof Error
          ? presentUpdateError(scanError.message)
          : "Erreur lors de l’analyse des mises à jour.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setResult(null);
    setError("");
    setLoading(false);

    if (!canScan || !node || typeof vmid !== "number" || !kind) {
      autoScanKeyRef.current = "";
      return;
    }

    if (autoScanKeyRef.current === scopeKey) return;
    autoScanKeyRef.current = scopeKey;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await requestScan(node, vmid, kind);
        if (cancelled) return;

        setResult(payload);
      } catch (scanError) {
        if (!cancelled) {
          setError(
            scanError instanceof Error
              ? presentUpdateError(scanError.message)
              : "Erreur lors de l’analyse des mises à jour.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canScan, kind, live, node, scopeKey, status, vmid]);

  let tone: ViewTone = "neutral";
  let title = "Scan non lancé";
  let message = "Lance un scan pour vérifier les mises à jour de l’OS.";

  if (!live) {
    title = "Connexion Proxmox requise";
    message = "Configure Proxmox pour interroger l’OS invité.";
  } else if (!hasTarget) {
    title = "Aucune VM sélectionnée";
    message = "Sélectionne une VM pour vérifier son OS.";
  } else if (status !== "running") {
    title = kind === "lxc" ? "CT arrêté" : "VM arrêtée";
    message = `Démarre ${kind === "lxc" ? "le conteneur" : "la VM"} puis relance le scan.`;
  } else if (loading) {
    title = "Scan en cours";
    message = "Interrogation guest-agent en cours…";
  } else if (error) {
    tone = "error";
    title = "Scan en erreur";
    message = error;
  } else if (result) {
    const pending = typeof result.pendingCount === "number" ? result.pendingCount : null;
    if (result.scanMode === "manual-shell") {
      tone = "warn";
      title = "Scan manuel requis";
      message = asText(result.message) || "Passe par la console invité pour vérifier les mises à jour.";
    } else if (result.supported === false) {
      title = "Scan indisponible";
      message = asText(result.message) || "Cette VM ne permet pas le scan automatique.";
    } else if (pending !== null && pending > 0) {
      tone = "warn";
      title = "Mises à jour disponibles";
      message = `${pending} mise(s) à jour en attente.`;
    } else if (pending === 0) {
      tone = "ok";
      title = "Système à jour";
      message = "Aucune mise à jour détectée.";
    } else {
      title = "Scan terminé";
      message = asText(result.message) || "Le scan s’est terminé sans détail supplémentaire.";
    }
  }

  const checkedAtText =
    result?.checkedAt && !Number.isNaN(new Date(result.checkedAt).getTime())
      ? formatRelativeTime(result.checkedAt)
      : "";
  const pendingCount = typeof result?.pendingCount === "number" ? result.pendingCount : null;

  return (
    <section className="inventory-update-panel" aria-live="polite">
      <div className="inventory-update-head">
        <div className="inventory-update-title">
          <span className="muted">Mises à jour OS</span>
          <strong>{kind === "lxc" ? "Conteneur LXC" : "VM"}</strong>
        </div>
        <div className="inventory-update-actions">
          {shellHref && result?.scanMode === "manual-shell" ? (
            <a href={shellHref} className="inventory-ghost-btn">
              Ouvrir la console
            </a>
          ) : null}
          <button
            type="button"
            className="inventory-ghost-btn"
            onClick={() => {
              void runScan();
            }}
            disabled={!canScan || loading}
          >
            {loading ? "Scan..." : "Scanner"}
          </button>
        </div>
      </div>

      <div className={`inventory-update-card tone-${tone}`}>
        <div className="inventory-update-card-head">
          <strong>{title}</strong>
          {pendingCount !== null ? (
            <span className={`inventory-update-count ${pendingCount > 0 ? "warn" : "ok"}`}>
              {pendingCount} maj
            </span>
          ) : null}
        </div>
        <p className="muted">{message}</p>

        <div className="inventory-update-meta">
          {asText(result?.osLabel) ? <span>OS: {result?.osLabel}</span> : null}
          {checkedAtText ? <span>Dernier scan: {checkedAtText}</span> : null}
        </div>
      </div>
    </section>
  );
}
