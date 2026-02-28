import "server-only";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { scanNodeUpdates, type NodeUpdatesSnapshot } from "@/lib/proxmox/node-updates";
import { waitForNodeTask } from "@/lib/proxmox/tasks";

type WorkloadKind = "qemu" | "lxc";

type ProxmoxClusterResource = {
  id?: string;
  type?: string;
  node?: string;
  name?: string;
  vmid?: number;
  status?: string;
  mem?: number;
  maxmem?: number;
  template?: number;
};

export type RollingUpdatePolicy = {
  autoSecurityNoReboot: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export type RollingUpdatePhase =
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

export type RollingUpdateStatus = "queued" | "running" | "awaiting-manual" | "completed" | "failed" | "cancelled";

export type RollingMigrationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type RollingUpdateMigration = {
  kind: WorkloadKind;
  vmid: number;
  name: string;
  sourceNode: string;
  targetNode: string;
  online: boolean;
  downtimeRisk: boolean;
  status: RollingMigrationStatus;
  upid: string | null;
  error: string | null;
  returnedAt: string | null;
  returnStatus: RollingMigrationStatus;
  returnUpid: string | null;
  returnError: string | null;
};

export type RollingUpdateJob = {
  id: string;
  node: string;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RollingUpdateStatus;
  phase: RollingUpdatePhase;
  policy: RollingUpdatePolicy;
  updates: NodeUpdatesSnapshot | null;
  migrations: RollingUpdateMigration[];
  logs: string[];
  error: string | null;
  cancelRequestedAt: string | null;
  autoPatchEligible: boolean;
  autoPatchExecuted: boolean;
  autoPatchCommand: string | null;
  autoPatchOutput: string | null;
  patchExecutorAvailable: boolean;
};

type RollingUpdateState = {
  policies: Record<string, RollingUpdatePolicy>;
  jobs: RollingUpdateJob[];
};

const DEFAULT_STATE: RollingUpdateState = {
  policies: {},
  jobs: [],
};

const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const MAX_LOG_LINES = 80;
const activeRuns = new Map<string, Promise<void>>();

function getStatePath() {
  return path.join(process.cwd(), "data", "proxmox-rolling-updates.json");
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readState(): RollingUpdateState {
  const filePath = getStatePath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE, policies: {}, jobs: [] };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { ...DEFAULT_STATE, policies: {}, jobs: [] };
    const parsed = JSON.parse(raw) as Partial<RollingUpdateState>;
    return {
      policies: parsed.policies ?? {},
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { ...DEFAULT_STATE, policies: {}, jobs: [] };
  }
}

function writeState(state: RollingUpdateState) {
  const filePath = getStatePath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function mutateState<T>(mutator: (state: RollingUpdateState) => T) {
  const state = readState();
  const output = mutator(state);
  writeState(state);
  return output;
}

function getDefaultPolicy(): RollingUpdatePolicy {
  return {
    autoSecurityNoReboot: false,
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  };
}

function timestamp() {
  return new Date().toISOString();
}

function trimLogs(lines: string[]) {
  return lines.slice(-MAX_LOG_LINES);
}

function appendLog(state: RollingUpdateState, jobId: string, message: string) {
  const job = state.jobs.find((entry) => entry.id === jobId);
  if (!job) return;
  const line = `[${new Date().toISOString()}] ${message}`;
  job.logs = trimLogs([...(job.logs ?? []), line]);
  job.updatedAt = timestamp();
}

function updateJob(jobId: string, mutator: (job: RollingUpdateJob, state: RollingUpdateState) => void) {
  mutateState((state) => {
    const job = state.jobs.find((entry) => entry.id === jobId);
    if (!job) return;
    mutator(job, state);
    job.updatedAt = timestamp();
  });
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNodeName(resource: ProxmoxClusterResource) {
  return resource.node ?? resource.name ?? resource.id ?? "";
}

function readRunningWorkloads(resources: ProxmoxClusterResource[], node: string) {
  return resources
    .filter(
      (resource): resource is ProxmoxClusterResource & { vmid: number } =>
        (resource.type === "qemu" || resource.type === "lxc") &&
        resource.node === node &&
        resource.template !== 1 &&
        typeof resource.vmid === "number" &&
        resource.status === "running",
    )
    .map((resource) => ({
      kind: resource.type as WorkloadKind,
      vmid: resource.vmid,
      name: resource.id?.split("/")?.[1] ?? `${resource.type}-${resource.vmid}`,
      memoryUsed: asNumber(resource.mem),
    }))
    .sort((left, right) => right.memoryUsed - left.memoryUsed || left.vmid - right.vmid);
}

function readTargetNodes(resources: ProxmoxClusterResource[], sourceNode: string) {
  return resources
    .filter((resource) => resource.type === "node" && resource.status === "online")
    .map((resource) => ({
      name: readNodeName(resource),
      freeMemory: Math.max(0, asNumber(resource.maxmem) - asNumber(resource.mem)),
    }))
    .filter((resource) => resource.name && resource.name !== sourceNode)
    .sort((left, right) => right.freeMemory - left.freeMemory || left.name.localeCompare(right.name));
}

async function buildMigrationPlan(node: string) {
  const resources = await proxmoxRequest<ProxmoxClusterResource[]>("cluster/resources");
  const runningWorkloads = readRunningWorkloads(resources, node);
  const targetNodes = readTargetNodes(resources, node);

  if (runningWorkloads.length === 0) {
    return [] as RollingUpdateMigration[];
  }

  if (targetNodes.length === 0) {
    throw new Error("Aucun autre nœud online disponible pour vider ce nœud.");
  }

  return runningWorkloads.map((workload) => {
    targetNodes.sort((left, right) => right.freeMemory - left.freeMemory || left.name.localeCompare(right.name));
    const target = targetNodes[0];
    if (!target) {
      throw new Error(`Impossible de trouver un nœud cible pour ${workload.kind}/${workload.vmid}.`);
    }
    target.freeMemory = Math.max(0, target.freeMemory - workload.memoryUsed);

    return {
      kind: workload.kind,
      vmid: workload.vmid,
      name: workload.name,
      sourceNode: node,
      targetNode: target.name,
      online: true,
      downtimeRisk: workload.kind === "lxc",
      status: "pending",
      upid: null,
      error: null,
      returnedAt: null,
      returnStatus: "pending",
      returnUpid: null,
      returnError: null,
    } satisfies RollingUpdateMigration;
  });
}

async function migrateWorkload(sourceNode: string, migration: RollingUpdateMigration, targetNode: string) {
  const params = new URLSearchParams();
  params.set("target", targetNode);
  if (migration.online) {
    params.set("online", "1");
  }

  const upid = await proxmoxRequest<string>(
    `nodes/${encodeURIComponent(sourceNode)}/${migration.kind}/${migration.vmid}/migrate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: params.toString(),
    },
  );

  await waitForNodeTask(sourceNode, upid, {
    attempts: 160,
    intervalMs: 2_000,
    timeoutMessage: `Timeout pendant la migration de ${migration.kind}/${migration.vmid}.`,
  });

  return upid;
}

function isJobActive(job: RollingUpdateJob) {
  return job.status === "queued" || job.status === "running" || job.status === "awaiting-manual";
}

function isCancelRequested(jobId: string) {
  const state = readState();
  return state.jobs.find((job) => job.id === jobId)?.cancelRequestedAt !== null;
}

function markCancelled(jobId: string) {
  updateJob(jobId, (job) => {
    job.status = "cancelled";
    job.phase = "cancelled";
    job.finishedAt = timestamp();
  });
}

async function migrateBack(jobId: string) {
  const state = readState();
  const job = state.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new Error("Job rolling update introuvable.");

  updateJob(jobId, (nextJob, draft) => {
    nextJob.status = "running";
    nextJob.phase = "migrating-back";
    appendLog(draft, jobId, "Remigration vers le nœud source démarrée.");
  });

  const migrations = [...job.migrations].filter((entry) => entry.status === "completed").reverse();

  for (const migration of migrations) {
    if (isCancelRequested(jobId)) {
      markCancelled(jobId);
      return;
    }

    updateJob(jobId, (nextJob, draft) => {
      const target = nextJob.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
      if (!target) return;
      target.returnStatus = "running";
      appendLog(
        draft,
        jobId,
        `Remigration ${migration.kind.toUpperCase()} #${migration.vmid} ${migration.targetNode} -> ${migration.sourceNode}`,
      );
    });

    try {
      const upid = await migrateWorkload(migration.targetNode, migration, migration.sourceNode);
      updateJob(jobId, (nextJob, draft) => {
        const target = nextJob.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
        if (!target) return;
        target.returnStatus = "completed";
        target.returnUpid = upid;
        target.returnedAt = timestamp();
        appendLog(draft, jobId, `Remigration OK pour ${migration.kind}/${migration.vmid}.`);
      });
    } catch (error) {
      updateJob(jobId, (nextJob, draft) => {
        nextJob.status = "failed";
        nextJob.phase = "failed";
        nextJob.error = error instanceof Error ? error.message : "Erreur remigration.";
        nextJob.finishedAt = timestamp();
        const target = nextJob.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
        if (target) {
          target.returnStatus = "failed";
          target.returnError = nextJob.error;
        }
        appendLog(draft, jobId, `Remigration KO pour ${migration.kind}/${migration.vmid}: ${nextJob.error}`);
      });
      return;
    }
  }

  updateJob(jobId, (nextJob, draft) => {
    nextJob.status = "completed";
    nextJob.phase = "completed";
    nextJob.finishedAt = timestamp();
    appendLog(draft, jobId, "Rolling update terminé.");
  });
}

async function runRollingUpdate(jobId: string) {
  updateJob(jobId, (job, state) => {
    job.status = "running";
    job.phase = "refreshing-updates";
    job.startedAt = timestamp();
    appendLog(state, jobId, "Démarrage du rolling update.");
  });

  const current = readState().jobs.find((entry) => entry.id === jobId);
  if (!current) return;

  try {
    const updates = await scanNodeUpdates(current.node, { refresh: true });
    updateJob(jobId, (job, state) => {
      job.updates = updates;
      appendLog(state, jobId, `APT rafraîchi: ${updates.counts.total} paquet(s), ${updates.counts.security} sécurité.`);
    });

    if (updates.counts.total === 0) {
      updateJob(jobId, (job, state) => {
        job.status = "completed";
        job.phase = "completed";
        job.finishedAt = timestamp();
        appendLog(state, jobId, "Aucune mise à jour détectée. Rien à faire.");
      });
      return;
    }

    updateJob(jobId, (job, state) => {
      job.phase = "planning-migrations";
      appendLog(state, jobId, "Calcul du plan de migration.");
    });

    const plan = await buildMigrationPlan(current.node);
    updateJob(jobId, (job, state) => {
      job.migrations = plan;
      appendLog(
        state,
        jobId,
        plan.length > 0
          ? `${plan.length} workload(s) à vider du nœud.`
          : "Aucun workload running à migrer avant patch.",
      );
    });

    updateJob(jobId, (job, state) => {
      job.phase = "draining-node";
      appendLog(state, jobId, "Vidage du nœud en cours.");
    });

    for (const migration of plan) {
      if (isCancelRequested(jobId)) {
        markCancelled(jobId);
        return;
      }

      updateJob(jobId, (job, state) => {
        const target = job.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
        if (!target) return;
        target.status = "running";
        appendLog(
          state,
          jobId,
          `Migration ${migration.kind.toUpperCase()} #${migration.vmid} ${migration.sourceNode} -> ${migration.targetNode}${
            migration.downtimeRisk ? " (coupure courte possible)" : ""
          }`,
        );
      });

      try {
        const upid = await migrateWorkload(current.node, migration, migration.targetNode);
        updateJob(jobId, (job, state) => {
          const target = job.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
          if (!target) return;
          target.status = "completed";
          target.upid = upid;
          appendLog(state, jobId, `Migration OK pour ${migration.kind}/${migration.vmid}.`);
        });
      } catch (error) {
        updateJob(jobId, (job, state) => {
          job.status = "failed";
          job.phase = "failed";
          job.error = error instanceof Error ? error.message : "Erreur migration.";
          job.finishedAt = timestamp();
          const target = job.migrations.find((entry) => entry.vmid === migration.vmid && entry.kind === migration.kind);
          if (target) {
            target.status = "failed";
            target.error = job.error;
          }
          appendLog(state, jobId, `Migration KO pour ${migration.kind}/${migration.vmid}: ${job.error}`);
        });
        return;
      }
    }

    const autoPatchEligible =
      current.policy.autoSecurityNoReboot &&
      updates.counts.security > 0 &&
      updates.counts.total === updates.counts.security &&
      updates.counts.rebootRisk === 0;

    updateJob(jobId, (job, state) => {
      job.autoPatchEligible = autoPatchEligible;
      job.patchExecutorAvailable = Boolean(process.env.PROXMOXCENTER_NODE_PATCH_COMMAND?.trim());
      appendLog(
        state,
        jobId,
        autoPatchEligible
          ? "Politique auto-patch sans reboot éligible."
          : "Patch automatique non éligible: paquets non-sécurité et/ou reboot requis.",
      );
    });

    updateJob(jobId, (job, state) => {
      job.phase = "awaiting-manual-patch";
      job.status = "awaiting-manual";
      appendLog(
        state,
        jobId,
        autoPatchEligible
          ? "Patchs sécurité sans reboot détectés. Validation manuelle requise: applique les MAJ depuis le shell, puis lance la remigration."
          : "Nœud vidé. Applique les patchs sur le nœud, puis lance la remigration depuis ProxmoxCenter.",
      );
    });
  } catch (error) {
    updateJob(jobId, (job, state) => {
      job.status = "failed";
      job.phase = "failed";
      job.error = error instanceof Error ? error.message : "Erreur rolling update.";
      job.finishedAt = timestamp();
      appendLog(state, jobId, `Rolling update en échec: ${job.error}`);
    });
  }
}

function queueRun(jobId: string) {
  if (activeRuns.has(jobId)) return;
  const run = runRollingUpdate(jobId).finally(() => {
    activeRuns.delete(jobId);
  });
  activeRuns.set(jobId, run);
}

export function getRollingUpdatePolicy(node: string) {
  const state = readState();
  return state.policies[node] ?? getDefaultPolicy();
}

export function updateRollingUpdatePolicy(node: string, patch: Partial<RollingUpdatePolicy>, updatedBy: string | null) {
  if (!NODE_NAME_PATTERN.test(node)) {
    throw new Error("Nœud invalide.");
  }

  return mutateState((state) => {
    const current = state.policies[node] ?? getDefaultPolicy();
    const next: RollingUpdatePolicy = {
      autoSecurityNoReboot:
        typeof patch.autoSecurityNoReboot === "boolean" ? patch.autoSecurityNoReboot : current.autoSecurityNoReboot,
      updatedAt: timestamp(),
      updatedBy,
    };
    state.policies[node] = next;
    return next;
  });
}

export function listRollingUpdateJobs(node: string) {
  return readState().jobs
    .filter((job) => job.node === node)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
}

export function getRollingUpdateJob(jobId: string) {
  return readState().jobs.find((job) => job.id === jobId) ?? null;
}

export function startRollingUpdateJob(node: string, requestedBy: string | null) {
  if (!NODE_NAME_PATTERN.test(node)) {
    throw new Error("Nœud invalide.");
  }

  const job = mutateState((state) => {
    const existing = state.jobs.find((entry) => entry.node === node && isJobActive(entry));
    if (existing) {
      throw new Error("Un rolling update est déjà actif sur ce nœud.");
    }

    const policy = state.policies[node] ?? getDefaultPolicy();
    const next: RollingUpdateJob = {
      id: randomUUID(),
      node,
      requestedBy,
      createdAt: timestamp(),
      updatedAt: timestamp(),
      startedAt: null,
      finishedAt: null,
      status: "queued",
      phase: "queued",
      policy,
      updates: null,
      migrations: [],
      logs: [],
      error: null,
      cancelRequestedAt: null,
      autoPatchEligible: false,
      autoPatchExecuted: false,
      autoPatchCommand: null,
      autoPatchOutput: null,
      patchExecutorAvailable: Boolean(process.env.PROXMOXCENTER_NODE_PATCH_COMMAND?.trim()),
    };

    state.jobs.unshift(next);
    return next;
  });

  queueRun(job.id);
  return job;
}

export function cancelRollingUpdateJob(jobId: string) {
  return mutateState((state) => {
    const job = state.jobs.find((entry) => entry.id === jobId);
    if (!job) {
      throw new Error("Job rolling update introuvable.");
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }
    job.cancelRequestedAt = timestamp();
    appendLog(state, jobId, "Annulation demandée. Les tâches déjà parties iront au bout.");
    return job;
  });
}

export async function migrateBackRollingUpdateJob(jobId: string) {
  const job = getRollingUpdateJob(jobId);
  if (!job) {
    throw new Error("Job rolling update introuvable.");
  }
  if (job.status !== "awaiting-manual") {
    throw new Error("Remigration disponible uniquement après la phase patch manuelle.");
  }
  await migrateBack(jobId);
  return getRollingUpdateJob(jobId);
}

export function getRollingUpdateOverview(node: string) {
  const jobs = listRollingUpdateJobs(node);
  return {
    policy: getRollingUpdatePolicy(node),
    jobs,
    activeJob: jobs.find((job) => isJobActive(job)) ?? null,
    patchExecutorAvailable: Boolean(process.env.PROXMOXCENTER_NODE_PATCH_COMMAND?.trim()),
  };
}
