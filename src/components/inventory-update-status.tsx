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
};

type ViewTone = "neutral" | "ok" | "warn" | "error";

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export default function InventoryUpdateStatus({
  live,
  node,
  vmid,
  kind,
  status,
}: InventoryUpdateStatusProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpdateScanResponse | null>(null);
  const [error, setError] = useState<string>("");
  const autoScanKeyRef = useRef("");

  const hasTarget = Boolean(node) && typeof vmid === "number" && vmid > 0 && Boolean(kind) && Boolean(status);
  const canScan = live && hasTarget && kind === "qemu" && status === "running";
  const scopeKey = `${live ? "1" : "0"}:${node ?? ""}:${vmid ?? ""}:${kind ?? ""}:${status ?? ""}`;

  async function requestScan(nodeName: string, vmId: number, workloadKind: WorkloadKind) {
    const response = await fetch("/api/workloads/updates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node: nodeName, vmid: vmId, kind: workloadKind }),
    });
    const payload = (await response.json().catch(() => ({}))) as UpdateScanResponse;

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || payload.message || `Scan impossible (${response.status}).`);
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
      setError(scanError instanceof Error ? scanError.message : "Erreur de scan MAJ.");
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
          setError(scanError instanceof Error ? scanError.message : "Erreur de scan MAJ.");
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
  let title = "Mises à jour non scannées";
  let message = "Lance un scan pour vérifier les updates invitées.";

  if (!live) {
    title = "Connexion Proxmox requise";
    message = "Configure la connexion Proxmox pour interroger les updates VM.";
  } else if (!hasTarget) {
    title = "Aucune VM sélectionnée";
    message = "Sélectionne une VM dans la liste pour vérifier ses mises à jour.";
  } else if (kind !== "qemu") {
    title = "Type non supporté";
    message = "Scan updates invité disponible uniquement pour les VM QEMU.";
  } else if (status !== "running") {
    title = "VM arrêtée";
    message = "Démarre la VM puis relance le scan des mises à jour.";
  } else if (loading) {
    title = "Scan en cours";
    message = "Interrogation guest-agent en cours…";
  } else if (error) {
    tone = "error";
    title = "Scan en erreur";
    message = error;
  } else if (result) {
    const pending = typeof result.pendingCount === "number" ? result.pendingCount : null;
    if (result.supported === false) {
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
      message = asText(result.message) || "Résultat de scan non détaillé.";
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
          <span className="muted">Mises à jour invité</span>
          <strong>Windows + Debian/Ubuntu</strong>
        </div>
        <button
          type="button"
          className="inventory-ghost-btn"
          onClick={() => {
            void runScan();
          }}
          disabled={!canScan || loading}
        >
          {loading ? "Scan..." : "Scanner MAJ OS"}
        </button>
      </div>

      <div className={`inventory-update-card tone-${tone}`}>
        <div className="inventory-update-card-head">
          <strong>{title}</strong>
          {pendingCount !== null ? (
            <span className={`inventory-update-count ${pendingCount > 0 ? "warn" : "ok"}`}>
              {pendingCount} MAJ
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
