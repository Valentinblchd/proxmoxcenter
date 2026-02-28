import "server-only";
import fs from "node:fs";
import path from "node:path";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

export type BackupWorkloadKind = "qemu" | "lxc";
export type BackupScopeMode = "all" | "selected";
export type BackupTargetMode = "local" | "cloud";
export type BackupCloudProvider = "onedrive" | "gdrive" | "aws-s3" | "azure-blob";

export type RuntimeBackupPlan = {
  id: string;
  name: string;
  enabled: boolean;
  scope: BackupScopeMode;
  workloadIds: string[];
  includeKinds: BackupWorkloadKind[];
  runsPerWeek: number;
  preferredTime: string;
  backupStorage: string | null;
  retentionYears: number;
  retentionMonths: number;
  targetMode: BackupTargetMode;
  cloudTargetId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeBackupCloudTarget = {
  id: string;
  provider: BackupCloudProvider;
  name: string;
  enabled: boolean;
  settings: Record<string, string>;
  secrets: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeBackupConfig = {
  plans: RuntimeBackupPlan[];
  cloudTargets: RuntimeBackupCloudTarget[];
  updatedAt: string;
};

type RuntimeBackupConfigFile = {
  version?: unknown;
  plans?: unknown;
  cloudTargets?: unknown;
  updatedAt?: unknown;
};

type RuntimeBackupCloudTargetFile = {
  id?: unknown;
  provider?: unknown;
  name?: unknown;
  enabled?: unknown;
  settings?: unknown;
  secretsEncrypted?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type RuntimeBackupPlanFile = {
  id?: unknown;
  name?: unknown;
  enabled?: unknown;
  scope?: unknown;
  workloadIds?: unknown;
  includeKinds?: unknown;
  runsPerWeek?: unknown;
  preferredTime?: unknown;
  backupStorage?: unknown;
  retentionYears?: unknown;
  retentionMonths?: unknown;
  targetMode?: unknown;
  cloudTargetId?: unknown;
  notes?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

const CLOUD_PROVIDER_SET = new Set<BackupCloudProvider>([
  "onedrive",
  "gdrive",
  "aws-s3",
  "azure-blob",
]);
const WORKLOAD_KIND_SET = new Set<BackupWorkloadKind>(["qemu", "lxc"]);
const SCOPE_SET = new Set<BackupScopeMode>(["all", "selected"]);
const TARGET_MODE_SET = new Set<BackupTargetMode>(["local", "cloud"]);

function asNonEmptyString(value: unknown, maxLength = 300) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asInt(value: unknown, min: number, max: number, fallback: number) {
  let parsed: number | null = null;
  if (typeof value === "number" && Number.isInteger(value)) parsed = value;
  if (typeof value === "string" && value.trim()) {
    const next = Number.parseInt(value, 10);
    if (Number.isInteger(next)) parsed = next;
  }
  if (parsed === null || parsed < min || parsed > max) return fallback;
  return parsed;
}

function asIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function sanitizeMap(value: unknown, opts?: { maxKeys?: number; maxValueLength?: number }) {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const maxKeys = opts?.maxKeys ?? 40;
  const maxValueLength = opts?.maxValueLength ?? 600;
  const out: Record<string, string> = {};

  for (const [key, raw] of entries.slice(0, maxKeys)) {
    const safeKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const safeValue = asNonEmptyString(raw, maxValueLength);
    if (!safeKey || !safeValue) continue;
    out[safeKey] = safeValue;
  }

  return out;
}

function normalizeCloudTarget(input: RuntimeBackupCloudTargetFile): RuntimeBackupCloudTarget | null {
  const id = asNonEmptyString(input.id, 120);
  const providerRaw = asNonEmptyString(input.provider, 40) as BackupCloudProvider | null;
  const name = asNonEmptyString(input.name, 120);
  if (!id || !providerRaw || !name || !CLOUD_PROVIDER_SET.has(providerRaw)) return null;

  const encryptedSecrets = sanitizeMap(input.secretsEncrypted, {
    maxKeys: 50,
    maxValueLength: 3000,
  });
  const decryptedSecrets: Record<string, string> = {};
  for (const [key, payload] of Object.entries(encryptedSecrets)) {
    const opened = openSecret(payload);
    if (!opened) continue;
    decryptedSecrets[key] = opened;
  }

  const now = new Date().toISOString();
  return {
    id,
    provider: providerRaw,
    name,
    enabled: asBoolean(input.enabled, true),
    settings: sanitizeMap(input.settings),
    secrets: decryptedSecrets,
    createdAt: asIsoDate(input.createdAt, now),
    updatedAt: asIsoDate(input.updatedAt, now),
  };
}

function normalizePlan(input: RuntimeBackupPlanFile): RuntimeBackupPlan | null {
  const id = asNonEmptyString(input.id, 120);
  const name = asNonEmptyString(input.name, 120);
  const scopeRaw = asNonEmptyString(input.scope, 20) as BackupScopeMode | null;
  const targetModeRaw = asNonEmptyString(input.targetMode, 20) as BackupTargetMode | null;
  const preferredTime = asNonEmptyString(input.preferredTime, 10);
  if (!id || !name || !scopeRaw || !targetModeRaw || !preferredTime) return null;
  if (!SCOPE_SET.has(scopeRaw) || !TARGET_MODE_SET.has(targetModeRaw)) return null;
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(preferredTime)) return null;

  const includeKindsRaw = Array.isArray(input.includeKinds) ? input.includeKinds : [];
  const includeKinds = includeKindsRaw
    .map((item) => asNonEmptyString(item, 8))
    .filter((item): item is BackupWorkloadKind => Boolean(item && WORKLOAD_KIND_SET.has(item as BackupWorkloadKind)));
  const finalKinds: BackupWorkloadKind[] =
    includeKinds.length > 0
      ? Array.from(new Set<BackupWorkloadKind>(includeKinds))
      : ["qemu", "lxc"];

  const workloadIdsRaw = Array.isArray(input.workloadIds) ? input.workloadIds : [];
  const workloadIds = workloadIdsRaw
    .map((item) => asNonEmptyString(item, 80))
    .filter((item): item is string => Boolean(item && /^(qemu|lxc)\/\d{1,7}$/.test(item)));

  const now = new Date().toISOString();
  return {
    id,
    name,
    enabled: asBoolean(input.enabled, true),
    scope: scopeRaw,
    workloadIds: [...new Set(workloadIds)],
    includeKinds: finalKinds,
    runsPerWeek: asInt(input.runsPerWeek, 1, 14, 2),
    preferredTime,
    backupStorage: asNonEmptyString(input.backupStorage, 120),
    retentionYears: asInt(input.retentionYears, 0, 10, 0),
    retentionMonths: asInt(input.retentionMonths, 0, 11, 3),
    targetMode: targetModeRaw,
    cloudTargetId:
      targetModeRaw === "cloud"
        ? asNonEmptyString(input.cloudTargetId, 120)
        : null,
    notes: asNonEmptyString(input.notes, 800),
    createdAt: asIsoDate(input.createdAt, now),
    updatedAt: asIsoDate(input.updatedAt, now),
  };
}

function serializeCloudTarget(target: RuntimeBackupCloudTarget): RuntimeBackupCloudTargetFile {
  const secretsEncrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(target.secrets)) {
    const safe = asNonEmptyString(value, 2000);
    if (!safe) continue;
    secretsEncrypted[key] = sealSecret(safe);
  }

  return {
    id: target.id,
    provider: target.provider,
    name: target.name,
    enabled: target.enabled,
    settings: sanitizeMap(target.settings),
    secretsEncrypted,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

function getDefaultRuntimeBackupConfigPath() {
  return path.join(process.cwd(), "data", "backup-config.json");
}

export function getRuntimeBackupConfigPath() {
  const custom = process.env.PROXCENTER_BACKUP_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimeBackupConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readRuntimeBackupConfig(): RuntimeBackupConfig {
  const filePath = getRuntimeBackupConfigPath();
  const now = new Date().toISOString();

  if (!fs.existsSync(filePath)) {
    return {
      plans: [],
      cloudTargets: [],
      updatedAt: now,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return {
        plans: [],
        cloudTargets: [],
        updatedAt: now,
      };
    }

    const parsed = JSON.parse(raw) as RuntimeBackupConfigFile;
    const planInputs = Array.isArray(parsed.plans) ? parsed.plans : [];
    const cloudInputs = Array.isArray(parsed.cloudTargets) ? parsed.cloudTargets : [];

    const plans = planInputs
      .map((item) => normalizePlan(item as RuntimeBackupPlanFile))
      .filter((item): item is RuntimeBackupPlan => Boolean(item));
    const cloudTargets = cloudInputs
      .map((item) => normalizeCloudTarget(item as RuntimeBackupCloudTargetFile))
      .filter((item): item is RuntimeBackupCloudTarget => Boolean(item));

    return {
      plans,
      cloudTargets,
      updatedAt: asIsoDate(parsed.updatedAt, now),
    };
  } catch {
    return {
      plans: [],
      cloudTargets: [],
      updatedAt: now,
    };
  }
}

export function writeRuntimeBackupConfig(config: RuntimeBackupConfig) {
  const filePath = getRuntimeBackupConfigPath();
  ensureParentDirectory(filePath);

  const normalizedPlans = config.plans
    .map((plan) => normalizePlan(plan as RuntimeBackupPlanFile))
    .filter((plan): plan is RuntimeBackupPlan => Boolean(plan));
  const normalizedCloudTargets = config.cloudTargets
    .map((target) => normalizeCloudTarget(serializeCloudTarget(target)))
    .filter((target): target is RuntimeBackupCloudTarget => Boolean(target));

  const now = new Date().toISOString();
  const serialized = {
    version: 1,
    updatedAt: asIsoDate(config.updatedAt, now),
    plans: normalizedPlans,
    cloudTargets: normalizedCloudTargets.map((target) => serializeCloudTarget(target)),
  };

  fs.writeFileSync(filePath, `${JSON.stringify(serialized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    plans: normalizedPlans,
    cloudTargets: normalizedCloudTargets,
    updatedAt: serialized.updatedAt,
  } satisfies RuntimeBackupConfig;
}
