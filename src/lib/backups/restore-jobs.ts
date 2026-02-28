import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { downloadBackupObjectFromCloud } from "@/lib/backups/cloud-providers";
import { decryptUploadPayloadIfNeeded } from "@/lib/backups/cloud-encryption";
import { stageRestorePayload } from "@/lib/backups/restore-staging";
import { type RuntimeBackupCloudTarget } from "@/lib/backups/runtime-config";
import { requireRuntimePbsConfig, uploadArchiveToPbsDirect, PbsCommandCancelledError } from "@/lib/pbs/tooling";
import { proxmoxRawRequest, proxmoxRequest } from "@/lib/proxmox/client";

export type RestoreDestinationMode = "proxmox" | "pbs";
export type RestoreJobState = "running" | "success" | "failed" | "cancelled";
export type RestoreJobPhase =
  | "queued"
  | "preparing-cloud-object"
  | "decrypting"
  | "staging"
  | "importing-to-storage"
  | "restoring-workload"
  | "completed"
  | "cancelled"
  | "failed";

export type RestoreTaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export type RestoreTaskProgress = {
  upid: string | null;
  node: string | null;
  status: RestoreTaskStatus;
  exitStatus: string | null;
  progressPercent: number | null;
  currentLine: string | null;
  lines: string[];
  startedAt: string | null;
  endedAt: string | null;
};

export type RestoreJob = {
  id: string;
  state: RestoreJobState;
  phase: RestoreJobPhase;
  cancelRequested: boolean;
  cancelledAt: string | null;
  destination: RestoreDestinationMode;
  targetId: string;
  targetName: string;
  targetProvider: RuntimeBackupCloudTarget["provider"];
  objectKey: string;
  objectName: string | null;
  node: string;
  kind: "qemu" | "lxc" | null;
  vmid: number | null;
  backupStorage: string;
  restoreStorage: string | null;
  force: boolean;
  filename: string | null;
  stagedBackupVolid: string | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  importTask: RestoreTaskProgress;
  restoreTask: RestoreTaskProgress;
};

type RestoreJobsFile = {
  updatedAt?: unknown;
  jobs?: unknown;
};

type ProxmoxTaskStatusPayload = {
  status?: string;
  exitstatus?: string;
};

type ProxmoxTaskLogEntry = {
  t?: string;
};

class RestoreCancelledError extends Error {
  constructor(message = "Job de restauration annulé.") {
    super(message);
    this.name = "RestoreCancelledError";
  }
}

function asNonEmptyString(value: unknown, maxLength = 1000) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function asRestoreTaskStatus(value: unknown): RestoreTaskStatus {
  const raw = asNonEmptyString(value, 20);
  if (
    raw === "pending" ||
    raw === "running" ||
    raw === "success" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "pending";
}

function asRestorePhase(value: unknown): RestoreJobPhase {
  const raw = asNonEmptyString(value, 40);
  switch (raw) {
    case "queued":
    case "preparing-cloud-object":
    case "decrypting":
    case "staging":
    case "importing-to-storage":
    case "restoring-workload":
    case "completed":
    case "cancelled":
    case "failed":
      return raw;
    default:
      return "queued";
  }
}

function normalizeTask(input: unknown): RestoreTaskProgress {
  const now = new Date().toISOString();
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const lines = Array.isArray(source.lines)
    ? source.lines.map((item) => asNonEmptyString(item, 500)).filter((item): item is string => Boolean(item)).slice(-12)
    : [];

  return {
    upid: asNonEmptyString(source.upid, 400),
    node: asNonEmptyString(source.node, 120),
    status: asRestoreTaskStatus(source.status),
    exitStatus: asNonEmptyString(source.exitStatus, 120),
    progressPercent:
      typeof source.progressPercent === "number" && Number.isFinite(source.progressPercent)
        ? Math.max(0, Math.min(source.progressPercent, 100))
        : null,
    currentLine: asNonEmptyString(source.currentLine, 500),
    lines,
    startedAt: source.startedAt ? asIsoDate(source.startedAt, now) : null,
    endedAt: source.endedAt ? asIsoDate(source.endedAt, now) : null,
  };
}

function normalizeJob(input: unknown): RestoreJob | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = asNonEmptyString(source.id, 120);
  const destination = source.destination === "pbs" ? "pbs" : source.destination === "proxmox" ? "proxmox" : null;
  const state =
    source.state === "success"
      ? "success"
      : source.state === "failed"
        ? "failed"
        : source.state === "cancelled"
          ? "cancelled"
          : source.state === "running"
            ? "running"
            : null;
  const node = asNonEmptyString(source.node, 120);
  const targetId = asNonEmptyString(source.targetId, 120);
  const targetName = asNonEmptyString(source.targetName, 200);
  const targetProvider = source.targetProvider;
  const backupStorage = asNonEmptyString(source.backupStorage, 120);
  if (!id || !destination || !state || !node || !targetId || !targetName || !backupStorage) {
    return null;
  }
  if (
    targetProvider !== "onedrive" &&
    targetProvider !== "gdrive" &&
    targetProvider !== "aws-s3" &&
    targetProvider !== "azure-blob"
  ) {
    return null;
  }

  const vmidRaw =
    typeof source.vmid === "number"
      ? source.vmid
      : typeof source.vmid === "string"
        ? Number.parseInt(source.vmid, 10)
        : null;

  return {
    id,
    state,
    phase: asRestorePhase(source.phase),
    cancelRequested: source.cancelRequested === true,
    cancelledAt: source.cancelledAt ? asIsoDate(source.cancelledAt, now) : null,
    destination,
    targetId,
    targetName,
    targetProvider,
    objectKey: asNonEmptyString(source.objectKey, 1200) ?? "",
    objectName: asNonEmptyString(source.objectName, 400),
    node,
    kind: source.kind === "lxc" ? "lxc" : source.kind === "qemu" ? "qemu" : null,
    vmid: typeof vmidRaw === "number" && Number.isInteger(vmidRaw) && vmidRaw > 0 ? vmidRaw : null,
    backupStorage,
    restoreStorage: asNonEmptyString(source.restoreStorage, 120),
    force: source.force === true,
    filename: asNonEmptyString(source.filename, 400),
    stagedBackupVolid: asNonEmptyString(source.stagedBackupVolid, 400),
    message: asNonEmptyString(source.message, 1200),
    error: asNonEmptyString(source.error, 2000),
    startedAt: asIsoDate(source.startedAt, now),
    updatedAt: asIsoDate(source.updatedAt, now),
    finishedAt: source.finishedAt ? asIsoDate(source.finishedAt, now) : null,
    importTask: normalizeTask(source.importTask),
    restoreTask: normalizeTask(source.restoreTask),
  };
}

function getDefaultJobsPath() {
  return path.join(process.cwd(), "data", "backup-restore-jobs.json");
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJobsFile() {
  const filePath = getDefaultJobsPath();
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as RestoreJobsFile;
    const jobs = Array.isArray(parsed.jobs)
      ? parsed.jobs.map((item) => normalizeJob(item)).filter((item): item is RestoreJob => Boolean(item))
      : [];
    return {
      updatedAt: asIsoDate(parsed.updatedAt, new Date().toISOString()),
      jobs: jobs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      jobs: [] as RestoreJob[],
    };
  }
}

function writeJobsFile(jobs: RestoreJob[]) {
  const filePath = getDefaultJobsPath();
  ensureParentDirectory(filePath);
  const normalized = jobs
    .map((item) => normalizeJob(item))
    .filter((item): item is RestoreJob => Boolean(item))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        jobs: normalized,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function updateJobs(mutator: (jobs: RestoreJob[]) => RestoreJob[]) {
  const state = readJobsFile();
  const next = mutator(state.jobs);
  writeJobsFile(next);
  return next;
}

function createEmptyTask(): RestoreTaskProgress {
  return {
    upid: null,
    node: null,
    status: "pending",
    exitStatus: null,
    progressPercent: null,
    currentLine: null,
    lines: [],
    startedAt: null,
    endedAt: null,
  };
}

export function listRestoreJobs() {
  return readJobsFile().jobs;
}

export function getRestoreJob(jobId: string) {
  return readJobsFile().jobs.find((item) => item.id === jobId) ?? null;
}

export function createRestoreJob(input: {
  destination: RestoreDestinationMode;
  target: RuntimeBackupCloudTarget;
  objectKey: string;
  node: string;
  kind: "qemu" | "lxc" | null;
  vmid: number | null;
  backupStorage: string;
  restoreStorage: string | null;
  force: boolean;
}) {
  const now = new Date().toISOString();
  const job: RestoreJob = {
    id: randomUUID(),
    state: "running",
    phase: "queued",
    cancelRequested: false,
    cancelledAt: null,
    destination: input.destination,
    targetId: input.target.id,
    targetName: input.target.name,
    targetProvider: input.target.provider,
    objectKey: input.objectKey,
    objectName: null,
    node: input.node,
    kind: input.kind,
    vmid: input.vmid,
    backupStorage: input.backupStorage,
    restoreStorage: input.restoreStorage,
    force: input.force,
    filename: null,
    stagedBackupVolid: null,
    message: "Job de restauration préparé.",
    error: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    importTask: createEmptyTask(),
    restoreTask: createEmptyTask(),
  };

  updateJobs((jobs) => [job, ...jobs.filter((item) => item.id !== job.id)]);
  return job;
}

export function patchRestoreJob(jobId: string, patch: Partial<RestoreJob>) {
  updateJobs((jobs) =>
    jobs.map((item) =>
      item.id === jobId
        ? {
            ...item,
            ...patch,
            updatedAt: new Date().toISOString(),
          }
        : item,
    ),
  );
  return getRestoreJob(jobId);
}

export function updateRestoreTask(jobId: string, taskKey: "importTask" | "restoreTask", patch: Partial<RestoreTaskProgress>) {
  updateJobs((jobs) =>
    jobs.map((item) => {
      if (item.id !== jobId) return item;
      return {
        ...item,
        [taskKey]: {
          ...item[taskKey],
          ...patch,
        },
        updatedAt: new Date().toISOString(),
      };
    }),
  );
  return getRestoreJob(jobId);
}

export function requestRestoreJobCancellation(jobId: string) {
  const current = getRestoreJob(jobId);
  if (!current) return null;
  if (current.state !== "running") return current;
  return patchRestoreJob(jobId, {
    cancelRequested: true,
    message:
      current.message && /annulation demandée/i.test(current.message)
        ? current.message
        : "Annulation demandée.",
  });
}

function setRestoreFailure(jobId: string, error: string) {
  const now = new Date().toISOString();
  patchRestoreJob(jobId, {
    state: "failed",
    phase: "failed",
    error,
    message: error,
    finishedAt: now,
  });
}

function setRestoreCancelled(jobId: string, message = "Job de restauration annulé.") {
  const now = new Date().toISOString();
  const current = getRestoreJob(jobId);
  if (!current) return;

  patchRestoreJob(jobId, {
    state: "cancelled",
    phase: "cancelled",
    cancelRequested: true,
    cancelledAt: now,
    error: null,
    message,
    finishedAt: now,
  });

  for (const taskKey of ["importTask", "restoreTask"] as const) {
    const task = current[taskKey];
    if (task.status === "success" || task.status === "failed" || task.status === "cancelled") {
      continue;
    }
    updateRestoreTask(jobId, taskKey, {
      status: "cancelled",
      currentLine: message,
      endedAt: now,
    });
  }
}

function extractProgressPercent(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = line.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
    if (!match) continue;
    const parsed = Number.parseFloat(match[1].replace(",", "."));
    if (!Number.isFinite(parsed)) continue;
    return Math.max(0, Math.min(Math.round(parsed), 100));
  }
  return null;
}

async function readTaskSnapshot(node: string, upid: string) {
  const [status, logs] = await Promise.all([
    proxmoxRequest<ProxmoxTaskStatusPayload>(
      `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    ),
    proxmoxRequest<ProxmoxTaskLogEntry[]>(
      `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log?start=0&limit=80`,
    ).catch(() => [] as ProxmoxTaskLogEntry[]),
  ]);

  const lines = (Array.isArray(logs) ? logs : [])
    .map((entry) => asNonEmptyString(entry?.t, 500))
    .filter((line): line is string => Boolean(line))
    .slice(-10);
  const done = status?.status === "stopped";
  const success = done && status?.exitstatus === "OK";

  return {
    done,
    success,
    exitStatus: asNonEmptyString(status?.exitstatus, 120),
    currentLine: lines.at(-1) ?? null,
    progressPercent: done ? 100 : extractProgressPercent(lines),
    lines,
  };
}

async function requestProxmoxTaskCancellation(node: string, upid: string) {
  const response = await proxmoxRawRequest(
    `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}`,
    { method: "DELETE" },
  );
  if (response.ok) return;

  const text = await response.text().catch(() => "");
  throw new Error(text || `Impossible d’annuler la tâche ${upid}.`);
}

function ensureJobNotCancelled(jobId: string) {
  const current = getRestoreJob(jobId);
  if (current?.cancelRequested) {
    throw new RestoreCancelledError();
  }
}

async function waitForTaskProgress(options: {
  jobId: string;
  taskKey: "importTask" | "restoreTask";
  node: string;
  upid: string;
  timeoutMs: number;
  fallbackMessage: string;
}): Promise<{
  done: boolean;
  success: boolean;
  cancelled: boolean;
  exitStatus: string | null;
  currentLine: string | null;
  progressPercent: number | null;
  lines: string[];
}> {
  const startedAt = new Date().toISOString();
  let cancellationSent = false;
  updateRestoreTask(options.jobId, options.taskKey, {
    node: options.node,
    upid: options.upid,
    status: "running",
    startedAt,
    endedAt: null,
  });

  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    const current = getRestoreJob(options.jobId);
    if (current?.cancelRequested && !cancellationSent) {
      cancellationSent = true;
      updateRestoreTask(options.jobId, options.taskKey, {
        currentLine: "Annulation demandée, arrêt de la tâche distant.",
      });
      try {
        await requestProxmoxTaskCancellation(options.node, options.upid);
      } catch (error) {
        updateRestoreTask(options.jobId, options.taskKey, {
          currentLine:
            error instanceof Error
              ? error.message
              : "Impossible d’envoyer la demande d’annulation.",
        });
      }
    }

    const snapshot = await readTaskSnapshot(options.node, options.upid);
    const cancelled = getRestoreJob(options.jobId)?.cancelRequested === true;
    updateRestoreTask(options.jobId, options.taskKey, {
      node: options.node,
      upid: options.upid,
      status: snapshot.done
        ? cancelled
          ? "cancelled"
          : snapshot.success
            ? "success"
            : "failed"
        : "running",
      exitStatus: snapshot.exitStatus,
      progressPercent: snapshot.progressPercent,
      currentLine:
        cancelled && snapshot.done
          ? "Job annulé."
          : snapshot.currentLine ?? options.fallbackMessage,
      lines: snapshot.lines,
      endedAt: snapshot.done ? new Date().toISOString() : null,
    });

    if (snapshot.done) {
      return {
        ...snapshot,
        cancelled,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (getRestoreJob(options.jobId)?.cancelRequested) {
    updateRestoreTask(options.jobId, options.taskKey, {
      status: "cancelled",
      currentLine: "Job annulé.",
      endedAt: new Date().toISOString(),
    });
    return {
      done: true,
      success: false,
      cancelled: true,
      exitStatus: "cancelled",
      currentLine: "Job annulé.",
      progressPercent: null,
      lines: ["Job annulé."],
    };
  }

  updateRestoreTask(options.jobId, options.taskKey, {
    status: "failed",
    exitStatus: "timeout",
    currentLine: "Timeout de la tâche.",
    endedAt: new Date().toISOString(),
  });
  return {
    done: true,
    success: false,
    cancelled: false,
    exitStatus: "timeout",
    currentLine: "Timeout de la tâche.",
    progressPercent: null,
    lines: ["Timeout de la tâche."],
  };
}

export function startRestoreJobRunner(options: {
  jobId: string;
  target: RuntimeBackupCloudTarget;
  objectKey: string;
  origin: string;
}) {
  void runRestoreJob(options).catch((error) => {
    if (error instanceof RestoreCancelledError || error instanceof PbsCommandCancelledError) {
      setRestoreCancelled(options.jobId);
      return;
    }
    setRestoreFailure(
      options.jobId,
      error instanceof Error ? error.message : "Erreur de restauration cloud.",
    );
  });
}

async function runRestoreJob(options: {
  jobId: string;
  target: RuntimeBackupCloudTarget;
  objectKey: string;
  origin: string;
}) {
  const job = getRestoreJob(options.jobId);
  if (!job) {
    throw new Error("Job de restauration introuvable.");
  }

  patchRestoreJob(options.jobId, {
    phase: "preparing-cloud-object",
    message: "Téléchargement de l’objet cloud.",
  });

  const downloaded = await downloadBackupObjectFromCloud(options.target, options.objectKey);
  ensureJobNotCancelled(options.jobId);
  patchRestoreJob(options.jobId, {
    objectName: downloaded.filename,
    filename: downloaded.filename,
    message: `Objet cloud récupéré: ${downloaded.filename}`,
  });

  patchRestoreJob(options.jobId, {
    phase: "decrypting",
    message: "Vérification du chiffrement.",
  });
  const decrypted = decryptUploadPayloadIfNeeded(options.target, downloaded);
  ensureJobNotCancelled(options.jobId);

  if (job.destination === "pbs") {
    const pbsConfig = requireRuntimePbsConfig();
    patchRestoreJob(options.jobId, {
      phase: "importing-to-storage",
      message: `Import direct de ${decrypted.filename} vers PBS ${pbsConfig.datastore}.`,
    });

    updateRestoreTask(options.jobId, "importTask", {
      upid: "pbs-direct",
      node: pbsConfig.host,
      status: "running",
      currentLine: `Import PBS direct vers ${pbsConfig.datastore}.`,
      startedAt: new Date().toISOString(),
    });

    const pbsImport = await uploadArchiveToPbsDirect({
      config: pbsConfig,
      filename: decrypted.filename,
      bytes: decrypted.bytes,
      shouldCancel: () => getRestoreJob(options.jobId)?.cancelRequested === true,
      onLine: (line, lines) => {
        updateRestoreTask(options.jobId, "importTask", {
          node: pbsConfig.host,
          upid: "pbs-direct",
          status: "running",
          currentLine: line,
          lines: lines.slice(-10),
        });
      },
    });
    ensureJobNotCancelled(options.jobId);

    updateRestoreTask(options.jobId, "importTask", {
      node: pbsConfig.host,
      upid: "pbs-direct",
      status: "success",
      progressPercent: 100,
      currentLine: "Archive injectée dans PBS.",
      endedAt: new Date().toISOString(),
      lines: pbsImport.lines.slice(-10),
    });
    patchRestoreJob(options.jobId, {
      state: "success",
      phase: "completed",
      stagedBackupVolid: pbsImport.snapshot,
      message: `Archive importée directement dans PBS ${pbsConfig.datastore}.`,
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  patchRestoreJob(options.jobId, {
    phase: "staging",
    filename: decrypted.filename,
    message: "Préparation de l’archive pour Proxmox.",
  });
  const staged = stageRestorePayload({
    filename: decrypted.filename,
    contentType: decrypted.contentType,
    bytes: decrypted.bytes,
  });
  ensureJobNotCancelled(options.jobId);
  const downloadUrl = `${options.origin.replace(/\/+$/, "")}/api/backups/staged/${staged.token}`;

  patchRestoreJob(options.jobId, {
    phase: "importing-to-storage",
    message: `Import de ${decrypted.filename} vers ${job.backupStorage}.`,
  });

  const stageParams = new URLSearchParams();
  stageParams.set("content", "backup");
  stageParams.set("filename", decrypted.filename);
  stageParams.set("url", downloadUrl);

  const importUpid = await proxmoxRequest<string>(
    `nodes/${encodeURIComponent(job.node)}/storage/${encodeURIComponent(job.backupStorage)}/download-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: stageParams.toString(),
    },
  );

  updateRestoreTask(options.jobId, "importTask", {
    upid: importUpid,
    node: job.node,
    status: "running",
    currentLine: `Import lancé vers ${job.backupStorage}.`,
    startedAt: new Date().toISOString(),
  });

  const importTask = await waitForTaskProgress({
    jobId: options.jobId,
    taskKey: "importTask",
    node: job.node,
    upid: importUpid,
    timeoutMs: 60 * 60_000,
    fallbackMessage: "Import Proxmox en cours.",
  });

  if (importTask.cancelled) {
    throw new RestoreCancelledError();
  }
  if (!importTask.success) {
    throw new Error(`Import vers ${job.backupStorage} échoué: ${importTask.exitStatus ?? "unknown"}`);
  }

  const archiveVolid = `${job.backupStorage}:backup/${decrypted.filename}`;
  patchRestoreJob(options.jobId, {
    stagedBackupVolid: archiveVolid,
    message: `Archive importée vers ${job.backupStorage}, restauration Proxmox en cours.`,
  });
  ensureJobNotCancelled(options.jobId);

  if (!job.kind || !job.vmid) {
    throw new Error("Type de workload ou VMID manquant pour la restauration Proxmox.");
  }

  patchRestoreJob(options.jobId, {
    phase: "restoring-workload",
    message: `Restauration ${job.kind.toUpperCase()} #${job.vmid} en cours.`,
  });

  const restoreParams = new URLSearchParams();
  restoreParams.set("vmid", String(job.vmid));
  restoreParams.set("archive", archiveVolid);
  if (job.restoreStorage) {
    restoreParams.set("storage", job.restoreStorage);
  }
  if (job.force) {
    restoreParams.set("force", "1");
  }

  const restoreUpid = await proxmoxRequest<string>(
    `nodes/${encodeURIComponent(job.node)}/${job.kind}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: restoreParams.toString(),
    },
  );

  updateRestoreTask(options.jobId, "restoreTask", {
    upid: restoreUpid,
    node: job.node,
    status: "running",
    currentLine: `Restauration ${job.kind.toUpperCase()} lancée.`,
    startedAt: new Date().toISOString(),
  });

  const restoreTask = await waitForTaskProgress({
    jobId: options.jobId,
    taskKey: "restoreTask",
    node: job.node,
    upid: restoreUpid,
    timeoutMs: 60 * 60_000,
    fallbackMessage: "Restauration Proxmox en cours.",
  });

  if (restoreTask.cancelled) {
    throw new RestoreCancelledError();
  }
  if (!restoreTask.success) {
    throw new Error(`Restauration Proxmox échouée: ${restoreTask.exitStatus ?? "unknown"}`);
  }

  patchRestoreJob(options.jobId, {
    state: "success",
    phase: "completed",
    message: `Restauration ${job.kind.toUpperCase()} #${job.vmid} terminée.`,
    finishedAt: new Date().toISOString(),
  });
}
