import "server-only";

import fs from "node:fs";
import path from "node:path";

type SyncWorkloadEntry = {
  id: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  status: string;
  href: string;
  lastSeenAt: string;
};

type LiveSyncState = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  updatedAt: string;
  workloads: SyncWorkloadEntry[];
};

type LiveSyncSnapshotWorkload = {
  id: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  status: string;
};

export type LiveSyncAlert = {
  key: string;
  workloadId: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  href: string;
  staleSinceAt: string;
  lastSuccessAt: string;
  lastErrorAt: string | null;
  lastError: string | null;
};

const DEFAULT_STATE: LiveSyncState = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  updatedAt: new Date(0).toISOString(),
  workloads: [],
};

function getStatePath() {
  return path.join(process.cwd(), "data", "live-sync.json");
}

function ensureStateDir() {
  fs.mkdirSync(path.dirname(getStatePath()), { recursive: true, mode: 0o700 });
}

function readState(): LiveSyncState {
  const filePath = getStatePath();
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_STATE, workloads: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return { ...DEFAULT_STATE, workloads: [] };
    }

    const parsed = JSON.parse(raw) as Partial<LiveSyncState>;
    return {
      lastSuccessAt: typeof parsed.lastSuccessAt === "string" ? parsed.lastSuccessAt : null,
      lastErrorAt: typeof parsed.lastErrorAt === "string" ? parsed.lastErrorAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      workloads: Array.isArray(parsed.workloads)
        ? parsed.workloads.filter((entry): entry is SyncWorkloadEntry => {
            if (!entry || typeof entry !== "object") return false;
            return (
              typeof entry.id === "string" &&
              (entry.kind === "qemu" || entry.kind === "lxc") &&
              typeof entry.vmid === "number" &&
              typeof entry.node === "string" &&
              typeof entry.name === "string" &&
              typeof entry.status === "string" &&
              typeof entry.href === "string" &&
              typeof entry.lastSeenAt === "string"
            );
          })
        : [],
    };
  } catch {
    return { ...DEFAULT_STATE, workloads: [] };
  }
}

function writeState(state: LiveSyncState) {
  ensureStateDir();
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(getStatePath(), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function buildWorkloadHref(kind: "qemu" | "lxc", vmid: number) {
  return `/inventory/${kind}/${vmid}`;
}

export function clearLiveSyncState() {
  writeState({ ...DEFAULT_STATE, workloads: [] });
}

export function recordLiveSyncSuccess(workloads: LiveSyncSnapshotWorkload[]) {
  const now = new Date().toISOString();
  const nextState: LiveSyncState = {
    lastSuccessAt: now,
    lastErrorAt: null,
    lastError: null,
    updatedAt: now,
    workloads: workloads
      .map((workload) => ({
        id: workload.id,
        kind: workload.kind,
        vmid: workload.vmid,
        node: workload.node,
        name: workload.name,
        status: workload.status,
        href: buildWorkloadHref(workload.kind, workload.vmid),
        lastSeenAt: now,
      }))
      .sort((left, right) => {
        if (left.status === "running" && right.status !== "running") return -1;
        if (left.status !== "running" && right.status === "running") return 1;
        return left.vmid - right.vmid;
      }),
  };

  writeState(nextState);
}

export function recordLiveSyncFailure(message: string) {
  const state = readState();
  state.lastErrorAt = new Date().toISOString();
  state.lastError = message;
  writeState(state);
}

export function getLiveSyncOverview(options?: {
  staleAfterMs?: number;
  maxAlerts?: number;
}) {
  const staleAfterMs = options?.staleAfterMs ?? 60_000;
  const maxAlerts = options?.maxAlerts ?? 6;
  const state = readState();
  const now = Date.now();
  const lastSuccessAtMs = state.lastSuccessAt ? new Date(state.lastSuccessAt).getTime() : Number.NaN;
  const lastErrorAtMs = state.lastErrorAt ? new Date(state.lastErrorAt).getTime() : Number.NaN;
  const hasRecentSuccess = Number.isFinite(lastSuccessAtMs) && now - lastSuccessAtMs <= staleAfterMs;
  const hasFreshFailure =
    Number.isFinite(lastSuccessAtMs) &&
    Number.isFinite(lastErrorAtMs) &&
    lastErrorAtMs >= lastSuccessAtMs &&
    now - lastSuccessAtMs > staleAfterMs;

  const alerts: LiveSyncAlert[] =
    hasFreshFailure && state.lastSuccessAt
      ? state.workloads.slice(0, maxAlerts).map((workload) => ({
          key: `${workload.id}:${state.lastSuccessAt}`,
          workloadId: workload.id,
          kind: workload.kind,
          vmid: workload.vmid,
          node: workload.node,
          name: workload.name,
          href: workload.href,
          staleSinceAt: workload.lastSeenAt,
          lastSuccessAt: state.lastSuccessAt!,
          lastErrorAt: state.lastErrorAt,
          lastError: state.lastError,
        }))
      : [];

  return {
    ok: true,
    connected: hasRecentSuccess,
    lastSuccessAt: state.lastSuccessAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    alerts,
  };
}
