import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { getCentralCloudOauthProviderStatus } from "@/lib/backups/cloud-oauth-broker";
import { getPublicCloudOauthAppStatus } from "@/lib/backups/oauth-app-config";
import { readCloudTargetsSpaceMetrics, type CloudTargetSpaceMetrics } from "@/lib/backups/cloud-providers";
import { readLocalBackupStorageMetrics, type LocalBackupStorageMetrics } from "@/lib/backups/local-storage-metrics";
import {
  type BackupCloudProvider,
  type BackupScopeMode,
  type BackupTargetMode,
  type BackupWorkloadKind,
  type RuntimeBackupPlan,
  readRuntimeBackupConfig,
  type RuntimeBackupCloudTarget,
  type RuntimeBackupConfig,
  writeRuntimeBackupConfig,
} from "@/lib/backups/runtime-config";
import {
  getBackupEngineStatus,
  ensureBackupEngineStarted,
  requestBackupExecutionCancellation,
  runBackupEngineTick,
} from "@/lib/backups/engine";
import { readRuntimeBackupState } from "@/lib/backups/runtime-state";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfigAction =
  | "save-plan"
  | "delete-plan"
  | "save-cloud-target"
  | "delete-cloud-target"
  | "run-now"
  | "cancel-execution";

type ConfigBody = {
  action?: unknown;
  plan?: unknown;
  planId?: unknown;
  target?: unknown;
  targetId?: unknown;
  executionId?: unknown;
  confirmationText?: unknown;
};

type PlanInput = {
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
};

type CloudTargetInput = {
  id?: unknown;
  provider?: unknown;
  name?: unknown;
  enabled?: unknown;
  settings?: unknown;
  secrets?: unknown;
};

const BACKUP_MUTATION_LIMIT = {
  windowMs: 5 * 60_000,
  max: 25,
  blockMs: 10 * 60_000,
} as const;

const BACKUP_PROVIDER_SET = new Set<BackupCloudProvider>([
  "onedrive",
  "gdrive",
  "aws-s3",
  "azure-blob",
]);
const BACKUP_KIND_SET = new Set<BackupWorkloadKind>(["qemu", "lxc"]);
const BACKUP_SCOPE_SET = new Set<BackupScopeMode>(["all", "selected"]);
const BACKUP_TARGET_SET = new Set<BackupTargetMode>(["local", "cloud"]);

const PROVIDER_RULES: Record<
  BackupCloudProvider,
  {
    requiredSettings: string[];
    requiredSecrets: string[];
  }
> = {
  onedrive: {
    requiredSettings: [],
    requiredSecrets: ["refreshtoken"],
  },
  gdrive: {
    requiredSettings: [],
    requiredSecrets: ["refreshtoken"],
  },
  "aws-s3": {
    requiredSettings: ["region", "bucket"],
    requiredSecrets: ["accesskeyid", "secretaccesskey"],
  },
  "azure-blob": {
    requiredSettings: ["accountname", "container"],
    requiredSecrets: ["accountkey"],
  },
};

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

function asAction(value: unknown): ConfigAction | null {
  const action = asNonEmptyString(value, 40) as ConfigAction | null;
  if (!action) return null;
  return [
    "save-plan",
    "delete-plan",
    "save-cloud-target",
    "delete-cloud-target",
    "run-now",
    "cancel-execution",
  ].includes(action)
    ? action
    : null;
}

function sanitizeMap(value: unknown, opts?: { maxKeys?: number; maxValueLength?: number }) {
  if (!value || typeof value !== "object") return {};
  const maxKeys = opts?.maxKeys ?? 40;
  const maxValueLength = opts?.maxValueLength ?? 600;
  const out: Record<string, string> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, maxKeys)) {
    const safeKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const safeValue = asNonEmptyString(raw, maxValueLength);
    if (!safeKey || !safeValue) continue;
    out[safeKey] = safeValue;
  }

  return out;
}

function readList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function toPublicTarget(target: RuntimeBackupCloudTarget) {
  const secretState = Object.fromEntries(
    Object.keys(target.secrets).map((key) => [key, true]),
  ) as Record<string, boolean>;

  return {
    id: target.id,
    provider: target.provider,
    name: target.name,
    enabled: target.enabled,
    settings: target.settings,
    secretState,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

function buildPayload(
  config: RuntimeBackupConfig,
  workloads: Awaited<ReturnType<typeof getDashboardSnapshot>>["workloads"],
  mode: "offline" | "live",
  warnings: string[],
  localStorages: LocalBackupStorageMetrics[],
) {
  const runtimeState = readRuntimeBackupState();
  const brokerOauth = getCentralCloudOauthProviderStatus();
  const oauthApps = getPublicCloudOauthAppStatus();
  return {
    ok: true,
    mode,
    warnings,
    cloudOauth: {
      mode: brokerOauth.mode,
      brokerOrigin: brokerOauth.brokerOrigin,
      brokerAvailable: Boolean(brokerOauth.brokerOrigin),
    },
    oauthApps: {
      onedrive: {
        configured: brokerOauth.mode === "central" ? brokerOauth.onedrive : oauthApps.onedrive.configured,
      },
      gdrive: {
        configured: brokerOauth.mode === "central" ? brokerOauth.gdrive : oauthApps.gdrive.configured,
      },
    },
    plans: config.plans,
    cloudTargets: config.cloudTargets.map((target) => toPublicTarget(target)),
    workloads: workloads.map((item) => ({
      id: item.id,
      vmid: item.vmid,
      kind: item.kind,
      name: item.name,
      node: item.node,
      status: item.status,
    })),
    updatedAt: config.updatedAt,
    engine: getBackupEngineStatus(),
    state: runtimeState,
    localStorages,
  };
}

function buildPayloadWithSpace(
  config: RuntimeBackupConfig,
  workloads: Awaited<ReturnType<typeof getDashboardSnapshot>>["workloads"],
  mode: "offline" | "live",
  warnings: string[],
  localStorages: LocalBackupStorageMetrics[],
  spaceByTarget: Record<string, CloudTargetSpaceMetrics>,
) {
  return {
    ...buildPayload(config, workloads, mode, warnings, localStorages),
    spaceByTarget,
  };
}

function validatePlan(input: PlanInput, config: RuntimeBackupConfig) {
  const now = new Date().toISOString();
  const existingId = asNonEmptyString(input.id, 120);
  const existing = existingId
    ? config.plans.find((item) => item.id === existingId) ?? null
    : null;

  const name = asNonEmptyString(input.name, 120);
  if (!name) {
    throw new Error("Nom du plan requis.");
  }

  const scope = asNonEmptyString(input.scope, 20) as BackupScopeMode | null;
  if (!scope || !BACKUP_SCOPE_SET.has(scope)) {
    throw new Error("Scope invalide (all/selected).");
  }

  const includeKindsRaw = readList(input.includeKinds);
  const includeKinds = includeKindsRaw
    .map((item) => asNonEmptyString(item, 8))
    .filter((item): item is BackupWorkloadKind => Boolean(item && BACKUP_KIND_SET.has(item as BackupWorkloadKind)));
  if (includeKinds.length === 0) {
    throw new Error("Sélectionne au moins un type (VM ou CT).");
  }

  const workloadIds = readList(input.workloadIds)
    .map((item) => asNonEmptyString(item, 80))
    .filter((item): item is string => Boolean(item && /^(qemu|lxc)\/\d{1,7}$/.test(item)));

  if (scope === "selected" && workloadIds.length === 0) {
    throw new Error("En mode sélection, choisis au moins une VM/CT.");
  }

  const runsPerWeek = asInt(input.runsPerWeek, 1, 14, existing?.runsPerWeek ?? 2);
  const preferredTime = asNonEmptyString(input.preferredTime, 5) ?? existing?.preferredTime ?? "01:00";
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(preferredTime)) {
    throw new Error("Heure préférée invalide (format HH:MM).");
  }

  const retentionYears = asInt(input.retentionYears, 0, 10, existing?.retentionYears ?? 0);
  const retentionMonths = asInt(input.retentionMonths, 0, 11, existing?.retentionMonths ?? 3);
  if (retentionYears === 0 && retentionMonths === 0) {
    throw new Error("La rétention doit être supérieure à 0 mois.");
  }

  const targetMode = asNonEmptyString(input.targetMode, 20) as BackupTargetMode | null;
  if (!targetMode || !BACKUP_TARGET_SET.has(targetMode)) {
    throw new Error("Type de cible invalide (local/cloud).");
  }

  const cloudTargetId =
    targetMode === "cloud"
      ? asNonEmptyString(input.cloudTargetId, 120)
      : null;
  if (targetMode === "cloud" && !cloudTargetId) {
    throw new Error("Choisis une cible cloud.");
  }
  if (cloudTargetId && !config.cloudTargets.some((target) => target.id === cloudTargetId)) {
    throw new Error("Cible cloud introuvable.");
  }

  return {
    id: existing?.id ?? randomUUID(),
    name,
    enabled: asBoolean(input.enabled, existing?.enabled ?? true),
    scope,
    workloadIds: [...new Set(workloadIds)],
    includeKinds: [...new Set(includeKinds)],
    runsPerWeek,
    preferredTime,
    backupStorage: asNonEmptyString(input.backupStorage, 120),
    retentionYears,
    retentionMonths,
    targetMode,
    cloudTargetId,
    notes: asNonEmptyString(input.notes, 800),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies RuntimeBackupPlan;
}

function ensureProviderRequirements(
  provider: BackupCloudProvider,
  settings: Record<string, string>,
  secrets: Record<string, string>,
) {
  const rules = PROVIDER_RULES[provider];
  for (const key of rules.requiredSettings) {
    if (!settings[key]) {
      throw new Error(`Champ requis manquant: ${key}`);
    }
  }
  for (const key of rules.requiredSecrets) {
    if (!secrets[key]) {
      throw new Error(`Secret requis manquant: ${key}`);
    }
  }
}

function validateCloudTarget(input: CloudTargetInput, config: RuntimeBackupConfig) {
  const now = new Date().toISOString();
  const existingId = asNonEmptyString(input.id, 120);
  const existing = existingId
    ? config.cloudTargets.find((target) => target.id === existingId) ?? null
    : null;

  const provider = asNonEmptyString(input.provider, 40) as BackupCloudProvider | null;
  if (!provider || !BACKUP_PROVIDER_SET.has(provider)) {
    throw new Error("Provider cloud invalide.");
  }

  const name = asNonEmptyString(input.name, 120);
  if (!name) {
    throw new Error("Nom de la cible cloud requis.");
  }

  const mergedSettings = {
    ...(existing?.settings ?? {}),
    ...sanitizeMap(input.settings),
  };

  const incomingSecrets = sanitizeMap(input.secrets, { maxValueLength: 2000 });
  const mergedSecrets = {
    ...(existing?.secrets ?? {}),
    ...incomingSecrets,
  };

  ensureProviderRequirements(provider, mergedSettings, mergedSecrets);
  const encryptUpload = ["1", "true", "yes", "on"].includes(
    (mergedSettings.encryptupload ?? "").trim().toLowerCase(),
  );
  if (encryptUpload && !mergedSecrets.encryptionpassphrase) {
    throw new Error("Passphrase requise si le chiffrement cloud est activé.");
  }

  return {
    id: existing?.id ?? randomUUID(),
    provider,
    name,
    enabled: asBoolean(input.enabled, existing?.enabled ?? true),
    settings: mergedSettings,
    secrets: mergedSecrets,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } satisfies RuntimeBackupCloudTarget;
}

export async function GET() {
  ensureBackupEngineStarted();
  const config = readRuntimeBackupConfig();
  const snapshot = await getDashboardSnapshot();
  const localStorageState = await readLocalBackupStorageMetrics();
  const spaceByTarget = await readCloudTargetsSpaceMetrics(config.cloudTargets);
  const warnings = [...snapshot.warnings, ...localStorageState.warnings];

  return NextResponse.json(
    buildPayloadWithSpace(
      config,
      snapshot.workloads,
      snapshot.mode,
      warnings,
      localStorageState.storages,
      spaceByTarget,
    ),
  );
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: origine de requête invalide." },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`backups:config:${getClientIp(request)}`, BACKUP_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: ConfigBody;
  try {
    body = (await request.json()) as ConfigBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = asAction(body.action);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  }

  const config = readRuntimeBackupConfig();
  ensureBackupEngineStarted();

  try {
    if (action === "run-now") {
      await runBackupEngineTick("manual");
    }

    if (action === "cancel-execution") {
      const executionId = asNonEmptyString(body.executionId, 120);
      if (!executionId) {
        throw new Error("executionId requis.");
      }
      const execution = await requestBackupExecutionCancellation(executionId);
      if (!execution) {
        throw new Error("Exécution backup introuvable.");
      }
    }

    if (action === "save-plan") {
      const plan = validatePlan((body.plan ?? {}) as PlanInput, config);
      config.plans = [
        ...config.plans.filter((item) => item.id !== plan.id),
        plan,
      ].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (action === "delete-plan") {
      const planId = asNonEmptyString(body.planId, 120);
      if (!planId) {
        throw new Error("planId requis.");
      }
      const plan = config.plans.find((item) => item.id === planId) ?? null;
      assertStrongConfirmation(
        body.confirmationText,
        `DELETE PLAN ${plan?.name ?? planId}`,
        `Confirmation forte requise. Tape "DELETE PLAN ${plan?.name ?? planId}".`,
      );
      config.plans = config.plans.filter((item) => item.id !== planId);
    }

    if (action === "save-cloud-target") {
      const target = validateCloudTarget((body.target ?? {}) as CloudTargetInput, config);
      config.cloudTargets = [
        ...config.cloudTargets.filter((item) => item.id !== target.id),
        target,
      ].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (action === "delete-cloud-target") {
      const targetId = asNonEmptyString(body.targetId, 120);
      if (!targetId) {
        throw new Error("targetId requis.");
      }
      const target = config.cloudTargets.find((item) => item.id === targetId) ?? null;
      assertStrongConfirmation(
        body.confirmationText,
        `DELETE CLOUD TARGET ${target?.name ?? targetId}`,
        `Confirmation forte requise. Tape "DELETE CLOUD TARGET ${target?.name ?? targetId}".`,
      );

      const usedByPlan = config.plans.some(
        (plan) => plan.targetMode === "cloud" && plan.cloudTargetId === targetId,
      );
      if (usedByPlan) {
        throw new Error("Cette cible cloud est encore utilisée par un plan backup.");
      }
      config.cloudTargets = config.cloudTargets.filter((item) => item.id !== targetId);
    }

    config.updatedAt = new Date().toISOString();
    const saved = writeRuntimeBackupConfig(config);
    const snapshot = await getDashboardSnapshot();
    const localStorageState = await readLocalBackupStorageMetrics();
    const spaceByTarget = await readCloudTargetsSpaceMetrics(saved.cloudTargets);
    const warnings = [...snapshot.warnings, ...localStorageState.warnings];

    return NextResponse.json(
      buildPayloadWithSpace(
        saved,
        snapshot.workloads,
        snapshot.mode,
        warnings,
        localStorageState.storages,
        spaceByTarget,
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur de configuration backup.",
      },
      { status: 400 },
    );
  }
}
