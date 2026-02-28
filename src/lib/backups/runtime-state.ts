import "server-only";
import fs from "node:fs";
import path from "node:path";

export type BackupExecutionStatus = "queued" | "running" | "success" | "partial" | "failed" | "cancelled";
export type BackupSyncStatus = "pending" | "running" | "success" | "failed" | "skipped" | "cancelled";

export type BackupExecutionStep = {
  workloadId: string;
  node: string;
  kind: "qemu" | "lxc";
  vmid: number;
  status: BackupExecutionStatus;
  upid: string | null;
  backupStorage: string | null;
  backupVolid: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  sync: {
    status: BackupSyncStatus;
    provider: string | null;
    targetId: string | null;
    attempts: number;
    uploadedObject: string | null;
    error: string | null;
    startedAt: string | null;
    endedAt: string | null;
  };
};

export type BackupExecution = {
  id: string;
  planId: string;
  planName: string;
  scheduledAt: string;
  startedAt: string;
  endedAt: string | null;
  status: BackupExecutionStatus;
  cancelRequested: boolean;
  summary: string | null;
  steps: BackupExecutionStep[];
};

export type BackupRuntimeState = {
  updatedAt: string;
  planCursors: Record<string, string>;
  executions: BackupExecution[];
};

type BackupRuntimeStateFile = {
  updatedAt?: unknown;
  planCursors?: unknown;
  executions?: unknown;
};

const MAX_EXECUTIONS = 240;

function asNonEmptyString(value: unknown, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asDate(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function asOptionalDate(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function asExecutionStatus(value: unknown): BackupExecutionStatus {
  const raw = asNonEmptyString(value, 20);
  if (
    raw === "queued" ||
    raw === "running" ||
    raw === "success" ||
    raw === "partial" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "failed";
}

function asSyncStatus(value: unknown): BackupSyncStatus {
  const raw = asNonEmptyString(value, 20);
  if (
    raw === "pending" ||
    raw === "running" ||
    raw === "success" ||
    raw === "failed" ||
    raw === "skipped" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "pending";
}

function normalizeStep(input: unknown): BackupExecutionStep | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const now = new Date().toISOString();
  const workloadId = asNonEmptyString(source.workloadId, 120);
  const node = asNonEmptyString(source.node, 120);
  const kindRaw = asNonEmptyString(source.kind, 20);
  const vmid =
    typeof source.vmid === "number"
      ? source.vmid
      : typeof source.vmid === "string"
        ? Number.parseInt(source.vmid, 10)
        : NaN;

  if (!workloadId || !node || (kindRaw !== "qemu" && kindRaw !== "lxc") || !Number.isInteger(vmid)) {
    return null;
  }

  const syncSource =
    source.sync && typeof source.sync === "object"
      ? (source.sync as Record<string, unknown>)
      : {};

  return {
    workloadId,
    node,
    kind: kindRaw,
    vmid,
    status: asExecutionStatus(source.status),
    upid: asNonEmptyString(source.upid, 400),
    backupStorage: asNonEmptyString(source.backupStorage, 120),
    backupVolid: asNonEmptyString(source.backupVolid, 400),
    error: asNonEmptyString(source.error, 3000),
    startedAt: asDate(source.startedAt, now),
    endedAt: asOptionalDate(source.endedAt),
    sync: {
      status: asSyncStatus(syncSource.status),
      provider: asNonEmptyString(syncSource.provider, 60),
      targetId: asNonEmptyString(syncSource.targetId, 120),
      attempts:
        typeof syncSource.attempts === "number" && Number.isInteger(syncSource.attempts)
          ? Math.max(0, syncSource.attempts)
          : 0,
      uploadedObject: asNonEmptyString(syncSource.uploadedObject, 800),
      error: asNonEmptyString(syncSource.error, 3000),
      startedAt: asOptionalDate(syncSource.startedAt),
      endedAt: asOptionalDate(syncSource.endedAt),
    },
  };
}

function normalizeExecution(input: unknown): BackupExecution | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = asNonEmptyString(source.id, 120);
  const planId = asNonEmptyString(source.planId, 120);
  const planName = asNonEmptyString(source.planName, 180);
  if (!id || !planId || !planName) return null;

  const steps = Array.isArray(source.steps)
    ? source.steps.map((item) => normalizeStep(item)).filter((item): item is BackupExecutionStep => Boolean(item))
    : [];

  return {
    id,
    planId,
    planName,
    scheduledAt: asDate(source.scheduledAt, now),
    startedAt: asDate(source.startedAt, now),
    endedAt: asOptionalDate(source.endedAt),
    cancelRequested: source.cancelRequested === true,
    status: asExecutionStatus(source.status),
    summary: asNonEmptyString(source.summary, 1200),
    steps,
  };
}

function normalizeState(input: BackupRuntimeStateFile): BackupRuntimeState {
  const now = new Date().toISOString();
  const planCursorsRaw =
    input.planCursors && typeof input.planCursors === "object"
      ? (input.planCursors as Record<string, unknown>)
      : {};
  const planCursors: Record<string, string> = {};
  for (const [key, value] of Object.entries(planCursorsRaw)) {
    const safeKey = asNonEmptyString(key, 120);
    const safeDate = asDate(value, "");
    if (!safeKey || !safeDate) continue;
    planCursors[safeKey] = safeDate;
  }

  const executions = Array.isArray(input.executions)
    ? input.executions
        .map((item) => normalizeExecution(item))
        .filter((item): item is BackupExecution => Boolean(item))
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .slice(0, MAX_EXECUTIONS)
    : [];

  return {
    updatedAt: asDate(input.updatedAt, now),
    planCursors,
    executions,
  };
}

function getDefaultRuntimeBackupStatePath() {
  return path.join(process.cwd(), "data", "backup-state.json");
}

export function getRuntimeBackupStatePath() {
  const custom = process.env.PROXCENTER_BACKUP_STATE_PATH?.trim();
  return custom || getDefaultRuntimeBackupStatePath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readRuntimeBackupState(): BackupRuntimeState {
  const filePath = getRuntimeBackupStatePath();
  if (!fs.existsSync(filePath)) {
    return {
      updatedAt: new Date().toISOString(),
      planCursors: {},
      executions: [],
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return {
        updatedAt: new Date().toISOString(),
        planCursors: {},
        executions: [],
      };
    }
    return normalizeState(JSON.parse(raw) as BackupRuntimeStateFile);
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      planCursors: {},
      executions: [],
    };
  }
}

export function writeRuntimeBackupState(state: BackupRuntimeState) {
  const filePath = getRuntimeBackupStatePath();
  ensureParentDirectory(filePath);
  const normalized = normalizeState(state);
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
