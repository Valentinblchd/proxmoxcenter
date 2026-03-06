import "server-only";
import { randomUUID } from "node:crypto";
import { encryptUploadPayloadIfNeeded } from "@/lib/backups/cloud-encryption";
import { uploadBackupObjectToCloud } from "@/lib/backups/cloud-providers";
import { getLastScheduledRun } from "@/lib/backups/plan-policy";
import { cancelProxmoxTask, startVzdumpJob, waitForTaskResult, findLatestBackupVolume, downloadBackupVolume } from "@/lib/backups/proxmox-runner";
import { readRuntimeBackupConfig, type RuntimeBackupCloudTarget, type RuntimeBackupPlan } from "@/lib/backups/runtime-config";
import {
  readRuntimeBackupState,
  type BackupExecution,
  type BackupExecutionStep,
  type BackupExecutionStatus,
  writeRuntimeBackupState,
} from "@/lib/backups/runtime-state";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

type BackupEngineStatus = {
  started: boolean;
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
};

type BackupEngineGlobal = {
  started: boolean;
  running: boolean;
  intervalMs: number;
  timer: NodeJS.Timeout | null;
  lastTickAt: string | null;
  lastError: string | null;
  currentExecutionId: string | null;
  currentTask: { node: string; upid: string } | null;
  currentUploadAbort: AbortController | null;
};

const BACKUP_ENGINE_GLOBAL_KEY = "__proxcenter_backup_engine__";
const DEFAULT_INTERVAL_MS = 60_000;
const SYNC_RETRY_MAX_ATTEMPTS = 3;

function getGlobalState(): BackupEngineGlobal {
  const globalRef = globalThis as typeof globalThis & {
    [BACKUP_ENGINE_GLOBAL_KEY]?: BackupEngineGlobal;
  };

  if (!globalRef[BACKUP_ENGINE_GLOBAL_KEY]) {
    globalRef[BACKUP_ENGINE_GLOBAL_KEY] = {
      started: false,
      running: false,
      intervalMs: DEFAULT_INTERVAL_MS,
      timer: null,
      lastTickAt: null,
      lastError: null,
      currentExecutionId: null,
      currentTask: null,
      currentUploadAbort: null,
    };
  }

  return globalRef[BACKUP_ENGINE_GLOBAL_KEY];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCursor(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function shouldRunPlan(plan: RuntimeBackupPlan, cursorIso: string | undefined, now: Date) {
  if (!plan.enabled) return { due: false, slot: null as Date | null };
  const lastSlot = getLastScheduledRun(
    {
      recurrenceEvery: plan.recurrenceEvery,
      recurrenceUnit: plan.recurrenceUnit,
      preferredTime: plan.preferredTime,
    },
    now,
  );
  const cursor = parseCursor(cursorIso);
  if (!cursor) return { due: true, slot: lastSlot };
  return {
    due: lastSlot.getTime() > cursor.getTime(),
    slot: lastSlot,
  };
}

function selectWorkloadsForPlan(
  plan: RuntimeBackupPlan,
  workloads: Awaited<ReturnType<typeof getDashboardSnapshot>>["workloads"],
) {
  const byKind = workloads.filter((workload) => plan.includeKinds.includes(workload.kind));
  if (plan.scope === "all") {
    return byKind;
  }
  const selected = new Set(plan.workloadIds);
  return byKind.filter((workload) => selected.has(`${workload.kind}/${workload.vmid}`));
}

function computeExecutionStatus(steps: BackupExecutionStep[]): BackupExecutionStatus {
  if (steps.length === 0) return "failed";
  if (steps.every((step) => step.status === "cancelled")) return "cancelled";
  const successCount = steps.filter((step) => step.status === "success").length;
  const failCount = steps.filter((step) => step.status === "failed").length;
  const cancelledCount = steps.filter((step) => step.status === "cancelled").length;
  if (successCount === steps.length) return "success";
  if (successCount > 0 && (failCount > 0 || cancelledCount > 0)) return "partial";
  if (cancelledCount > 0 && failCount === 0 && successCount === 0) return "cancelled";
  if (cancelledCount > 0) return "partial";
  return failCount > 0 ? "failed" : "running";
}

function appendExecution(execution: BackupExecution) {
  const state = readRuntimeBackupState();
  state.executions = [execution, ...state.executions]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 240);
  state.updatedAt = new Date().toISOString();
  writeRuntimeBackupState(state);
}

function updateExecution(executionId: string, mutator: (execution: BackupExecution) => BackupExecution) {
  const state = readRuntimeBackupState();
  state.executions = state.executions.map((item) => {
    if (item.id !== executionId) return item;
    return mutator(item);
  });
  state.updatedAt = new Date().toISOString();
  writeRuntimeBackupState(state);
}

function updatePlanCursor(planId: string, slotIso: string) {
  const state = readRuntimeBackupState();
  state.planCursors = {
    ...state.planCursors,
    [planId]: slotIso,
  };
  state.updatedAt = new Date().toISOString();
  writeRuntimeBackupState(state);
}

function getExecution(executionId: string) {
  return readRuntimeBackupState().executions.find((item) => item.id === executionId) ?? null;
}

function isExecutionCancellationRequested(executionId: string) {
  return getExecution(executionId)?.cancelRequested === true;
}

export async function requestBackupExecutionCancellation(executionId: string) {
  const existing = getExecution(executionId);
  if (!existing) {
    return null;
  }
  if (existing.status !== "queued" && existing.status !== "running") {
    return existing;
  }

  updateExecution(executionId, (execution) => ({
    ...execution,
    cancelRequested: true,
    summary:
      execution.summary && /annulation/i.test(execution.summary)
        ? execution.summary
        : "Annulation demandée.",
  }));

  const globalState = getGlobalState();
  if (globalState.currentExecutionId === executionId) {
    if (globalState.currentUploadAbort) {
      globalState.currentUploadAbort.abort();
    }
    if (globalState.currentTask) {
      await cancelProxmoxTask(globalState.currentTask).catch(() => undefined);
    }
  }

  return getExecution(executionId);
}

class BackupExecutionCancelledError extends Error {
  constructor(message = "Exécution backup annulée.") {
    super(message);
    this.name = "BackupExecutionCancelledError";
  }
}

function assertExecutionNotCancelled(executionId: string) {
  if (isExecutionCancellationRequested(executionId)) {
    throw new BackupExecutionCancelledError();
  }
}

function markExecutionCancelled(executionId: string, message = "Exécution annulée.") {
  updateExecution(executionId, (execution) => ({
    ...execution,
    cancelRequested: true,
    status: computeExecutionStatus(
      execution.steps.map((step) =>
        step.status === "running" || step.status === "queued"
          ? {
              ...step,
              status: "cancelled",
              endedAt: step.endedAt ?? new Date().toISOString(),
              error: step.error ?? message,
              sync:
                step.sync.status === "running" || step.sync.status === "pending"
                  ? {
                      ...step.sync,
                      status: "cancelled",
                      error: step.sync.error ?? message,
                      endedAt: new Date().toISOString(),
                    }
                  : step.sync,
            }
          : step,
      ),
    ),
    endedAt: execution.endedAt ?? new Date().toISOString(),
    summary: message,
    steps: execution.steps.map((step) =>
      step.status === "running" || step.status === "queued"
        ? {
            ...step,
            status: "cancelled",
            endedAt: step.endedAt ?? new Date().toISOString(),
            error: step.error ?? message,
            sync:
              step.sync.status === "running" || step.sync.status === "pending"
                ? {
                    ...step.sync,
                    status: "cancelled",
                    error: step.sync.error ?? message,
                    endedAt: new Date().toISOString(),
                  }
                : step.sync,
          }
        : step,
    ),
  }));
}

function clearCurrentExecution(executionId: string) {
  const globalState = getGlobalState();
  if (globalState.currentExecutionId !== executionId) {
    return;
  }
  globalState.currentExecutionId = null;
  globalState.currentTask = null;
  globalState.currentUploadAbort = null;
}

async function retryCloudSync(
  target: RuntimeBackupCloudTarget,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
  options?: {
    signal?: AbortSignal;
    shouldCancel?: () => boolean;
  },
) {
  const payload = encryptUploadPayloadIfNeeded(target, {
    filename,
    bytes,
    contentType,
  });
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= SYNC_RETRY_MAX_ATTEMPTS; attempt += 1) {
    if (options?.shouldCancel?.()) {
      throw new BackupExecutionCancelledError();
    }
    try {
      const result = await uploadBackupObjectToCloud(target, {
        filename: payload.filename,
        bytes: payload.bytes,
        contentType: payload.contentType,
        signal: options?.signal,
      });
      return {
        success: true,
        attempts: attempt,
        objectKey: result.objectKey,
        error: null,
      };
    } catch (error) {
      if (options?.shouldCancel?.() || (error instanceof Error && error.name === "AbortError")) {
        throw new BackupExecutionCancelledError();
      }
      lastError = error instanceof Error ? error.message : "Erreur upload cloud";
      if (attempt < SYNC_RETRY_MAX_ATTEMPTS) {
        await sleep(1000 * attempt * 2);
      }
    }
  }

  return {
    success: false,
    attempts: SYNC_RETRY_MAX_ATTEMPTS,
    objectKey: null,
    error: lastError,
  };
}

async function executePlan(plan: RuntimeBackupPlan, slotAt: Date) {
  const snapshot = await getDashboardSnapshot();
  const nowIso = new Date().toISOString();
  const executionId = randomUUID();
  const selectedWorkloads = selectWorkloadsForPlan(plan, snapshot.workloads);

  const baseExecution: BackupExecution = {
    id: executionId,
    planId: plan.id,
    planName: plan.name,
    scheduledAt: slotAt.toISOString(),
    startedAt: nowIso,
    endedAt: null,
    status: "running",
    cancelRequested: false,
    summary: null,
    steps: [],
  };
  appendExecution(baseExecution);
  const globalState = getGlobalState();
  globalState.currentExecutionId = executionId;
  globalState.currentTask = null;
  globalState.currentUploadAbort = null;

  try {
    if (snapshot.mode !== "live") {
      updateExecution(executionId, (execution) => ({
        ...execution,
        status: "failed",
        endedAt: new Date().toISOString(),
        summary: snapshot.warnings[0] ?? "Snapshot Proxmox indisponible. Exécution annulée.",
      }));
      return;
    }

    if (selectedWorkloads.length === 0) {
      updateExecution(executionId, (execution) => ({
        ...execution,
        status: "failed",
        endedAt: new Date().toISOString(),
        summary: "Aucune VM/CT correspondante pour ce plan.",
      }));
      return;
    }

    const cloudTarget =
      plan.targetMode === "cloud" && plan.cloudTargetId
        ? readRuntimeBackupConfig().cloudTargets.find((target) => target.id === plan.cloudTargetId) ?? null
        : null;

    for (const workload of selectedWorkloads) {
      if (isExecutionCancellationRequested(executionId)) {
        markExecutionCancelled(executionId);
        return;
      }
      const stepStartIso = new Date().toISOString();
      const stepBase: BackupExecutionStep = {
        workloadId: `${workload.kind}/${workload.vmid}`,
        node: workload.node,
        kind: workload.kind,
        vmid: workload.vmid,
        status: "running",
        upid: null,
        backupStorage: plan.backupStorage ?? null,
        backupVolid: null,
        error: null,
        startedAt: stepStartIso,
        endedAt: null,
        sync: {
          status: plan.targetMode === "cloud" ? "pending" : "skipped",
          provider: cloudTarget?.provider ?? null,
          targetId: cloudTarget?.id ?? null,
          attempts: 0,
          uploadedObject: null,
          error: null,
          startedAt: null,
          endedAt: null,
        },
      };

      updateExecution(executionId, (execution) => ({
        ...execution,
        steps: [...execution.steps, stepBase],
      }));

      try {
        assertExecutionNotCancelled(executionId);
        const upid = await startVzdumpJob({
          node: workload.node,
          vmid: workload.vmid,
          mode: "snapshot",
          storage: plan.backupStorage,
        });

        updateExecution(executionId, (execution) => ({
          ...execution,
          steps: execution.steps.map((step) =>
            step.workloadId === stepBase.workloadId
              ? {
                  ...step,
                  upid,
                }
              : step,
          ),
        }));
        globalState.currentTask = {
          node: workload.node,
          upid,
        };

        const taskResult = await waitForTaskResult({
          node: workload.node,
          upid,
          timeoutMs: 60 * 60_000,
          shouldCancel: () => isExecutionCancellationRequested(executionId),
        });
        globalState.currentTask = null;

        if (taskResult.cancelled) {
          updateExecution(executionId, (execution) => ({
            ...execution,
            steps: execution.steps.map((step) =>
              step.workloadId === stepBase.workloadId
                ? {
                    ...step,
                    status: "cancelled",
                    error: "Backup Proxmox annulé.",
                    endedAt: new Date().toISOString(),
                  }
                : step,
            ),
          }));
          markExecutionCancelled(executionId);
          return;
        }

        if (!taskResult.done || !taskResult.success) {
          updateExecution(executionId, (execution) => ({
            ...execution,
            steps: execution.steps.map((step) =>
              step.workloadId === stepBase.workloadId
                ? {
                    ...step,
                    status: "failed",
                    error: `Backup Proxmox échoué: ${taskResult.exitStatus}`,
                    endedAt: new Date().toISOString(),
                  }
                : step,
            ),
          }));
          continue;
        }

        let syncStatus = "skipped" as BackupExecutionStep["sync"]["status"];
        let syncAttempts = 0;
        let syncObjectKey: string | null = null;
        let syncError: string | null = null;
        let backupStorage: string | null = plan.backupStorage ?? null;
        let backupVolid: string | null = null;

        if (plan.targetMode === "cloud") {
          if (!cloudTarget) {
            syncStatus = "failed";
            syncError = "Cible cloud introuvable.";
          } else {
            const latest = await findLatestBackupVolume({
              node: workload.node,
              vmid: workload.vmid,
              kind: workload.kind,
              preferredStorage: plan.backupStorage,
            });

            if (!latest) {
              syncStatus = "failed";
              syncError = "Backup créé mais volume non localisé dans les stockages API.";
            } else {
              backupStorage = latest.storage;
              backupVolid = latest.volid;
              try {
                assertExecutionNotCancelled(executionId);
                const downloaded = await downloadBackupVolume({
                  node: workload.node,
                  storage: latest.storage,
                  volid: latest.volid,
                  filename: latest.filename,
                });
                assertExecutionNotCancelled(executionId);
                const controller = new AbortController();
                globalState.currentUploadAbort = controller;
                const upload = await retryCloudSync(
                  cloudTarget,
                  latest.filename,
                  downloaded.bytes,
                  downloaded.contentType,
                  {
                    signal: controller.signal,
                    shouldCancel: () => isExecutionCancellationRequested(executionId),
                  },
                );
                globalState.currentUploadAbort = null;
                syncStatus = upload.success ? "success" : "failed";
                syncAttempts = upload.attempts;
                syncObjectKey = upload.objectKey;
                syncError = upload.error;
              } catch (error) {
                globalState.currentUploadAbort = null;
                if (error instanceof BackupExecutionCancelledError) {
                  syncStatus = "cancelled";
                  syncError = error.message;
                  updateExecution(executionId, (execution) => ({
                    ...execution,
                    steps: execution.steps.map((step) =>
                      step.workloadId === stepBase.workloadId
                        ? {
                            ...step,
                            status: "cancelled",
                            endedAt: new Date().toISOString(),
                            error: error.message,
                            sync: {
                              ...step.sync,
                              status: "cancelled",
                              attempts: syncAttempts,
                              error: error.message,
                              startedAt: step.startedAt,
                              endedAt: new Date().toISOString(),
                            },
                          }
                        : step,
                    ),
                  }));
                  markExecutionCancelled(executionId);
                  return;
                }
                syncStatus = "failed";
                syncError = error instanceof Error ? error.message : "Erreur de sync cloud.";
              }
            }
          }
        }

        const stepStatus: BackupExecutionStatus =
          plan.targetMode === "cloud"
            ? syncStatus === "success"
              ? "success"
              : syncStatus === "cancelled"
                ? "cancelled"
                : "failed"
            : "success";

        updateExecution(executionId, (execution) => ({
          ...execution,
          steps: execution.steps.map((step) =>
            step.workloadId === stepBase.workloadId
              ? {
                  ...step,
                  status: stepStatus,
                  backupStorage,
                  backupVolid,
                  endedAt: new Date().toISOString(),
                  error: syncError,
                  sync: {
                    ...step.sync,
                    status: syncStatus,
                    attempts: syncAttempts,
                    uploadedObject: syncObjectKey,
                    error: syncError,
                    startedAt: plan.targetMode === "cloud" ? step.startedAt : null,
                    endedAt: plan.targetMode === "cloud" ? new Date().toISOString() : null,
                  },
                }
              : step,
          ),
        }));
      } catch (error) {
        if (error instanceof BackupExecutionCancelledError) {
          updateExecution(executionId, (execution) => ({
            ...execution,
            steps: execution.steps.map((step) =>
              step.workloadId === stepBase.workloadId
                ? {
                    ...step,
                    status: "cancelled",
                    error: error.message,
                    endedAt: new Date().toISOString(),
                    sync:
                      step.sync.status === "running" || step.sync.status === "pending"
                        ? {
                            ...step.sync,
                            status: "cancelled",
                            error: error.message,
                            endedAt: new Date().toISOString(),
                          }
                        : step.sync,
                  }
                : step,
            ),
          }));
          markExecutionCancelled(executionId);
          return;
        }
        updateExecution(executionId, (execution) => ({
          ...execution,
          steps: execution.steps.map((step) =>
            step.workloadId === stepBase.workloadId
              ? {
                  ...step,
                  status: "failed",
                  error: error instanceof Error ? error.message : "Erreur backup inattendue.",
                  endedAt: new Date().toISOString(),
                }
              : step,
          ),
        }));
      }
    }

    updateExecution(executionId, (execution) => {
      const finalStatus = computeExecutionStatus(execution.steps);
      const successCount = execution.steps.filter((step) => step.status === "success").length;
      const failCount = execution.steps.filter((step) => step.status === "failed").length;
      const cancelledCount = execution.steps.filter((step) => step.status === "cancelled").length;
      return {
        ...execution,
        status: finalStatus,
        endedAt: new Date().toISOString(),
        summary:
          finalStatus === "cancelled"
            ? "Exécution annulée."
            : `Terminé: ${successCount} succès / ${failCount} échec(s)${cancelledCount > 0 ? ` / ${cancelledCount} annulé(s)` : ""}.`,
      };
    });
  } finally {
    clearCurrentExecution(executionId);
  }
}

export async function runBackupEngineTick(trigger = "auto") {
  const globalState = getGlobalState();
  if (globalState.running) return;

  globalState.running = true;
  globalState.lastError = null;
  globalState.lastTickAt = new Date().toISOString();

  try {
    const now = new Date();
    const config = readRuntimeBackupConfig();
    const state = readRuntimeBackupState();
    const activePlans = config.plans.filter((plan) => plan.enabled);

    for (const plan of activePlans) {
      const decision = shouldRunPlan(plan, state.planCursors[plan.id], now);
      if (!decision.due || !decision.slot) continue;

      updatePlanCursor(plan.id, decision.slot.toISOString());
      await executePlan(plan, decision.slot);
    }
  } catch (error) {
    globalState.lastError = error instanceof Error ? error.message : `Tick failure (${trigger})`;
  } finally {
    globalState.running = false;
    globalState.currentExecutionId = null;
    globalState.currentTask = null;
    globalState.currentUploadAbort = null;
  }
}

export async function runBackupPlanNow(planId: string) {
  const globalState = getGlobalState();
  if (globalState.running) {
    throw new Error("Un run backup est déjà en cours.");
  }
  const config = readRuntimeBackupConfig();
  const plan = config.plans.find((item) => item.id === planId && item.enabled) ?? null;
  if (!plan) {
    throw new Error("Plan backup introuvable ou inactif.");
  }
  globalState.running = true;
  globalState.lastError = null;
  globalState.lastTickAt = new Date().toISOString();
  try {
    const slotAt = new Date();
    updatePlanCursor(plan.id, slotAt.toISOString());
    await executePlan(plan, slotAt);
  } catch (error) {
    globalState.lastError = error instanceof Error ? error.message : "Run manuel échoué";
    throw error;
  } finally {
    globalState.running = false;
    globalState.currentExecutionId = null;
    globalState.currentTask = null;
    globalState.currentUploadAbort = null;
  }
}

export function ensureBackupEngineStarted() {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const globalState = getGlobalState();
  if (globalState.started) return;

  globalState.started = true;
  globalState.timer = setInterval(() => {
    void runBackupEngineTick("interval");
  }, globalState.intervalMs);

  // First immediate pass after boot.
  void runBackupEngineTick("startup");
}

export function getBackupEngineStatus(): BackupEngineStatus {
  const state = getGlobalState();
  return {
    started: state.started,
    running: state.running,
    intervalMs: state.intervalMs,
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
  };
}
