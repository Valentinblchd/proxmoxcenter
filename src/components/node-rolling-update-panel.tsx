"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";
import { formatRelativeTime } from "@/lib/ui/format";

type RollingUpdatePolicy = {
  autoSecurityNoReboot: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

type RollingUpdateMigration = {
  kind: "qemu" | "lxc";
  vmid: number;
  name: string;
  sourceNode: string;
  targetNode: string;
  online: boolean;
  downtimeRisk: boolean;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  returnStatus: "pending" | "running" | "completed" | "failed" | "cancelled";
  returnError: string | null;
};

type RollingUpdateJob = {
  id: string;
  node: string;
  createdAt: string;
  status: "queued" | "running" | "awaiting-manual" | "completed" | "failed" | "cancelled";
  phase:
    | "queued"
    | "refreshing-updates"
    | "planning-migrations"
    | "draining-node"
    | "awaiting-manual-patch"
    | "auto-patching"
    | "migrating-back"
    | "completed"
    | "failed"
    | "cancelled";
  updates: {
    counts: {
      total: number;
      security: number;
      rebootRisk: number;
      autoHotSafe: number;
    };
  } | null;
  migrations: RollingUpdateMigration[];
  logs: string[];
  error: string | null;
  autoPatchEligible: boolean;
  autoPatchExecuted: boolean;
  patchExecutorAvailable: boolean;
};

type OverviewResponse = {
  ok?: boolean;
  error?: string;
  policy?: RollingUpdatePolicy;
  jobs?: RollingUpdateJob[];
  activeJob?: RollingUpdateJob | null;
  patchExecutorAvailable?: boolean;
};

type NodeRollingUpdatePanelProps = {
  live: boolean;
  node: string;
  canOperate: boolean;
  shellHref?: string | null;
};

type DialogAction = "start" | "migrate-back" | null;

function phaseLabel(phase: RollingUpdateJob["phase"]) {
  switch (phase) {
    case "refreshing-updates":
      return "Scan APT";
    case "planning-migrations":
      return "Plan migration";
    case "draining-node":
      return "Vidage nœud";
    case "awaiting-manual-patch":
      return "Patch manuel";
    case "auto-patching":
      return "Patch auto";
    case "migrating-back":
      return "Remigration";
    case "completed":
      return "Terminé";
    case "failed":
      return "Échec";
    case "cancelled":
      return "Annulé";
    default:
      return "En attente";
  }
}

function isActiveJob(job: RollingUpdateJob | null | undefined) {
  return job?.status === "queued" || job?.status === "running" || job?.status === "awaiting-manual";
}

export default function NodeRollingUpdatePanel({
  live,
  node,
  canOperate,
  shellHref = null,
}: NodeRollingUpdatePanelProps) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const disposedRef = useRef(false);

  const activeJob = overview?.activeJob ?? null;
  const lastJob = overview?.jobs?.[0] ?? null;
  const policy = overview?.policy ?? null;

  const refresh = useCallback(async () => {
    if (!live || !node) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/nodes/rolling-update?node=${encodeURIComponent(node)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as OverviewResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Impossible de lire le rolling update.");
      }
      if (!disposedRef.current) {
        setOverview(payload);
      }
    } catch (requestError) {
      if (!disposedRef.current) {
        setError(requestError instanceof Error ? requestError.message : "Erreur rolling update.");
      }
    } finally {
      if (!disposedRef.current) {
        setLoading(false);
      }
    }
  }, [live, node]);

  useEffect(() => {
    disposedRef.current = false;
    void refresh();
    return () => {
      disposedRef.current = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!isActiveJob(activeJob)) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 4_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeJob, refresh]);

  async function postAction(body: Record<string, unknown>) {
    setBusy(String(body.action ?? ""));
    setError("");
    try {
      const response = await fetch("/api/nodes/rolling-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as OverviewResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Action rolling update impossible.");
      }
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Erreur rolling update.");
    } finally {
      setBusy("");
    }
  }

  const expectedText = useMemo(() => {
    if (dialogAction === "start") return `ROLLING UPDATE ${node}`;
    if (dialogAction === "migrate-back") return `REMIGRATE ${node}`;
    return "";
  }, [dialogAction, node]);

  const canStart = live && canOperate && !busy && !isActiveJob(activeJob);
  const canCancel = live && canOperate && !busy && Boolean(activeJob) && activeJob?.status !== "awaiting-manual";
  const canMigrateBack =
    live &&
    canOperate &&
    !busy &&
    activeJob?.status === "awaiting-manual" &&
    Boolean(activeJob?.migrations.some((migration) => migration.status === "completed"));

  return (
    <>
      <section className="inventory-update-panel" aria-live="polite">
        <div className="inventory-update-head">
          <div className="inventory-update-title">
            <span className="muted">Rolling update</span>
            <strong>Nœud par nœud</strong>
          </div>
          <div className="inventory-update-actions">
            <button type="button" className="inventory-ghost-btn" onClick={() => void refresh()} disabled={!live || loading}>
              {loading ? "Refresh..." : "Rafraîchir"}
            </button>
            {canStart ? (
              <button type="button" className="inventory-primary-btn" onClick={() => setDialogAction("start")}>
                Lancer rolling update
              </button>
            ) : null}
          </div>
        </div>

        <div className={`inventory-update-card tone-${error ? "error" : activeJob?.status === "failed" ? "error" : activeJob ? "warn" : "neutral"}`}>
          <div className="inventory-update-card-head">
            <strong>
              {!live
                ? "Connexion Proxmox requise"
                : error
                  ? "Rolling update indisponible"
                  : activeJob
                    ? `Job actif • ${phaseLabel(activeJob.phase)}`
                    : "Aucun rolling update actif"}
            </strong>
            {lastJob ? (
              <span className={`inventory-update-count ${lastJob.status === "completed" ? "ok" : "warn"}`}>
                {lastJob.status}
              </span>
            ) : null}
          </div>
          <p className="muted">
            {!live
              ? "Configure la connexion Proxmox pour orchestrer le vidage d’un nœud avant patch."
              : error ||
                (activeJob
                  ? activeJob.phase === "awaiting-manual-patch"
                    ? "Le nœud est vidé. Applique les mises à jour manuellement, puis remigre."
                    : "Les workloads sont migrés séquentiellement avant patch."
                  : "Détection et orchestration uniquement. Les mises à jour restent manuelles." )}
          </p>

          <div className="inventory-update-meta">
            <span>Application auto: désactivée</span>
            <span>Détection sécurité sans reboot: {policy?.autoSecurityNoReboot ? "Oui" : "Non"}</span>
            {policy?.updatedAt ? <span>Politique: {formatRelativeTime(policy.updatedAt)}</span> : null}
          </div>
        </div>

        <div className="settings-block">
          <div className="row-line">
            <span>Politique nœud</span>
            <strong>{policy?.autoSecurityNoReboot ? "Détection sécurité sans reboot" : "Détection standard"}</strong>
          </div>
          <p className="warning-text">
            Aucun patch n’est appliqué automatiquement. ProxmoxCenter détecte, vide le nœud si demandé, puis te laisse valider et lancer les MAJ manuellement via le shell.
          </p>
          {activeJob?.updates?.counts ? (
            <div className="inventory-update-meta">
              <span>Paquets: {activeJob.updates.counts.total}</span>
              <span>Sécurité: {activeJob.updates.counts.security}</span>
              <span>Sans reboot: {activeJob.updates.counts.autoHotSafe}</span>
              <span>Reboot: {activeJob.updates.counts.rebootRisk}</span>
            </div>
          ) : null}
          <div className="inventory-update-actions">
            {shellHref && activeJob?.status === "awaiting-manual" ? (
              <a href={shellHref} className="inventory-ghost-btn">
                Ouvrir shell nœud
              </a>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="inventory-ghost-btn"
                disabled={busy === "cancel"}
                onClick={() => {
                  if (!activeJob) return;
                  void postAction({ action: "cancel", jobId: activeJob.id });
                }}
              >
                {busy === "cancel" ? "Annulation..." : "Annuler"}
              </button>
            ) : null}
            {canMigrateBack ? (
              <button type="button" className="inventory-primary-btn" onClick={() => setDialogAction("migrate-back")}>
                Remigrer après patch
              </button>
            ) : null}
          </div>
        </div>

        {activeJob?.migrations?.length ? (
          <div className="mini-list">
            {activeJob.migrations.map((migration) => (
              <article key={`${migration.kind}-${migration.vmid}`} className="mini-list-item">
                <div>
                  <div className="item-title">
                    {migration.name} <span className="muted">#{migration.vmid}</span>
                    {migration.downtimeRisk ? <span className="inventory-badge status-pending">CT coupure courte</span> : null}
                  </div>
                  <div className="item-subtitle">
                    {migration.sourceNode} → {migration.targetNode}
                  </div>
                  {migration.error ? <div className="item-subtitle status-bad">{migration.error}</div> : null}
                  {migration.returnError ? <div className="item-subtitle status-bad">{migration.returnError}</div> : null}
                </div>
                <div className="item-metric">
                  {migration.returnStatus !== "pending" ? `${migration.status} / retour ${migration.returnStatus}` : migration.status}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {activeJob?.logs?.length ? (
          <div className="inventory-update-log">
            {activeJob.logs.slice(-8).map((line) => (
              <code key={line}>{line}</code>
            ))}
          </div>
        ) : null}
      </section>

      <StrongConfirmDialog
        key={dialogAction ? `${dialogAction}-${node}` : `rolling-closed-${node}`}
        open={Boolean(dialogAction)}
        title={dialogAction === "migrate-back" ? "Confirmer la remigration" : "Confirmer le rolling update"}
        message={
          dialogAction === "migrate-back"
            ? `Après patch sur ${node}, les workloads seront remigrés vers ce nœud.`
            : `Le nœud ${node} sera vidé workload par workload avant patch.`
        }
        expectedText={expectedText}
        confirmLabel={dialogAction === "migrate-back" ? "Remigrer" : "Lancer"}
        busy={Boolean(dialogAction && busy === dialogAction)}
        onCancel={() => setDialogAction(null)}
        onConfirm={(confirmationText) => {
          const action = dialogAction;
          setDialogAction(null);
          if (action === "start") {
            void postAction({ action: "start", node, confirmationText });
            return;
          }
          if (action === "migrate-back" && activeJob) {
            void postAction({ action: "migrate-back", node, jobId: activeJob.id, confirmationText });
          }
        }}
      />
    </>
  );
}
