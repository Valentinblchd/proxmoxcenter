"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import StrongConfirmDialog from "@/components/strong-confirm-dialog";
import {
  buildAutoRetentionPolicy,
  formatRecurrenceLabel,
  formatRetentionPolicy,
  getLastScheduledRun,
  getNextScheduledRun,
  inferRetentionPreset,
  type BackupRecurrenceUnit,
  type BackupRetentionMode,
  type BackupRetentionPreset,
} from "@/lib/backups/plan-policy";

type BackupWorkloadKind = "qemu" | "lxc";
type BackupScopeMode = "all" | "selected";
type BackupTargetMode = "local" | "cloud";
type BackupCloudProvider = "onedrive" | "gdrive" | "aws-s3" | "azure-blob";
type BackupCloudProviderChoice = "" | BackupCloudProvider;
type BackupWorkspaceTab = "overview" | "plans" | "targets" | "history" | "restore" | "pbs";
type BackupHistoryFilter = "all" | "running" | "queued" | "failed" | "cancelled";
type PlanDeliveryMode = "local" | "cloud" | "local-cloud";

type BackupPlan = {
  id: string;
  name: string;
  enabled: boolean;
  scope: BackupScopeMode;
  workloadIds: string[];
  includeKinds: BackupWorkloadKind[];
  runsPerWeek: number;
  recurrenceEvery: number;
  recurrenceUnit: BackupRecurrenceUnit;
  preferredTime: string;
  backupStorage: string | null;
  retentionMode: BackupRetentionMode;
  retentionDays: number;
  retentionWeeks: number;
  retentionYears: number;
  retentionMonths: number;
  targetMode: BackupTargetMode;
  cloudTargetId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type BackupCloudTarget = {
  id: string;
  provider: BackupCloudProvider;
  name: string;
  enabled: boolean;
  settings: Record<string, string>;
  secretState: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
};

type BackupWorkloadOption = {
  id: string;
  vmid: number;
  kind: BackupWorkloadKind;
  name: string;
  node: string;
  status: string;
};

type BackupConfigResponse = {
  ok: boolean;
  mode: "offline" | "live";
  warnings: string[];
  cloudOauth?: {
    mode: "central" | "local";
    brokerOrigin: string | null;
    brokerAvailable: boolean;
  };
  oauthApps?: {
    onedrive: {
      configured: boolean;
    };
    gdrive: {
      configured: boolean;
    };
  };
  plans: BackupPlan[];
  cloudTargets: BackupCloudTarget[];
  workloads: BackupWorkloadOption[];
  localStorages?: Array<{
    id: string;
    node: string | null;
    storage: string;
    usedBytes: number | null;
    totalBytes: number | null;
    freeBytes: number | null;
    usageRatio: number | null;
    shared: boolean;
    source: string;
  }>;
  updatedAt: string;
  spaceByTarget?: Record<
    string,
    {
      targetId: string;
      provider: BackupCloudProvider;
      mode: "quota" | "prefix";
      usedBytes: number | null;
      totalBytes: number | null;
      freeBytes: number | null;
      usageRatio: number | null;
      source: string;
      error: string | null;
      updatedAt: string;
    }
  >;
  engine?: {
    started: boolean;
    running: boolean;
    intervalMs: number;
    lastTickAt: string | null;
    lastError: string | null;
  };
  state?: {
    updatedAt: string;
    planCursors: Record<string, string>;
    executions: Array<{
      id: string;
      planId: string;
      planName: string;
      scheduledAt: string;
      startedAt: string;
      endedAt: string | null;
      status: "queued" | "running" | "success" | "partial" | "failed" | "cancelled";
      cancelRequested: boolean;
      summary: string | null;
      steps: Array<{
        workloadId: string;
        status: "queued" | "running" | "success" | "partial" | "failed" | "cancelled";
        error: string | null;
        sync: {
          status: "pending" | "running" | "success" | "failed" | "skipped" | "cancelled";
          provider: string | null;
          attempts: number;
          uploadedObject: string | null;
          error: string | null;
        };
      }>;
    }>;
  };
};

type PlanFormState = {
  id: string | null;
  name: string;
  enabled: boolean;
  scope: BackupScopeMode;
  workloadIds: string[];
  includeKinds: BackupWorkloadKind[];
  recurrenceEvery: number;
  recurrenceUnit: BackupRecurrenceUnit;
  preferredTime: string;
  backupStorage: string;
  retentionMode: BackupRetentionMode;
  retentionDays: number;
  retentionWeeks: number;
  retentionYears: number;
  retentionMonths: number;
  targetMode: BackupTargetMode;
  cloudTargetId: string;
  notes: string;
};

type TargetFormState = {
  id: string | null;
  provider: BackupCloudProvider;
  name: string;
  enabled: boolean;
  settings: Record<string, string>;
  secrets: Record<string, string>;
};

type BackupPlannerPanelProps = {
  initialTab?: BackupWorkspaceTab;
  canOperate?: boolean;
};

type CloudOauthMessage = {
  type?: unknown;
  ok?: unknown;
  refreshToken?: unknown;
  error?: unknown;
};

type CloudOauthUiState = {
  state: "setup" | "imported" | "folder" | "connected" | "invalid";
  label: string;
};

type CloudFolderItem = {
  id: string;
  name: string;
  value: string;
};

type RestoreTaskItem = {
  upid: string | null;
  node: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  exitStatus: string | null;
  progressPercent: number | null;
  currentLine: string | null;
  lines: string[];
  startedAt: string | null;
  endedAt: string | null;
};

type RestoreJobItem = {
  id: string;
  state: "running" | "success" | "failed" | "cancelled";
  phase:
    | "queued"
    | "preparing-cloud-object"
    | "decrypting"
    | "staging"
    | "importing-to-storage"
    | "restoring-workload"
    | "completed"
    | "cancelled"
    | "failed";
  cancelRequested: boolean;
  cancelledAt: string | null;
  destination: "proxmox" | "pbs";
  targetId: string;
  targetName: string;
  targetProvider: BackupCloudProvider;
  objectKey: string;
  objectName: string | null;
  node: string;
  kind: BackupWorkloadKind | null;
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
  importTask: RestoreTaskItem;
  restoreTask: RestoreTaskItem;
};

type CloudBackupObjectItem = {
  key: string;
  name: string;
  sizeBytes: number | null;
  updatedAt: string | null;
  encrypted: boolean;
  suggestedKind: BackupWorkloadKind | null;
  suggestedVmid: number | null;
};

type RestoreFormState = {
  destination: "proxmox" | "pbs";
  targetId: string;
  objectKey: string;
  node: string;
  kind: BackupWorkloadKind;
  vmid: string;
  backupStorage: string;
  restoreStorage: string;
  force: boolean;
};

type CloudRestoreResponse = {
  ok?: boolean;
  error?: string;
  objects?: CloudBackupObjectItem[];
  filename?: string;
  token?: string;
  downloadUrl?: string;
  expiresAt?: string;
  stagedBackup?: string;
  importUpid?: string;
  restoreUpid?: string;
  jobId?: string;
  job?: RestoreJobItem;
  jobs?: RestoreJobItem[];
  message?: string;
};

type PbsSetupStatus = {
  ok: boolean;
  configured: boolean;
  runtimeSaved: {
    host: string;
    port: number;
    datastore: string;
    authId: string;
    namespace: string | null;
    fingerprintConfigured: boolean;
    secretMasked: string;
    updatedAt: string;
  } | null;
  tooling: {
    available: boolean;
    version: string | null;
    error?: string;
  };
  error?: string;
};

type PbsNamespaceItem = {
  id: string;
  name: string;
  path: string;
};

type PbsGroupItem = {
  id: string;
  label: string;
  path: string;
  backupType: string | null;
  backupId: string | null;
  lastBackupAt: string | null;
  owner: string | null;
  comment: string | null;
};

type PbsSnapshotItem = {
  id: string;
  label: string;
  path: string;
  backupType: string | null;
  backupId: string | null;
  backupTime: string | null;
  comment: string | null;
  sizeBytes: number | null;
};

type ConfirmRequest =
  | {
      kind: "delete-plan";
      planId: string;
      expectedText: string;
      title: string;
      message: string;
    }
  | {
      kind: "delete-cloud-target";
      targetId: string;
      expectedText: string;
      title: string;
      message: string;
    }
  | {
      kind: "restore";
      expectedText: string;
      title: string;
      message: string;
    };

type PbsFileItem = {
  id: string;
  archiveName: string;
  name: string;
  sizeBytes: number | null;
  cryptMode: string | null;
};

type PbsBrowserResponse = {
  ok?: boolean;
  error?: string;
  configured?: boolean;
  namespace?: string | null;
  host?: string;
  port?: number;
  datastore?: string;
  tooling?: PbsSetupStatus["tooling"];
  namespaces?: PbsNamespaceItem[];
  groups?: PbsGroupItem[];
  snapshots?: PbsSnapshotItem[];
  files?: PbsFileItem[];
  filename?: string;
  token?: string;
  expiresAt?: string;
  downloadUrl?: string | null;
  lines?: string[];
};

const PROVIDER_LABEL: Record<BackupCloudProvider, string> = {
  onedrive: "OneDrive",
  gdrive: "Google Drive",
  "aws-s3": "AWS S3",
  "azure-blob": "Azure Blob Storage",
};

const CLOUD_PROVIDER_OPTIONS: Array<{
  id: BackupCloudProviderChoice;
  label: string;
}> = [
  { id: "", label: "Aucune sélection" },
  { id: "aws-s3", label: "AWS S3" },
  { id: "azure-blob", label: "Azure Blob" },
  { id: "onedrive", label: "OneDrive" },
  { id: "gdrive", label: "Google Drive" },
];

const PROVIDER_SETTING_FIELDS: Record<
  BackupCloudProvider,
  Array<{ key: string; label: string; placeholder: string }>
> = {
  onedrive: [],
  gdrive: [],
  "aws-s3": [
    { key: "region", label: "Région", placeholder: "eu-west-3" },
    { key: "bucket", label: "Bucket", placeholder: "my-proxmox-backups" },
    { key: "prefix", label: "Prefix", placeholder: "cluster-a/daily" },
    { key: "capacitygb", label: "Capacité totale (Go, optionnel)", placeholder: "1024" },
  ],
  "azure-blob": [
    { key: "accountname", label: "Storage account", placeholder: "mystorageaccount" },
    { key: "container", label: "Container", placeholder: "backups" },
    { key: "prefix", label: "Prefix", placeholder: "proxmox/daily" },
    { key: "capacitygb", label: "Capacité totale (Go, optionnel)", placeholder: "1024" },
  ],
};

const PROVIDER_SECRET_FIELDS: Record<
  BackupCloudProvider,
  Array<{ key: string; label: string; placeholder: string }>
> = {
  onedrive: [],
  gdrive: [],
  "aws-s3": [
    { key: "accesskeyid", label: "Access Key ID", placeholder: "AKIA..." },
    { key: "secretaccesskey", label: "Secret Access Key", placeholder: "Secret AWS" },
  ],
  "azure-blob": [
    { key: "accountkey", label: "Account Key", placeholder: "Clé de compte Blob" },
    { key: "sastoken", label: "SAS Token (optionnel)", placeholder: "?sv=..." },
  ],
};

function defaultPlanForm(): PlanFormState {
  const retention = buildAutoRetentionPolicy("balanced", 1, "week");
  return {
    id: null,
    name: "",
    enabled: true,
    scope: "all",
    workloadIds: [],
    includeKinds: ["qemu", "lxc"],
    recurrenceEvery: 1,
    recurrenceUnit: "week",
    preferredTime: "01:00",
    backupStorage: "local",
    retentionMode: "auto",
    retentionDays: retention.days,
    retentionWeeks: retention.weeks,
    retentionYears: retention.years,
    retentionMonths: retention.months,
    targetMode: "local",
    cloudTargetId: "",
    notes: "",
  };
}

function defaultTargetForm(): TargetFormState {
  return {
    id: null,
    provider: "aws-s3",
    name: "",
    enabled: true,
    settings: {},
    secrets: {},
  };
}

function defaultRestoreForm(): RestoreFormState {
  return {
    destination: "proxmox",
    targetId: "",
    objectKey: "",
    node: "",
    kind: "qemu",
    vmid: "",
    backupStorage: "",
    restoreStorage: "",
    force: false,
  };
}

function inferPlanDeliveryMode(form: PlanFormState): PlanDeliveryMode {
  if (form.targetMode === "local") return "local";
  return form.backupStorage.trim() ? "local-cloud" : "cloud";
}

function applyPlanDeliveryMode(form: PlanFormState, mode: PlanDeliveryMode): PlanFormState {
  if (mode === "local") {
    return {
      ...form,
      targetMode: "local",
      cloudTargetId: "",
      backupStorage: form.backupStorage.trim() || "local",
    };
  }
  if (mode === "cloud") {
    return {
      ...form,
      targetMode: "cloud",
      backupStorage: "",
    };
  }
  return {
    ...form,
    targetMode: "cloud",
    backupStorage: form.backupStorage.trim() || "local",
  };
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;

  const units = ["Ko", "Mo", "Go", "To", "Po"];
  let scaled = value;
  let unitIndex = -1;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}

function parseCursor(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function computeUpcomingRuns(plans: BackupPlan[], cursors: Record<string, string>, now: Date) {
  return plans
    .filter((plan) => plan.enabled)
    .map((plan) => {
      const cursor = parseCursor(cursors[plan.id]);
      const lastSlot = getLastScheduledRun(
        {
          recurrenceEvery: plan.recurrenceEvery,
          recurrenceUnit: plan.recurrenceUnit,
          preferredTime: plan.preferredTime,
        },
        now,
      );
      const due = !cursor || lastSlot.getTime() > cursor.getTime();
      const nextAt = due
        ? lastSlot
        : getNextScheduledRun(
            {
              recurrenceEvery: plan.recurrenceEvery,
              recurrenceUnit: plan.recurrenceUnit,
              preferredTime: plan.preferredTime,
            },
            now,
          );
      return {
        planId: plan.id,
        planName: plan.name,
        scheduledAt: nextAt.toISOString(),
        due,
      };
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

function formatScheduleDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inferRestoreHintsFromObject(object: CloudBackupObjectItem | null) {
  if (!object) {
    return {
      kind: "qemu" as BackupWorkloadKind,
      vmid: "",
    };
  }

  return {
    kind: object.suggestedKind ?? "qemu",
    vmid: object.suggestedVmid ? String(object.suggestedVmid) : "",
  };
}

function formatRestorePhase(phase: RestoreJobItem["phase"]) {
  switch (phase) {
    case "queued":
      return "En file";
    case "preparing-cloud-object":
      return "Lecture cloud";
    case "decrypting":
      return "Déchiffrement";
    case "staging":
      return "Préparation";
    case "importing-to-storage":
      return "Import vers stockage";
    case "restoring-workload":
      return "Restauration workload";
    case "completed":
      return "Terminé";
    case "cancelled":
      return "Annulé";
    case "failed":
      return "Échec";
    default:
      return phase;
  }
}

function formatRestoreState(state: RestoreJobItem["state"]) {
  switch (state) {
    case "running":
      return "En cours";
    case "success":
      return "Réussi";
    case "cancelled":
      return "Annulé";
    case "failed":
      return "Échec";
    default:
      return state;
  }
}

function formatExecutionState(
  state: "queued" | "running" | "success" | "partial" | "failed" | "cancelled",
) {
  switch (state) {
    case "queued":
      return "En file";
    case "running":
      return "En cours";
    case "success":
      return "Réussi";
    case "partial":
      return "Partiel";
    case "failed":
      return "Échec";
    case "cancelled":
      return "Annulé";
    default:
      return state;
  }
}

function getExecutionBadgeClass(
  state: "queued" | "running" | "success" | "partial" | "failed" | "cancelled",
) {
  switch (state) {
    case "queued":
      return "status-pending";
    case "running":
    case "success":
      return "status-running";
    case "partial":
      return "status-template";
    case "cancelled":
    case "failed":
      return "status-stopped";
    default:
      return "status-template";
  }
}

function triggerBrowserDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getCloudFolderRoot(provider: BackupCloudProvider): CloudFolderItem {
  return {
    id: provider === "gdrive" ? "root" : "",
    name: "Racine",
    value: provider === "gdrive" ? "root" : "",
  };
}

function formatCloudFolderPath(provider: BackupCloudProvider, trail: CloudFolderItem[]) {
  if (trail.length === 0) {
    return provider === "gdrive" ? "Google Drive / Racine" : "OneDrive / Racine";
  }
  return [provider === "gdrive" ? "Google Drive" : "OneDrive", ...trail.map((item) => item.name)].join(" / ");
}

function aggregateUsage(entries: Array<{ usedBytes: number | null; totalBytes: number | null }>) {
  let used = 0;
  let total = 0;
  let hasUsed = false;
  let hasTotal = false;

  for (const entry of entries) {
    if (entry.usedBytes !== null && Number.isFinite(entry.usedBytes)) {
      used += entry.usedBytes;
      hasUsed = true;
    }
    if (entry.totalBytes !== null && Number.isFinite(entry.totalBytes)) {
      total += entry.totalBytes;
      hasTotal = true;
    }
  }

  const usedBytes = hasUsed ? used : null;
  const totalBytes = hasTotal ? total : null;
  const freeBytes = hasUsed && hasTotal ? Math.max(0, total - used) : null;
  const usageRatio =
    hasUsed && hasTotal && total > 0
      ? Math.max(0, Math.min(used / total, 1))
      : null;

  return {
    usedBytes,
    totalBytes,
    freeBytes,
    usageRatio,
  };
}

function getStatusBadgeClass(state: "setup" | "imported" | "folder" | "connected" | "invalid") {
  if (state === "connected") return "status-running";
  if (state === "invalid") return "status-stopped";
  if (state === "folder") return "status-template";
  if (state === "imported") return "status-pending";
  return "status-template";
}

function getDraftCloudOauthStatus(options: {
  provider: BackupCloudProvider;
  oauthReady: boolean;
  refreshToken: string;
  folderValue: string;
  explicitState: CloudOauthUiState | null;
  verified: boolean;
  hasError: boolean;
}) {
  if (options.explicitState?.state === "invalid") {
    return options.explicitState;
  }

  if (!options.oauthReady || !options.refreshToken.trim()) {
    return {
      state: "setup" as const,
      label: "Non configuré",
    };
  }

  if (!options.folderValue.trim()) {
    return options.explicitState?.state === "connected"
      ? { state: "connected" as const, label: "Prêt" }
      : { state: "imported" as const, label: "Token importé" };
  }

  if (options.verified && !options.hasError) {
    return {
      state: "connected" as const,
      label: "Prêt",
    };
  }

  return {
    state: "folder" as const,
    label: "Dossier détecté",
  };
}

function looksLikeInvalidTokenError(error: string | null) {
  if (!error) return false;
  return /(oauth|token|invalid|grant|unauthorized|forbidden|401|403|refresh|auth)/i.test(error);
}

function isEnabledSetting(value: string | undefined) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getVisibleCloudTargetSettings(target: BackupCloudTarget) {
  if (target.provider === "onedrive") {
    return target.settings.rootpath ? [{ key: "dossier", value: target.settings.rootpath }] : [];
  }
  if (target.provider === "gdrive") {
    return target.settings.folderid ? [{ key: "dossier", value: target.settings.folderid }] : [];
  }
  return Object.entries(target.settings)
    .filter(([key]) => !["clientid", "authority", "tenantid"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => ({ key, value }));
}

function getCloudTargetConnectionState(
  target: BackupCloudTarget,
  metric:
    | {
        error: string | null;
      }
    | undefined,
) {
  const hasRefreshToken = Boolean(target.secretState.refreshtoken);
  const hasFolder = Boolean(
    target.provider === "gdrive"
      ? target.settings.folderid?.trim()
      : target.provider === "onedrive"
        ? target.settings.rootpath?.trim()
        : false,
  );
  if (!hasRefreshToken) {
    return {
      state: "setup" as const,
      label: "Non configuré",
      detail: "Aucun refresh token enregistré.",
    };
  }

  if (metric?.error && looksLikeInvalidTokenError(metric.error)) {
    return {
      state: "invalid" as const,
      label: "Token invalide",
      detail: metric.error,
    };
  }

  if (hasFolder && metric && !metric.error) {
    return {
      state: "connected" as const,
      label: "Prêt",
      detail: "Token, dossier et accès cloud validés.",
    };
  }

  if (hasFolder) {
    return {
      state: "folder" as const,
      label: "Dossier détecté",
      detail: "Le dossier cloud est défini pour cette cible.",
    };
  }

  if (!metric) {
    return {
      state: "imported" as const,
      label: "Token importé",
      detail: "Le token est présent, la vérification n'a pas encore tourné.",
    };
  }

  if (metric.error) {
    return {
      state: "imported" as const,
      label: "Token importé",
      detail: metric.error,
    };
  }

  return {
    state: "connected" as const,
    label: "Connecté",
    detail: "Connexion cloud validée.",
  };
}

export default function BackupPlannerPanel({
  initialTab = "overview",
  canOperate = true,
}: BackupPlannerPanelProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<BackupConfigResponse | null>(null);
  const [activeTab, setActiveTab] = useState<BackupWorkspaceTab>(initialTab);
  const [historyFilter, setHistoryFilter] = useState<BackupHistoryFilter>("all");
  const [planForm, setPlanForm] = useState<PlanFormState>(defaultPlanForm);
  const [targetForm, setTargetForm] = useState<TargetFormState>(defaultTargetForm);
  const [targetProviderSelection, setTargetProviderSelection] = useState<BackupCloudProviderChoice>("");
  const [restoreForm, setRestoreForm] = useState<RestoreFormState>(defaultRestoreForm);
  const [workloadFilter, setWorkloadFilter] = useState("");
  const [oneDriveOauthBusy, setOneDriveOauthBusy] = useState(false);
  const [googleOauthBusy, setGoogleOauthBusy] = useState(false);
  const [oneDriveOauthStatus, setOneDriveOauthStatus] = useState<CloudOauthUiState | null>(null);
  const [googleOauthStatus, setGoogleOauthStatus] = useState<CloudOauthUiState | null>(null);
  const [cloudFolderBusy, setCloudFolderBusy] = useState(false);
  const [cloudFolderError, setCloudFolderError] = useState<string | null>(null);
  const [cloudFolders, setCloudFolders] = useState<CloudFolderItem[]>([]);
  const [cloudFolderLoaded, setCloudFolderLoaded] = useState(false);
  const [cloudFolderTrail, setCloudFolderTrail] = useState<CloudFolderItem[]>([]);
  const [newCloudFolderName, setNewCloudFolderName] = useState("");
  const [cloudFolderModalOpen, setCloudFolderModalOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [cloudObjects, setCloudObjects] = useState<CloudBackupObjectItem[]>([]);
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [restoreJob, setRestoreJob] = useState<RestoreJobItem | null>(null);
  const [restoreHistory, setRestoreHistory] = useState<RestoreJobItem[]>([]);
  const [restoreCancelBusy, setRestoreCancelBusy] = useState(false);
  const [pbsStatus, setPbsStatus] = useState<PbsSetupStatus | null>(null);
  const [pbsNamespace, setPbsNamespace] = useState("");
  const [pbsNamespaces, setPbsNamespaces] = useState<PbsNamespaceItem[]>([]);
  const [pbsGroups, setPbsGroups] = useState<PbsGroupItem[]>([]);
  const [pbsSnapshots, setPbsSnapshots] = useState<PbsSnapshotItem[]>([]);
  const [pbsFiles, setPbsFiles] = useState<PbsFileItem[]>([]);
  const [pbsSelectedGroup, setPbsSelectedGroup] = useState("");
  const [pbsSelectedSnapshot, setPbsSelectedSnapshot] = useState("");
  const [pbsSelectedArchive, setPbsSelectedArchive] = useState("");
  const [pbsBusy, setPbsBusy] = useState(false);
  const [pbsError, setPbsError] = useState<string | null>(null);
  const [pbsNotice, setPbsNotice] = useState<string | null>(null);
  const [pbsLoaded, setPbsLoaded] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const selectedTargetProvider = targetProviderSelection || null;

  const loadConfig = useCallback(async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/backups/config", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const payload = (await response.json()) as BackupConfigResponse & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger la configuration backup.");
      }
      setConfig(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPbsStatus = useCallback(async function loadPbsStatus() {
    try {
      const response = await fetch("/api/setup/pbs", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const payload = (await response.json()) as PbsSetupStatus;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de charger l’état PBS.");
      }
      setPbsStatus(payload);
    } catch {
      setPbsStatus(null);
    }
  }, []);

  const callPbsBrowser = useCallback(async function callPbsBrowser(
    body: Record<string, unknown>,
  ) {
    const response = await fetch("/api/pbs/browser", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as PbsBrowserResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Erreur navigateur PBS.");
    }
    return payload;
  }, []);

  const loadPbsNamespaces = useCallback(async function loadPbsNamespaces() {
    const payload = await callPbsBrowser({
      action: "list-namespaces",
      namespace: pbsNamespace || null,
    });
    setPbsNamespaces(payload.namespaces ?? []);
    return payload.namespaces ?? [];
  }, [callPbsBrowser, pbsNamespace]);

  const loadPbsGroups = useCallback(async function loadPbsGroups(namespaceOverride?: string) {
    const payload = await callPbsBrowser({
      action: "list-groups",
      namespace: (namespaceOverride ?? pbsNamespace) || null,
    });
    setPbsGroups(payload.groups ?? []);
    setPbsSnapshots([]);
    setPbsFiles([]);
    setPbsSelectedGroup("");
    setPbsSelectedSnapshot("");
    setPbsSelectedArchive("");
    return payload.groups ?? [];
  }, [callPbsBrowser, pbsNamespace]);

  const loadPbsSnapshots = useCallback(async function loadPbsSnapshots(groupPath: string) {
    const payload = await callPbsBrowser({
      action: "list-snapshots",
      namespace: pbsNamespace || null,
      group: groupPath,
    });
    setPbsSelectedGroup(groupPath);
    setPbsSnapshots(payload.snapshots ?? []);
    setPbsFiles([]);
    setPbsSelectedSnapshot("");
    setPbsSelectedArchive("");
    return payload.snapshots ?? [];
  }, [callPbsBrowser, pbsNamespace]);

  const loadPbsFiles = useCallback(async function loadPbsFiles(snapshotPath: string) {
    const payload = await callPbsBrowser({
      action: "list-files",
      namespace: pbsNamespace || null,
      snapshot: snapshotPath,
    });
    setPbsSelectedSnapshot(snapshotPath);
    setPbsFiles(payload.files ?? []);
    setPbsSelectedArchive("");
    return payload.files ?? [];
  }, [callPbsBrowser, pbsNamespace]);

  const refreshRestoreHistory = useCallback(async function refreshRestoreHistory() {
    const response = await fetch("/api/backups/cloud-restore", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = (await response.json()) as CloudRestoreResponse;
    if (!response.ok || !payload.ok || !Array.isArray(payload.jobs)) {
      throw new Error(payload.error || "Impossible de lire l’historique restore.");
    }
    setRestoreHistory(payload.jobs);
    return payload.jobs;
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadPbsStatus();
  }, [loadConfig, loadPbsStatus]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (pbsStatus?.runtimeSaved?.namespace && !pbsNamespace) {
      setPbsNamespace(pbsStatus.runtimeSaved.namespace);
    }
  }, [pbsNamespace, pbsStatus]);

  useEffect(() => {
    if (activeTab === "pbs" && pbsStatus && !pbsStatus.configured) {
      setActiveTab("overview");
    }
  }, [activeTab, pbsStatus]);

  useEffect(() => {
    if (restoreForm.destination === "pbs" && !pbsStatus?.configured) {
      setRestoreForm((current) => ({
        ...current,
        destination: "proxmox",
      }));
    }
  }, [pbsStatus?.configured, restoreForm.destination]);

  useEffect(() => {
    setPbsLoaded(false);
    setPbsGroups([]);
    setPbsSnapshots([]);
    setPbsFiles([]);
    setPbsSelectedGroup("");
    setPbsSelectedSnapshot("");
    setPbsSelectedArchive("");
  }, [pbsStatus?.runtimeSaved?.updatedAt]);

  useEffect(() => {
    if (!config) return;
    setRestoreForm((current) => {
      const next = { ...current };
      if (!next.targetId && config.cloudTargets[0]) next.targetId = config.cloudTargets[0].id;
      if (!next.backupStorage && config.localStorages?.[0]) next.backupStorage = config.localStorages[0].storage;
      if (!next.node && config.workloads[0]) next.node = config.workloads[0].node;
      return next;
    });
  }, [config]);

  useEffect(() => {
    if (activeTab !== "restore") return;
    void loadPbsStatus();
  }, [activeTab, loadPbsStatus]);

  useEffect(() => {
    if (activeTab !== "pbs" || !pbsStatus?.configured || pbsLoaded) return;
    let cancelled = false;
    const runtimeNamespace = pbsStatus.runtimeSaved?.namespace ?? "";

    async function bootstrapPbsBrowser() {
      setPbsBusy(true);
      setPbsError(null);
      try {
        const namespaces = await loadPbsNamespaces().catch(() => [] as PbsNamespaceItem[]);
        if (cancelled) return;
        const effectiveNamespace =
          pbsNamespace || runtimeNamespace || namespaces.find((item) => item.path)?.path || "";
        if (effectiveNamespace && effectiveNamespace !== pbsNamespace) {
          setPbsNamespace(effectiveNamespace);
        }
        await loadPbsGroups(effectiveNamespace);
        if (!cancelled) {
          setPbsLoaded(true);
        }
      } catch (browserError) {
        if (cancelled) return;
        setPbsError(browserError instanceof Error ? browserError.message : "Erreur de chargement PBS.");
        setPbsLoaded(true);
      } finally {
        if (!cancelled) {
          setPbsBusy(false);
        }
      }
    }

    void bootstrapPbsBrowser();
    return () => {
      cancelled = true;
    };
  }, [activeTab, loadPbsGroups, loadPbsNamespaces, pbsLoaded, pbsNamespace, pbsStatus]);

  useEffect(() => {
    function onMessage(event: MessageEvent<CloudOauthMessage>) {
      const brokerOrigin = config?.cloudOauth?.brokerOrigin ?? null;
      if (event.origin !== window.location.origin && (!brokerOrigin || event.origin !== brokerOrigin)) {
        return;
      }
      const data = event.data;
      if (!data || (data.type !== "proxcenter:onedrive-oauth" && data.type !== "proxcenter:gdrive-oauth")) {
        return;
      }

      const provider = data.type === "proxcenter:gdrive-oauth" ? "gdrive" : "onedrive";
      if (provider === "onedrive") {
        setOneDriveOauthBusy(false);
      } else {
        setGoogleOauthBusy(false);
      }

      const refreshToken = typeof data.refreshToken === "string" ? data.refreshToken.trim() : "";

      if (data.ok === true && refreshToken) {
        setTargetForm((current) => ({
          ...current,
          secrets: {
            ...current.secrets,
            refreshtoken: refreshToken,
          },
        }));
        setCloudFolderTrail([]);
        setCloudFolders([]);
        setCloudFolderLoaded(false);
        const nextStatus: CloudOauthUiState = {
          state: "imported",
          label: "Token importé",
        };
        if (provider === "onedrive") {
          setOneDriveOauthStatus(nextStatus);
        } else {
          setGoogleOauthStatus(nextStatus);
        }
        setNotice(provider === "onedrive" ? "Connexion OneDrive réussie." : "Connexion Google Drive réussie.");
        setError(null);
        setCloudFolderModalOpen(true);
        return;
      }

      const reason =
        typeof data.error === "string" && data.error.trim()
          ? data.error.trim()
          : provider === "onedrive"
            ? "Connexion OneDrive refusée ou incomplète."
            : "Connexion Google Drive refusée ou incomplète.";
      const nextStatus: CloudOauthUiState = {
        state: "invalid",
        label: "Token invalide",
      };
      if (provider === "onedrive") {
        setOneDriveOauthStatus(nextStatus);
      } else {
        setGoogleOauthStatus(nextStatus);
      }
      setError(reason);
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [config?.cloudOauth?.brokerOrigin]);

  useEffect(() => {
    if (selectedTargetProvider !== "onedrive") {
      setOneDriveOauthBusy(false);
      setOneDriveOauthStatus(null);
    }
    if (selectedTargetProvider !== "gdrive") {
      setGoogleOauthBusy(false);
      setGoogleOauthStatus(null);
    }
    setCloudFolderBusy(false);
    setCloudFolderError(null);
    setCloudFolders([]);
    setCloudFolderLoaded(false);
    setCloudFolderTrail([]);
    setNewCloudFolderName("");
  }, [selectedTargetProvider]);

  useEffect(() => {
    setCloudObjects([]);
    setRestoreError(null);
    setRestoreNotice(null);
    setRestoreForm((current) => ({
      ...current,
      objectKey: "",
    }));
  }, [restoreForm.targetId]);

  useEffect(() => {
    if (!restoreJobId) return;
    const jobId = restoreJobId;

    let cancelled = false;
    let timer: number | null = null;

    async function pollJob() {
      try {
        const response = await fetch(`/api/backups/cloud-restore?jobId=${encodeURIComponent(jobId)}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        });
        const payload = (await response.json()) as CloudRestoreResponse;
        if (cancelled) return;
        if (!response.ok || !payload.ok || !payload.job) {
          throw new Error(payload.error || "Impossible de lire l’état du restore.");
        }

        setRestoreJob(payload.job);
        setRestoreHistory((current) => {
          const next = [payload.job as RestoreJobItem, ...current.filter((item) => item.id !== payload.job?.id)];
          return next;
        });
        if (payload.job.state === "running") {
          timer = window.setTimeout(() => {
            void pollJob();
          }, 2000);
          return;
        }

        if (payload.job.state === "success") {
          setRestoreNotice(payload.job.message ?? "Restauration terminée.");
          setRestoreError(null);
          void loadConfig();
        } else if (payload.job.state === "failed") {
          setRestoreError(payload.job.error ?? "La restauration a échoué.");
        } else if (payload.job.state === "cancelled") {
          setRestoreNotice(payload.job.message ?? "Restauration annulée.");
          setRestoreError(null);
        }
        void refreshRestoreHistory().catch(() => undefined);
      } catch (jobError) {
        if (cancelled) return;
        setRestoreError(jobError instanceof Error ? jobError.message : "Erreur de suivi restore.");
      }
    }

    void pollJob();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [loadConfig, refreshRestoreHistory, restoreJobId]);

  useEffect(() => {
    if (activeTab !== "restore") return;

    let cancelled = false;
    void (async () => {
      try {
        const jobs = await refreshRestoreHistory();
        if (cancelled) return;
        const latestJob = jobs[0] ?? null;
        if (latestJob) {
          setRestoreJob(latestJob);
          if (!restoreJobId && latestJob.state === "running") {
            setRestoreJobId(latestJob.id);
          }
        }
      } catch {
        // Silent fetch: restore tab can work without preloading past jobs.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, refreshRestoreHistory, restoreJobId]);

  async function submitAction(body: Record<string, unknown>, successMessage: string) {
    if (!canOperate) {
      setError("Mode lecture: modifications backup bloquées.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/backups/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as BackupConfigResponse & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Action backup refusée.");
      }
      setConfig(payload);
      setNotice(successMessage);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  function resetPlanForm() {
    setPlanForm(defaultPlanForm());
  }

  function resetTargetForm() {
    setTargetForm(defaultTargetForm());
    setTargetProviderSelection("");
    setOneDriveOauthStatus(null);
    setGoogleOauthStatus(null);
    setCloudFolderError(null);
    setCloudFolders([]);
    setCloudFolderLoaded(false);
    setCloudFolderTrail([]);
    setNewCloudFolderName("");
    setCloudFolderModalOpen(false);
  }

  function chooseLocalStorageForPlan(storageName: string) {
    setPlanForm((current) => ({
      ...current,
      backupStorage: storageName,
      targetMode: "local",
      cloudTargetId: "",
    }));
    setActiveTab("plans");
    setNotice(`Stockage local ${storageName} sélectionné pour le prochain plan.`);
    setError(null);
  }

  function chooseCloudTargetForPlan(targetId: string) {
    setPlanForm((current) => ({
      ...current,
      targetMode: "cloud",
      cloudTargetId: targetId,
    }));
    setActiveTab("plans");
    setNotice("Cible cloud liée au prochain plan.");
    setError(null);
  }

  function populatePlanForm(plan: BackupPlan) {
    setPlanForm({
      id: plan.id,
      name: plan.name,
      enabled: plan.enabled,
      scope: plan.scope,
      workloadIds: [...plan.workloadIds],
      includeKinds: [...plan.includeKinds],
      recurrenceEvery: plan.recurrenceEvery,
      recurrenceUnit: plan.recurrenceUnit,
      preferredTime: plan.preferredTime,
      backupStorage: plan.backupStorage ?? "local",
      retentionMode: plan.retentionMode,
      retentionDays: plan.retentionDays,
      retentionWeeks: plan.retentionWeeks,
      retentionYears: plan.retentionYears,
      retentionMonths: plan.retentionMonths,
      targetMode: plan.targetMode,
      cloudTargetId: plan.cloudTargetId ?? "",
      notes: plan.notes ?? "",
    });
  }

  function populateTargetForm(target: BackupCloudTarget) {
    setTargetForm({
      id: target.id,
      provider: target.provider,
      name: target.name,
      enabled: target.enabled,
      settings: { ...target.settings },
      secrets: {},
    });
    setTargetProviderSelection(target.provider);
    setOneDriveOauthStatus(null);
    setGoogleOauthStatus(null);
    setCloudFolderError(null);
    setCloudFolders([]);
    setCloudFolderLoaded(false);
    setCloudFolderTrail([]);
    setNewCloudFolderName("");
    setCloudFolderModalOpen(false);
  }

  async function onSavePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAction(
      {
        action: "save-plan",
        plan: {
          id: planForm.id,
          name: planForm.name,
          enabled: planForm.enabled,
          scope: planForm.scope,
          workloadIds: planForm.workloadIds,
          includeKinds: planForm.includeKinds,
          recurrenceEvery: planForm.recurrenceEvery,
          recurrenceUnit: planForm.recurrenceUnit,
          preferredTime: planForm.preferredTime,
          backupStorage: planForm.backupStorage || null,
          retentionMode: planForm.retentionMode,
          retentionDays: planForm.retentionDays,
          retentionWeeks: planForm.retentionWeeks,
          retentionYears: planForm.retentionYears,
          retentionMonths: planForm.retentionMonths,
          targetMode: planForm.targetMode,
          cloudTargetId: planForm.targetMode === "cloud" ? planForm.cloudTargetId : null,
          notes: planForm.notes,
        },
      },
      planForm.id ? "Plan backup mis à jour." : "Plan backup créé.",
    );
    if (!planForm.id) {
      resetPlanForm();
    }
  }

  async function onDeletePlan(planId: string) {
    const plan = config?.plans.find((item) => item.id === planId) ?? null;
    setConfirmRequest({
      kind: "delete-plan",
      planId,
      expectedText: `DELETE PLAN ${plan?.name ?? planId}`,
      title: "Supprimer le plan backup",
      message: "Cette suppression retire le plan de planification sélectionné.",
    });
  }

  async function onSaveCloudTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTargetProvider) {
      setError("Sélectionne d’abord un provider cloud.");
      return;
    }
    await submitAction(
      {
        action: "save-cloud-target",
        target: {
          id: targetForm.id,
          provider: selectedTargetProvider,
          name: targetForm.name,
          enabled: targetForm.enabled,
          settings: targetForm.settings,
          secrets: targetForm.secrets,
        },
      },
      targetForm.id ? "Cible cloud mise à jour." : "Cible cloud créée.",
    );
    if (!targetForm.id) {
      resetTargetForm();
    } else {
      setTargetForm((current) => ({
        ...current,
        secrets: {},
      }));
    }
  }

  async function onDeleteCloudTarget(targetId: string) {
    const target = config?.cloudTargets.find((item) => item.id === targetId) ?? null;
    setConfirmRequest({
      kind: "delete-cloud-target",
      targetId,
      expectedText: `DELETE CLOUD TARGET ${target?.name ?? targetId}`,
      title: "Supprimer la cible cloud",
      message: "Cette suppression retire la cible cloud et ses secrets stockés localement.",
    });
  }

  async function onRunNow(runPlanId?: string) {
    await submitAction(
      {
        action: "run-now",
        runPlanId,
      },
      runPlanId ? "Run manuel lancé." : "Cycle scheduler déclenché.",
    );
  }

  async function onCancelExecution(executionId: string) {
    await submitAction(
      {
        action: "cancel-execution",
        executionId,
      },
      "Annulation du run demandée.",
    );
  }

  async function confirmPendingAction(confirmationText: string) {
    if (!confirmRequest) return;

    if (confirmRequest.kind === "delete-plan") {
      await submitAction(
        {
          action: "delete-plan",
          planId: confirmRequest.planId,
          confirmationText,
        },
        "Plan backup supprimé.",
      );
      if (planForm.id === confirmRequest.planId) {
        resetPlanForm();
      }
      setConfirmRequest(null);
      return;
    }

    if (confirmRequest.kind === "delete-cloud-target") {
      await submitAction(
        {
          action: "delete-cloud-target",
          targetId: confirmRequest.targetId,
          confirmationText,
        },
        "Cible cloud supprimée.",
      );
      if (targetForm.id === confirmRequest.targetId) {
        resetTargetForm();
      }
      setConfirmRequest(null);
      return;
    }

    if (confirmRequest.kind === "restore") {
      await confirmRestoreFromCloud(confirmationText);
    }
  }

  function openOauthPopup(url: string, popupName: string, onBlocked: () => void, onClosed: () => void) {
    const popup = window.open(
      url,
      popupName,
      "popup=yes,width=560,height=760,resizable=yes,scrollbars=yes",
    );

    if (!popup) {
      onBlocked();
      return;
    }

    popup.focus();
    const watchdog = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(watchdog);
        onClosed();
      }
    }, 500);
  }

  function onConnectOneDrive() {
    if (selectedTargetProvider !== "onedrive") return;
    if (!currentProviderOauthReady) {
      setOneDriveOauthStatus({ state: "invalid", label: "Token invalide" });
      setError(
        cloudOauthMode === "central"
          ? "Service cloud ProxmoxCenter indisponible pour OneDrive."
          : "OneDrive OAuth local n'est pas configuré.",
      );
      return;
    }

    setOneDriveOauthBusy(true);
    setOneDriveOauthStatus(null);
    setError(null);
    setNotice(null);

    const url = "/api/backups/oauth/onedrive/start";
    openOauthPopup(
      url,
      "proxcenter-onedrive-oauth",
      () => {
        setOneDriveOauthBusy(false);
        setOneDriveOauthStatus({ state: "invalid", label: "Token invalide" });
        setError("Popup bloquée. Autorise les popups puis réessaie.");
      },
      () => {
        setOneDriveOauthBusy(false);
      },
    );
  }

  async function onConnectGoogleDrive() {
    if (selectedTargetProvider !== "gdrive") return;
    if (!currentProviderOauthReady) {
      setGoogleOauthStatus({ state: "invalid", label: "Token invalide" });
      setError(
        cloudOauthMode === "central"
          ? "Service cloud ProxmoxCenter indisponible pour Google Drive."
          : "Google Drive OAuth local n'est pas configuré.",
      );
      return;
    }

    setGoogleOauthBusy(true);
    setGoogleOauthStatus(null);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/backups/oauth/gdrive/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; authorizeUrl?: string };
      if (!response.ok || !payload.ok || typeof payload.authorizeUrl !== "string") {
        throw new Error(payload.error || "Impossible d'initialiser OAuth Google Drive.");
      }

      openOauthPopup(
        payload.authorizeUrl,
        "proxcenter-gdrive-oauth",
        () => {
          setGoogleOauthBusy(false);
          setGoogleOauthStatus({ state: "invalid", label: "Token invalide" });
          setError("Popup bloquée. Autorise les popups puis réessaie.");
        },
        () => {
          setGoogleOauthBusy(false);
        },
      );
    } catch (connectError) {
      setGoogleOauthBusy(false);
      setGoogleOauthStatus({ state: "invalid", label: "Token invalide" });
      setError(
        connectError instanceof Error ? connectError.message : "Connexion Google Drive refusée ou incomplète.",
      );
    }
  }

  const onBrowseCloudFolders = useCallback(
    async function onBrowseCloudFolders(options?: { trail?: CloudFolderItem[]; reset?: boolean }) {
      if (selectedTargetProvider !== "onedrive" && selectedTargetProvider !== "gdrive") return;

      const nextTrail = options?.trail ?? (options?.reset ? [] : cloudFolderTrail);
      const currentFolder = nextTrail.at(-1) ?? getCloudFolderRoot(selectedTargetProvider);

      setCloudFolderBusy(true);
      setCloudFolderError(null);
      setCloudFolderLoaded(false);
      setNotice(null);

      try {
        const response = await fetch("/api/backups/cloud-browser", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            provider: selectedTargetProvider,
            action: "list-folders",
            targetId: targetForm.id,
            settings: targetForm.settings,
            secrets: targetForm.secrets,
            parentId: selectedTargetProvider === "gdrive" ? currentFolder.value : undefined,
            parentPath: selectedTargetProvider === "onedrive" ? currentFolder.value : undefined,
          }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          folders?: CloudFolderItem[];
        };
        if (!response.ok || !payload.ok || !Array.isArray(payload.folders)) {
          throw new Error(payload.error || "Impossible de lire les dossiers cloud.");
        }

        setCloudFolderTrail(nextTrail);
        setCloudFolders(payload.folders);
        setCloudFolderLoaded(true);
        if (selectedTargetProvider === "onedrive") {
          setOneDriveOauthStatus({
            state: targetForm.settings.rootpath?.trim() ? "connected" : "imported",
            label: targetForm.settings.rootpath?.trim() ? "Prêt" : "Token importé",
          });
        } else {
          setGoogleOauthStatus({
            state: targetForm.settings.folderid?.trim() ? "connected" : "imported",
            label: targetForm.settings.folderid?.trim() ? "Prêt" : "Token importé",
          });
        }
      } catch (browseError) {
        const message = browseError instanceof Error ? browseError.message : "Erreur de lecture cloud.";
        setCloudFolderError(message);
        setCloudFolderLoaded(true);
        if (selectedTargetProvider === "onedrive") {
          setOneDriveOauthStatus({
            state: looksLikeInvalidTokenError(message) ? "invalid" : "imported",
            label: looksLikeInvalidTokenError(message) ? "Token invalide" : "Token importé",
          });
        } else {
          setGoogleOauthStatus({
            state: looksLikeInvalidTokenError(message) ? "invalid" : "imported",
            label: looksLikeInvalidTokenError(message) ? "Token invalide" : "Token importé",
          });
        }
        setError(message);
      } finally {
        setCloudFolderBusy(false);
      }
    },
    [cloudFolderTrail, selectedTargetProvider, targetForm.id, targetForm.secrets, targetForm.settings],
  );

  useEffect(() => {
    const hasRefreshToken = Boolean(targetForm.secrets.refreshtoken?.trim());
    if (
      cloudFolderModalOpen &&
      hasRefreshToken &&
      (selectedTargetProvider === "onedrive" || selectedTargetProvider === "gdrive") &&
      !cloudFolderBusy &&
      !cloudFolderLoaded
    ) {
      void onBrowseCloudFolders();
    }
  }, [
    cloudFolderModalOpen,
    cloudFolderBusy,
    cloudFolderLoaded,
    cloudFolderTrail,
    onBrowseCloudFolders,
    selectedTargetProvider,
    targetForm.secrets.refreshtoken,
  ]);

  async function onCreateCloudFolder() {
    if (selectedTargetProvider !== "onedrive" && selectedTargetProvider !== "gdrive") return;
    const folderName = newCloudFolderName.trim();
    if (!folderName) {
      setCloudFolderError("Nom du dossier requis.");
      return;
    }

    setCloudFolderBusy(true);
    setCloudFolderError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/backups/cloud-browser", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          provider: selectedTargetProvider,
          action: "create-folder",
          targetId: targetForm.id,
          settings: targetForm.settings,
          secrets: targetForm.secrets,
          folderName,
          parentId:
            selectedTargetProvider === "gdrive"
              ? (cloudFolderTrail.at(-1) ?? getCloudFolderRoot(selectedTargetProvider)).value
              : undefined,
          parentPath:
            selectedTargetProvider === "onedrive"
              ? (cloudFolderTrail.at(-1) ?? getCloudFolderRoot(selectedTargetProvider)).value
              : undefined,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        folder?: CloudFolderItem;
      };
      if (!response.ok || !payload.ok || !payload.folder) {
        throw new Error(payload.error || "Impossible de créer le dossier cloud.");
      }

      setCloudFolders((current) => {
        const next = current.filter((item) => item.value !== payload.folder?.value);
        return [payload.folder as CloudFolderItem, ...next];
      });
      setNewCloudFolderName("");
      setTargetForm((current) => ({
        ...current,
        settings: {
          ...current.settings,
          [selectedTargetProvider === "gdrive" ? "folderid" : "rootpath"]: payload.folder!.value,
        },
      }));
      if (selectedTargetProvider === "onedrive") {
        setOneDriveOauthStatus({ state: "folder", label: "Dossier détecté" });
      } else {
        setGoogleOauthStatus({ state: "folder", label: "Dossier détecté" });
      }
      setNotice(`Dossier ${payload.folder.name} créé et sélectionné.`);
      setCloudFolderModalOpen(false);
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Erreur de création de dossier.";
      setCloudFolderError(message);
      if (selectedTargetProvider === "onedrive") {
        setOneDriveOauthStatus({ state: looksLikeInvalidTokenError(message) ? "invalid" : "imported", label: looksLikeInvalidTokenError(message) ? "Token invalide" : "Token importé" });
      } else {
        setGoogleOauthStatus({ state: looksLikeInvalidTokenError(message) ? "invalid" : "imported", label: looksLikeInvalidTokenError(message) ? "Token invalide" : "Token importé" });
      }
      setError(message);
    } finally {
      setCloudFolderBusy(false);
    }
  }

  function onSelectCloudFolder(item: CloudFolderItem) {
    setTargetForm((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [selectedTargetProvider === "gdrive" ? "folderid" : "rootpath"]: item.value,
      },
    }));
    if (selectedTargetProvider === "onedrive") {
      setOneDriveOauthStatus({ state: "folder", label: "Dossier détecté" });
    } else if (selectedTargetProvider === "gdrive") {
      setGoogleOauthStatus({ state: "folder", label: "Dossier détecté" });
    }
    setNotice(`Dossier ${item.name} sélectionné.`);
    setCloudFolderModalOpen(false);
  }

  function onOpenCloudFolder(item: CloudFolderItem) {
    const nextTrail = [...cloudFolderTrail, item];
    setCloudFolders([]);
    setCloudFolderLoaded(false);
    void onBrowseCloudFolders({ trail: nextTrail });
  }

  function onOpenCloudFolderParent() {
    const nextTrail = cloudFolderTrail.slice(0, -1);
    setCloudFolders([]);
    setCloudFolderLoaded(false);
    void onBrowseCloudFolders({ trail: nextTrail });
  }

  async function onLoadCloudObjects(targetIdOverride?: string) {
    const targetId = (targetIdOverride ?? restoreForm.targetId).trim();
    if (!targetId) {
      setRestoreError("Choisis d'abord une cible cloud.");
      return;
    }

    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreNotice(null);
    try {
      const response = await fetch("/api/backups/cloud-restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "list-objects",
          targetId,
        }),
      });
      const payload = (await response.json()) as CloudRestoreResponse;
      if (!response.ok || !payload.ok || !Array.isArray(payload.objects)) {
        throw new Error(payload.error || "Impossible de lister les backups cloud.");
      }

      setCloudObjects(payload.objects);
      setRestoreForm((current) => {
        if (current.targetId !== targetId) {
          return {
            ...current,
            targetId,
            objectKey: "",
          };
        }
        return current;
      });
      setRestoreNotice(`Backups cloud chargés: ${payload.objects.length} objet(s).`);
    } catch (loadError) {
      setRestoreError(loadError instanceof Error ? loadError.message : "Erreur restore cloud.");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function onDownloadCloudBackup() {
    if (!restoreForm.targetId || !restoreForm.objectKey) {
      setRestoreError("Choisis une cible cloud et un backup.");
      return;
    }

    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreNotice(null);
    try {
      const response = await fetch("/api/backups/cloud-restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "prepare-download",
          targetId: restoreForm.targetId,
          objectKey: restoreForm.objectKey,
        }),
      });
      const payload = (await response.json()) as CloudRestoreResponse;
      if (!response.ok || !payload.ok || !payload.downloadUrl || !payload.filename) {
        throw new Error(payload.error || "Téléchargement déchiffré indisponible.");
      }
      triggerBrowserDownload(payload.downloadUrl, payload.filename);
      setRestoreNotice(`Téléchargement prêt: ${payload.filename}`);
    } catch (downloadError) {
      setRestoreError(downloadError instanceof Error ? downloadError.message : "Erreur de téléchargement.");
    } finally {
      setRestoreBusy(false);
    }
  }

  async function onRestoreFromCloud() {
    if (!canOperate) {
      setRestoreError("Mode lecture: restauration cloud bloquée.");
      return;
    }
    if (!restoreForm.targetId || !restoreForm.objectKey) {
      setRestoreError("Complète cible cloud et objet.");
      return;
    }

    if (restoreForm.destination === "proxmox" && !restoreForm.vmid) {
      setRestoreError("VMID requis pour restaurer vers Proxmox.");
      return;
    }
    if (restoreForm.destination === "proxmox" && (!restoreForm.node || !restoreForm.backupStorage)) {
      setRestoreError("Complète nœud et stockage backup Proxmox.");
      return;
    }
    if (restoreForm.destination === "pbs" && !pbsStatus?.configured) {
      setRestoreError("Configure d’abord la connexion PBS directe.");
      return;
    }

    setConfirmRequest({
      kind: "restore",
      expectedText:
        restoreForm.destination === "pbs"
          ? "RESTORE PBS"
          : `RESTORE ${restoreForm.kind.toUpperCase()} ${restoreForm.vmid}`,
      title: restoreForm.destination === "pbs" ? "Importer vers PBS" : "Restaurer vers Proxmox",
      message:
        restoreForm.destination === "pbs"
          ? "Cette action injecte le backup cloud dans PBS."
          : "Cette action lance une restauration Proxmox depuis le backup cloud sélectionné.",
    });
  }

  async function confirmRestoreFromCloud(confirmationText: string) {
    if (!canOperate) {
      setRestoreError("Mode lecture: restauration cloud bloquée.");
      return;
    }

    setRestoreBusy(true);
    setRestoreError(null);
    setRestoreNotice(null);
    setRestoreJob(null);
    setRestoreJobId(null);
    try {
      const response = await fetch("/api/backups/cloud-restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: restoreForm.destination === "pbs" ? "restore-pbs" : "restore-proxmox",
          targetId: restoreForm.targetId,
          objectKey: restoreForm.objectKey,
          node: restoreForm.destination === "proxmox" ? restoreForm.node : null,
          kind: restoreForm.kind,
          vmid: restoreForm.vmid,
          backupStorage: restoreForm.destination === "proxmox" ? restoreForm.backupStorage : null,
          restoreStorage: restoreForm.restoreStorage || null,
          force: restoreForm.force,
          confirmationText,
        }),
      });
      const payload = (await response.json()) as CloudRestoreResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Restauration refusée.");
      }

      setRestoreJob(payload.job ?? null);
      setRestoreJobId(payload.jobId ?? null);
      if (payload.job) {
        setRestoreHistory((current) => [payload.job as RestoreJobItem, ...current.filter((item) => item.id !== payload.job?.id)]);
      }
      setRestoreNotice(payload.message || "Restore lancé.");
      setConfirmRequest(null);
    } catch (restoreActionError) {
      setRestoreError(
        restoreActionError instanceof Error ? restoreActionError.message : "Erreur de restauration.",
      );
    } finally {
      setConfirmRequest(null);
      setRestoreBusy(false);
    }
  }

  async function onCancelRestoreJob(jobId: string) {
    setRestoreCancelBusy(true);
    setRestoreError(null);
    setRestoreNotice(null);
    try {
      const response = await fetch("/api/backups/cloud-restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "cancel-job",
          jobId,
        }),
      });
      const payload = (await response.json()) as CloudRestoreResponse;
      if (!response.ok || !payload.ok || !payload.job) {
        throw new Error(payload.error || "Impossible d’annuler le job.");
      }
      setRestoreJob(payload.job);
      setRestoreJobId(payload.job.id);
      setRestoreHistory((current) => [payload.job as RestoreJobItem, ...current.filter((item) => item.id !== payload.job?.id)]);
      setRestoreNotice(payload.message ?? "Annulation demandée.");
    } catch (cancelError) {
      setRestoreError(cancelError instanceof Error ? cancelError.message : "Erreur d’annulation.");
    } finally {
      setRestoreCancelBusy(false);
    }
  }

  async function onRefreshPbsBrowser() {
    if (!pbsStatus?.configured) {
      setPbsError("Configure d’abord la connexion PBS.");
      return;
    }

    setPbsBusy(true);
    setPbsError(null);
    setPbsNotice(null);
    try {
      await loadPbsNamespaces().catch(() => [] as PbsNamespaceItem[]);
      const groups = await loadPbsGroups();
      setPbsLoaded(true);
      setPbsNotice(`Navigation PBS rechargée: ${groups.length} groupe(s).`);
    } catch (browserError) {
      setPbsError(browserError instanceof Error ? browserError.message : "Erreur PBS.");
    } finally {
      setPbsBusy(false);
    }
  }

  async function onSelectPbsNamespace(namespacePath: string) {
    setPbsNamespace(namespacePath);
    setPbsBusy(true);
    setPbsError(null);
    setPbsNotice(null);
    try {
      const groups = await loadPbsGroups(namespacePath);
      setPbsLoaded(true);
      setPbsNotice(`Namespace chargé: ${namespacePath || "racine"} • ${groups.length} groupe(s).`);
    } catch (browserError) {
      setPbsError(browserError instanceof Error ? browserError.message : "Erreur de namespace PBS.");
    } finally {
      setPbsBusy(false);
    }
  }

  async function onOpenPbsGroup(groupPath: string) {
    setPbsBusy(true);
    setPbsError(null);
    setPbsNotice(null);
    try {
      const snapshots = await loadPbsSnapshots(groupPath);
      setPbsNotice(`Snapshots chargés: ${snapshots.length} pour ${groupPath}.`);
    } catch (browserError) {
      setPbsError(browserError instanceof Error ? browserError.message : "Erreur de groupe PBS.");
    } finally {
      setPbsBusy(false);
    }
  }

  async function onOpenPbsSnapshot(snapshotPath: string) {
    setPbsBusy(true);
    setPbsError(null);
    setPbsNotice(null);
    try {
      const files = await loadPbsFiles(snapshotPath);
      setPbsNotice(`Archives du snapshot chargées: ${files.length}.`);
    } catch (browserError) {
      setPbsError(browserError instanceof Error ? browserError.message : "Erreur de snapshot PBS.");
    } finally {
      setPbsBusy(false);
    }
  }

  async function onPreparePbsArchiveDownload() {
    if (!pbsSelectedSnapshot || !pbsSelectedArchive) {
      setPbsError("Choisis un snapshot et une archive PBS.");
      return;
    }

    setPbsBusy(true);
    setPbsError(null);
    setPbsNotice(null);
    try {
      const payload = await callPbsBrowser({
        action: "prepare-download",
        namespace: pbsNamespace || null,
        snapshot: pbsSelectedSnapshot,
        archiveName: pbsSelectedArchive,
      });
      if (!payload.downloadUrl || !payload.filename) {
        throw new Error("Téléchargement PBS indisponible.");
      }
      triggerBrowserDownload(payload.downloadUrl, payload.filename);
      setPbsNotice(`Archive PBS prête: ${payload.filename}`);
    } catch (downloadError) {
      setPbsError(downloadError instanceof Error ? downloadError.message : "Erreur de restauration PBS.");
    } finally {
      setPbsBusy(false);
    }
  }

  function toggleWorkloadSelection(workloadId: string) {
    setPlanForm((current) => {
      const isSelected = current.workloadIds.includes(workloadId);
      return {
        ...current,
        workloadIds: isSelected
          ? current.workloadIds.filter((id) => id !== workloadId)
          : [...current.workloadIds, workloadId],
      };
    });
  }

  function toggleKind(kind: BackupWorkloadKind) {
    setPlanForm((current) => {
      const exists = current.includeKinds.includes(kind);
      const next = exists
        ? current.includeKinds.filter((item) => item !== kind)
        : [...current.includeKinds, kind];
      return {
        ...current,
        includeKinds: next,
      };
    });
  }

  const workloads = config?.workloads ?? [];
  const plans = config?.plans ?? [];
  const cloudTargets = config?.cloudTargets ?? [];
  const localStorages = config?.localStorages ?? [];
  const spaceByTarget = config?.spaceByTarget ?? {};
  const executions = config?.state?.executions ?? [];
  const planCursors = config?.state?.planCursors ?? {};
  const filteredWorkloads = workloads.filter((item) => {
    const haystack = `${item.name} ${item.node} ${item.vmid} ${item.kind}`.toLowerCase();
    return haystack.includes(workloadFilter.trim().toLowerCase());
  });
  const selectableCloudTargets = cloudTargets.filter((target) => target.enabled);
  const hasConfiguration = plans.length > 0 || cloudTargets.length > 0;
  const now = new Date();
  const upcomingRuns = computeUpcomingRuns(plans, planCursors, now).slice(0, 8);
  const recentExecutions = executions.slice(0, 12);
  const successRuns = recentExecutions.filter((item) => item.status === "success").length;
  const failedRuns = recentExecutions.filter((item) => item.status === "failed").length;
  const partialRuns = recentExecutions.filter((item) => item.status === "partial").length;
  const runningExecution =
    executions.find((item) => item.status === "running" || item.status === "queued") ?? null;
  const lastExecution = executions[0] ?? null;
  const localUsage = aggregateUsage(localStorages);
  const cloudUsage = aggregateUsage(
    cloudTargets
      .map((target) => spaceByTarget[target.id])
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
  );
  const currentProviderOauthConfig =
    selectedTargetProvider === "onedrive"
      ? config?.oauthApps?.onedrive
      : selectedTargetProvider === "gdrive"
        ? config?.oauthApps?.gdrive
        : null;
  const currentProviderOauthReady = Boolean(currentProviderOauthConfig?.configured);
  const cloudOauthMode = config?.cloudOauth?.mode ?? "central";
  const cloudOauthBrokerAvailable = Boolean(config?.cloudOauth?.brokerAvailable);
  const hasTargetRefreshToken = Boolean(targetForm.secrets.refreshtoken?.trim());
  const explicitCloudOauthStatus =
    selectedTargetProvider === "onedrive"
      ? oneDriveOauthStatus
      : selectedTargetProvider === "gdrive"
        ? googleOauthStatus
        : null;
  const currentCloudOauthStatus =
    selectedTargetProvider === "onedrive" || selectedTargetProvider === "gdrive"
      ? getDraftCloudOauthStatus({
          provider: selectedTargetProvider,
          oauthReady: currentProviderOauthReady,
          refreshToken: targetForm.secrets.refreshtoken ?? "",
          folderValue:
            selectedTargetProvider === "gdrive"
              ? targetForm.settings.folderid ?? ""
              : targetForm.settings.rootpath ?? "",
          explicitState: explicitCloudOauthStatus,
          verified: cloudFolderLoaded,
          hasError: Boolean(cloudFolderError),
        })
      : null;
  const currentCloudFolder = selectedTargetProvider ? getCloudFolderRoot(selectedTargetProvider) : null;
  const activeCloudFolder = currentCloudFolder ? cloudFolderTrail.at(-1) ?? currentCloudFolder : null;
  const activeCloudFolderPath =
    selectedTargetProvider && currentCloudFolder
      ? formatCloudFolderPath(selectedTargetProvider, cloudFolderTrail)
      : null;
  const cloudEncryptionEnabled = isEnabledSetting(targetForm.settings.encryptupload);
  const restoreTarget = cloudTargets.find((target) => target.id === restoreForm.targetId) ?? null;
  const restoreSelectedObject =
    cloudObjects.find((item) => item.key === restoreForm.objectKey) ?? null;
  const restoreNodeOptions = Array.from(new Set(workloads.map((item) => item.node))).sort((a, b) =>
    a.localeCompare(b),
  );
  const restoreStorageOptions = Array.from(new Set(localStorages.map((item) => item.storage))).sort((a, b) =>
    a.localeCompare(b),
  );
  const selectedPbsGroup = pbsGroups.find((item) => item.path === pbsSelectedGroup) ?? null;
  const selectedPbsSnapshot = pbsSnapshots.find((item) => item.path === pbsSelectedSnapshot) ?? null;
  const selectedPbsFile = pbsFiles.find((item) => item.archiveName === pbsSelectedArchive) ?? null;
  const planDeliveryMode = inferPlanDeliveryMode(planForm);
  const retentionPreset = inferRetentionPreset(
    planForm.retentionMode,
    {
      days: planForm.retentionDays,
      weeks: planForm.retentionWeeks,
      months: planForm.retentionMonths,
      years: planForm.retentionYears,
    },
    planForm.recurrenceEvery,
    planForm.recurrenceUnit,
  );
  const filteredExecutions = executions.filter((execution) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "failed") {
      return execution.status === "failed" || execution.status === "partial";
    }
    return execution.status === historyFilter;
  });
  const backupTabs: Array<{ id: BackupWorkspaceTab; label: string }> = [
    { id: "overview", label: "Actif" },
    { id: "targets", label: "Local / Cloud" },
    { id: "plans", label: "Plans" },
    { id: "history", label: "Runs & erreurs" },
    { id: "restore", label: "Restore" },
    ...(pbsStatus?.configured ? [{ id: "pbs" as const, label: "PBS direct" }] : []),
  ];
  const showTargetsPanel = activeTab === "targets";
  const showPlansPanel = activeTab === "plans";

  return (
    <section className="backup-planner-shell">
      <section className="panel">
        <div className="panel-head">
          <h2>Sauvegardes</h2>
          <span className="muted">
            {config?.mode === "live" ? "Proxmox live" : "Mode offline"}
          </span>
        </div>

        <div className="hub-tabs">
          {backupTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!hasConfiguration || config?.warnings?.length || error || notice ? (
          <div className="backup-alert-stack">
            {!hasConfiguration ? (
              <article className="backup-alert warn">
                <strong>Configuration incomplète</strong>
                <p>Aucune sauvegarde configurée. Commence par créer une cible locale/cloud et un plan.</p>
              </article>
            ) : null}
            {config?.warnings?.length ? (
              <article className="backup-alert warn">
                <strong>Attention</strong>
                <p>{config.warnings[0]}</p>
              </article>
            ) : null}
            {error ? (
              <article className="backup-alert error">
                <strong>Erreur</strong>
                <p>{error}</p>
              </article>
            ) : null}
            {notice ? (
              <article className="backup-alert info">
                <strong>Info</strong>
                <p>{notice}</p>
              </article>
            ) : null}
          </div>
        ) : null}

        {config?.engine ? (
          <div className="row-line backup-engine-line">
            <span>
              Scheduler {config.engine.started ? "actif" : "inactif"}{" "}
              {config.engine.running ? "(en cours)" : ""}
            </span>
            <strong>{config.engine.lastTickAt ?? "Jamais"}</strong>
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <>
            <section className="stats-grid">
              <article className="stat-tile">
                <div className="stat-label">Dernière exécution</div>
                <div className="stat-value">
                  {lastExecution ? lastExecution.status.toUpperCase() : "AUCUNE"}
                </div>
                <div className="stat-subtle">
                  {lastExecution ? formatScheduleDate(lastExecution.startedAt) : "Aucune exécution"}
                </div>
              </article>
              <article className="stat-tile">
                <div className="stat-label">Runs récents</div>
                <div className="stat-value">
                  {successRuns} OK / {failedRuns + partialRuns} KO
                </div>
                <div className="stat-subtle">Derniers {recentExecutions.length} runs</div>
              </article>
              <article className="stat-tile">
                <div className="stat-label">Stockage local</div>
                <div className="stat-value">{formatBytes(localUsage.usedBytes)}</div>
                <div className="stat-subtle">
                  {localUsage.totalBytes !== null
                    ? `${formatBytes(localUsage.freeBytes)} libre`
                    : "Capacité non remontée"}
                </div>
              </article>
              <article className="stat-tile">
                <div className="stat-label">Stockage cloud</div>
                <div className="stat-value">{formatBytes(cloudUsage.usedBytes)}</div>
                <div className="stat-subtle">
                  {cloudUsage.totalBytes !== null
                    ? `${formatBytes(cloudUsage.freeBytes)} libre`
                    : "Quota total non défini"}
                </div>
              </article>
            </section>

            <div className="content-grid backup-overview-grid">
              <section className="hint-box">
                <h3 className="subsection-title">1. Stockage local</h3>
                <div className="item-title">
                  {localStorages.length > 0 ? `${localStorages.length} stockage(s) détecté(s)` : "Aucun stockage détecté"}
                </div>
                <div className="item-subtitle">
                  {localUsage.totalBytes !== null
                    ? `${formatBytes(localUsage.usedBytes)} utilisés • ${formatBytes(localUsage.freeBytes)} libres`
                    : "Capacité locale non remontée"}
                </div>
                <div className="quick-actions">
                  <button type="button" className="action-btn" onClick={() => setActiveTab("targets")}>
                    Ouvrir la configuration
                  </button>
                </div>
              </section>

              <section className="hint-box">
                <h3 className="subsection-title">2. Extension cloud</h3>
                <div className="item-title">
                  {cloudTargets.length > 0 ? `${cloudTargets.length} cible(s) cloud` : "Aucune cible cloud"}
                </div>
                <div className="item-subtitle">
                  {cloudUsage.usedBytes !== null
                    ? `${formatBytes(cloudUsage.usedBytes)} synchronisés`
                    : "Aucun quota cloud remonté"}
                </div>
                <div className="quick-actions">
                  <button type="button" className="action-btn" onClick={() => setActiveTab("targets")}>
                    Gérer local + cloud
                  </button>
                </div>
              </section>

              <section className="hint-box">
                <h3 className="subsection-title">3. Restore</h3>
                <div className="item-title">
                  {restoreHistory.length > 0 ? `${restoreHistory.length} job(s) restore` : "Aucun restore lancé"}
                </div>
                <div className="item-subtitle">
                  {restoreJob ? formatRestorePhase(restoreJob.phase) : "Accès direct aux restores cloud"}
                </div>
                <div className="quick-actions">
                  <button type="button" className="action-btn" onClick={() => setActiveTab("restore")}>
                    Ouvrir la restauration
                  </button>
                </div>
              </section>
            </div>

            <div className="content-grid backup-overview-grid">
              <section className="hint-box">
                <h3 className="subsection-title">Run actif</h3>
                {runningExecution ? (
                  <div className="mini-list">
                    <article className="mini-list-item">
                      <div>
                        <div className="item-title">
                          {runningExecution.planName}
                          <span className={`inventory-badge ${getExecutionBadgeClass(runningExecution.status)}`}>
                            {formatExecutionState(runningExecution.status)}
                          </span>
                          {runningExecution.cancelRequested ? (
                            <span className="inventory-badge status-template">Annulation demandée</span>
                          ) : null}
                        </div>
                        <div className="item-subtitle">
                          Démarré {formatScheduleDate(runningExecution.startedAt)} • {runningExecution.steps.length} étape(s)
                        </div>
                        {runningExecution.summary ? (
                          <div className="item-subtitle">{runningExecution.summary}</div>
                        ) : null}
                      </div>
                      <div className="backup-plan-actions">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => void onCancelExecution(runningExecution.id)}
                          disabled={busy || runningExecution.cancelRequested}
                        >
                          {runningExecution.cancelRequested ? "Annulation..." : "Annuler"}
                        </button>
                      </div>
                    </article>
                  </div>
                ) : (
                  <div className="backup-empty-note">
                    <p className="muted">Aucun run backup en cours.</p>
                  </div>
                )}
              </section>

              <section className="hint-box">
                <h3 className="subsection-title">Prochains passages</h3>
                {upcomingRuns.length === 0 ? (
                  <div className="backup-empty-note">
                    <p className="muted">Aucun plan actif.</p>
                    <button type="button" className="action-btn" onClick={() => setActiveTab("plans")}>
                      Créer un plan
                    </button>
                  </div>
                ) : (
                  <div className="mini-list">
                    {upcomingRuns.slice(0, 4).map((run) => (
                      <article key={`${run.planId}-${run.scheduledAt}`} className="mini-list-item">
                        <div>
                          <div className="item-title">
                            {run.planName}
                            <span className={`inventory-badge ${run.due ? "status-stopped" : "status-running"}`}>
                              {run.due ? "En attente" : "Prévu"}
                            </span>
                          </div>
                          <div className="item-subtitle">{formatScheduleDate(run.scheduledAt)}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="hint-box">
                <h3 className="subsection-title">Stockages backup locaux</h3>
                {localStorages.length === 0 ? (
                  <div className="backup-empty-note">
                    <p className="muted">Aucun stockage backup local détecté.</p>
                    <button type="button" className="action-btn" onClick={() => setActiveTab("targets")}>
                      Configurer local/cloud
                    </button>
                  </div>
                ) : (
                  <div className="mini-list">
                    {localStorages.slice(0, 4).map((storage) => (
                      <article key={storage.id} className="mini-list-item">
                        <div>
                          <div className="item-title">
                            {storage.storage}
                            <span className="item-subtitle">{storage.node ? ` • ${storage.node}` : " • cluster"}</span>
                          </div>
                          <div className="item-subtitle">
                            {formatBytes(storage.usedBytes)} / {formatBytes(storage.totalBytes)}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}

        <div className="quick-actions">
          <button className="action-btn" type="button" onClick={() => void loadConfig()} disabled={busy || loading}>
            Recharger
          </button>
          {(activeTab === "overview" || activeTab === "history") && canOperate ? (
            <button className="action-btn primary" type="button" onClick={() => void onRunNow()} disabled={busy}>
              Lancer maintenant
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="hint-box">
            <p className="muted">Chargement de la configuration backup...</p>
          </div>
        ) : null}
      </section>

      {showPlansPanel ? (
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>{planForm.id ? "Modifier un plan" : "Nouveau plan backup"}</h2>
            <span className="muted">{formatRecurrenceLabel(planForm.recurrenceEvery, planForm.recurrenceUnit)}</span>
          </div>

          <div className="hint-box">
            <div className="item-title">Créer un plan</div>
            <div className="item-subtitle">1) Type  2) Horaire  3) VM/CT  4) Rétention</div>
            <div className="provision-segment" role="group" aria-label="Type de plan rapide">
              <button
                type="button"
                className={`provision-seg-btn${planDeliveryMode === "local" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) =>
                    applyPlanDeliveryMode(current, "local"),
                  )
                }
              >
                Local
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planDeliveryMode === "cloud" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) =>
                    applyPlanDeliveryMode(current, "cloud"),
                  )
                }
              >
                Cloud
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planDeliveryMode === "local-cloud" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) =>
                    applyPlanDeliveryMode(current, "local-cloud"),
                  )
                }
              >
                Local + Cloud
              </button>
            </div>
          </div>

          <form className="provision-panel" onSubmit={onSavePlan}>
            <div className="provision-grid">
              <label className="provision-field">
                <span className="provision-field-label">Nom du plan</span>
                <input
                  className="provision-input"
                  value={planForm.name}
                  onChange={(event) => setPlanForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Backup production hebdo"
                  required
                />
              </label>

              <label className="provision-field">
                <span className="provision-field-label">Heure préférée</span>
                <input
                  className="provision-input"
                  type="time"
                  value={planForm.preferredTime}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, preferredTime: event.target.value || "01:00" }))
                  }
                  required
                />
              </label>
            </div>

            <div className="provision-check-row">
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={planForm.enabled}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                Plan actif
              </label>
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={planForm.includeKinds.includes("qemu")}
                  onChange={() => toggleKind("qemu")}
                />
                Inclure VM
              </label>
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={planForm.includeKinds.includes("lxc")}
                  onChange={() => toggleKind("lxc")}
                />
                Inclure CT
              </label>
            </div>

            <div className="provision-segment">
              <button
                type="button"
                className={`provision-seg-btn${planForm.scope === "all" ? " is-active" : ""}`}
                onClick={() => setPlanForm((current) => ({ ...current, scope: "all" }))}
              >
                Toutes les VM/CT
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planForm.scope === "selected" ? " is-active" : ""}`}
                onClick={() => setPlanForm((current) => ({ ...current, scope: "selected" }))}
              >
                Sélection manuelle
              </button>
            </div>

            {planForm.scope === "selected" ? (
              <div className="backup-workload-picker">
                <input
                  className="provision-input"
                  value={workloadFilter}
                  onChange={(event) => setWorkloadFilter(event.target.value)}
                  placeholder="Filtrer (nom, node, vmid)"
                />
                <div className="backup-workload-list">
                  {filteredWorkloads.map((workload) => (
                    <label key={workload.id} className="backup-workload-item">
                      <input
                        type="checkbox"
                        checked={planForm.workloadIds.includes(workload.id)}
                        onChange={() => toggleWorkloadSelection(workload.id)}
                      />
                      <span>
                        {workload.name} ({workload.kind.toUpperCase()} #{workload.vmid}) •{" "}
                        {workload.node}
                      </span>
                    </label>
                  ))}
                  {filteredWorkloads.length === 0 ? (
                    <p className="muted">Aucune VM/CT trouvée pour ce filtre.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="provision-grid">
              <label className="provision-field">
                <span className="provision-field-label">Tous les</span>
                <input
                  className="provision-input"
                  type="number"
                  min={1}
                  value={planForm.recurrenceEvery}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      recurrenceEvery: Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1),
                    }))
                  }
                  required
                />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">Unité</span>
                <select
                  className="provision-input"
                  value={planForm.recurrenceUnit}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      recurrenceUnit: event.target.value as BackupRecurrenceUnit,
                    }))
                  }
                  required
                >
                  <option value="hour">Heure(s)</option>
                  <option value="day">Jour(s)</option>
                  <option value="week">Semaine(s)</option>
                  <option value="month">Mois</option>
                  <option value="year">Année(s)</option>
                </select>
              </label>
            </div>

            <div className="hint-box">
              <div className="row-line">
                <span>Récurrence</span>
                <strong>{formatRecurrenceLabel(planForm.recurrenceEvery, planForm.recurrenceUnit)}</strong>
              </div>
            </div>

            {planDeliveryMode !== "cloud" ? (
              <label className="provision-field">
                <span className="provision-field-label">
                  Stockage backup local
                  <small>Ex: local, pbs, ceph-backup</small>
                </span>
                <input
                  className="provision-input"
                  value={planForm.backupStorage}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      backupStorage: event.target.value,
                    }))
                  }
                  placeholder="local"
                  required
                />
              </label>
            ) : null}

            {planDeliveryMode !== "local" ? (
              <label className="provision-field">
                <span className="provision-field-label">Cible cloud</span>
                <select
                  className="provision-input"
                  value={planForm.cloudTargetId}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, cloudTargetId: event.target.value }))
                  }
                  required
                >
                  <option value="">Sélectionner une cible cloud</option>
                  {selectableCloudTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} ({PROVIDER_LABEL[target.provider]})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="hint-box">
              <div className="item-title">Rétention</div>
              <div className="item-subtitle">Presets auto ou conservation manuelle en jours, semaines, mois ou années.</div>
            </div>

            <div className="provision-segment" role="group" aria-label="Mode de rétention">
              <button
                type="button"
                className={`provision-seg-btn${planForm.retentionMode === "auto" && retentionPreset === "short" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) => {
                    const nextPolicy = buildAutoRetentionPolicy("short", current.recurrenceEvery, current.recurrenceUnit);
                    return {
                      ...current,
                      retentionMode: "auto",
                      retentionDays: nextPolicy.days,
                      retentionWeeks: nextPolicy.weeks,
                      retentionMonths: nextPolicy.months,
                      retentionYears: nextPolicy.years,
                    };
                  })
                }
              >
                Auto court
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planForm.retentionMode === "auto" && retentionPreset === "balanced" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) => {
                    const nextPolicy = buildAutoRetentionPolicy("balanced", current.recurrenceEvery, current.recurrenceUnit);
                    return {
                      ...current,
                      retentionMode: "auto",
                      retentionDays: nextPolicy.days,
                      retentionWeeks: nextPolicy.weeks,
                      retentionMonths: nextPolicy.months,
                      retentionYears: nextPolicy.years,
                    };
                  })
                }
              >
                Auto équilibré
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planForm.retentionMode === "auto" && retentionPreset === "long" ? " is-active" : ""}`}
                onClick={() =>
                  setPlanForm((current) => {
                    const nextPolicy = buildAutoRetentionPolicy("long", current.recurrenceEvery, current.recurrenceUnit);
                    return {
                      ...current,
                      retentionMode: "auto",
                      retentionDays: nextPolicy.days,
                      retentionWeeks: nextPolicy.weeks,
                      retentionMonths: nextPolicy.months,
                      retentionYears: nextPolicy.years,
                    };
                  })
                }
              >
                Auto long
              </button>
              <button
                type="button"
                className={`provision-seg-btn${planForm.retentionMode === "manual" ? " is-active" : ""}`}
                onClick={() => setPlanForm((current) => ({ ...current, retentionMode: "manual" }))}
              >
                Manuel
              </button>
            </div>

            <div className="provision-grid">
              <label className="provision-field">
                <span className="provision-field-label">Jours</span>
                <input
                  className="provision-input"
                  type="number"
                  min={0}
                  value={planForm.retentionDays}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      retentionMode: "manual",
                      retentionDays: Number.parseInt(event.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">Semaines</span>
                <input
                  className="provision-input"
                  type="number"
                  min={0}
                  value={planForm.retentionWeeks}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      retentionMode: "manual",
                      retentionWeeks: Number.parseInt(event.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">Mois</span>
                <input
                  className="provision-input"
                  type="number"
                  min={0}
                  value={planForm.retentionMonths}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      retentionMode: "manual",
                      retentionMonths: Number.parseInt(event.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
              <label className="provision-field">
                <span className="provision-field-label">Années</span>
                <input
                  className="provision-input"
                  type="number"
                  min={0}
                  value={planForm.retentionYears}
                  onChange={(event) =>
                    setPlanForm((current) => ({
                      ...current,
                      retentionMode: "manual",
                      retentionYears: Number.parseInt(event.target.value || "0", 10) || 0,
                    }))
                  }
                />
              </label>
            </div>

            <div className="hint-box">
              <p className="muted">
                Politique retenue:{" "}
                <strong>
                  {formatRetentionPolicy(
                    {
                      days: planForm.retentionDays,
                      weeks: planForm.retentionWeeks,
                      months: planForm.retentionMonths,
                      years: planForm.retentionYears,
                    },
                    planForm.retentionMode,
                  )}
                </strong>
              </p>
            </div>

            <div className="provision-actions">
              <button className="action-btn primary" type="submit" disabled={busy}>
                {busy ? "Enregistrement..." : planForm.id ? "Mettre à jour le plan" : "Créer le plan"}
              </button>
              <button className="action-btn" type="button" onClick={resetPlanForm} disabled={busy}>
                Réinitialiser
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Plans existants</h2>
            <span className="muted">{config?.plans.length ?? 0} plan(s)</span>
          </div>
          <div className="mini-list">
            {(config?.plans ?? []).map((plan) => (
              <article key={plan.id} className="mini-list-item">
                <div>
                  <div className="item-title">
                    {plan.name}
                    <span className={`inventory-badge ${plan.enabled ? "status-running" : "status-stopped"}`}>
                      {plan.enabled ? "Actif" : "Pause"}
                    </span>
                  </div>
                  <div className="item-subtitle">
                    {plan.scope === "all"
                      ? "Toutes VM/CT"
                      : `${plan.workloadIds.length} workload(s) sélectionnée(s)`}{" "}
                    • {formatRecurrenceLabel(plan.recurrenceEvery, plan.recurrenceUnit)} •{" "}
                    {formatRetentionPolicy(
                      {
                        days: plan.retentionDays,
                        weeks: plan.retentionWeeks,
                        months: plan.retentionMonths,
                        years: plan.retentionYears,
                      },
                      plan.retentionMode,
                    )}
                    {plan.backupStorage ? ` • storage ${plan.backupStorage}` : ""}
                  </div>
                </div>
                <div className="backup-plan-actions">
                  <button type="button" className="action-btn" onClick={() => void onRunNow(plan.id)} disabled={busy || !plan.enabled}>
                    Lancer
                  </button>
                  <button type="button" className="action-btn" onClick={() => populatePlanForm(plan)}>
                    Modifier
                  </button>
                  <button type="button" className="action-btn" onClick={() => void onDeletePlan(plan.id)}>
                    Supprimer
                  </button>
                </div>
              </article>
            ))}
            {(config?.plans ?? []).length === 0 ? (
              <div className="hint-box">
                <p className="muted">Aucun plan configuré.</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
      ) : null}

      {showTargetsPanel ? (
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Backup local Proxmox</h2>
            <span className="muted">
              {localStorages.length > 0 ? `${localStorages.length} stockage(s) détecté(s)` : "Aucun stockage détecté"}
            </span>
          </div>

          <div className="hint-box">
            <div className="item-title">Parcours local recommandé</div>
            <div className="item-subtitle">
              1) Choisis un stockage local ci-dessous • 2) Crée le plan • 3) Vérifie l’historique des runs.
            </div>
            <div className="quick-actions">
              <button type="button" className="action-btn" onClick={() => setActiveTab("plans")}>
                Créer un plan local
              </button>
            </div>
          </div>

          <div className="mini-list">
            {localStorages.length === 0 ? (
              <div className="backup-empty-note">
                <p className="muted">Aucun stockage backup local détecté sur Proxmox.</p>
              </div>
            ) : (
              localStorages.map((storage) => (
                <article key={storage.id} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {storage.storage}
                      <span className="item-subtitle">{storage.node ? ` • ${storage.node}` : " • cluster"}</span>
                    </div>
                    <div className="item-subtitle">
                      {formatBytes(storage.usedBytes)} / {formatBytes(storage.totalBytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => chooseLocalStorageForPlan(storage.storage)}
                  >
                    Utiliser pour un plan local
                  </button>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Extension cloud backup</h2>
            <span className="muted">Secrets chiffrés au repos</span>
          </div>

          <form className="provision-panel" onSubmit={onSaveCloudTarget}>
            <div className="provision-field">
              <span className="provision-field-label">Provider cloud</span>
              <select
                className="provision-input"
                value={targetProviderSelection}
                onChange={(event) => {
                  const provider = event.target.value as BackupCloudProviderChoice;
                  setTargetProviderSelection(provider);
                  setTargetForm((current) => ({
                    ...current,
                    provider: provider || current.provider,
                    settings: current.settings.encryptupload
                      ? { encryptupload: current.settings.encryptupload }
                      : ({} as Record<string, string>),
                    secrets: current.secrets.encryptionpassphrase
                      ? { encryptionpassphrase: current.secrets.encryptionpassphrase }
                      : ({} as Record<string, string>),
                  }));
                }}
              >
                {CLOUD_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.id || "none"} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {!selectedTargetProvider ? (
              <div className="hint-box">
                <p className="muted">
                  Choisis d’abord une cible cloud. Le formulaire détaillé s’ouvre uniquement après sélection.
                </p>
              </div>
            ) : null}

            {selectedTargetProvider ? (
              <>
                <div className="provision-grid">
                  <label className="provision-field">
                    <span className="provision-field-label">Nom de la cible</span>
                    <input
                      className="provision-input"
                      value={targetForm.name}
                      onChange={(event) => setTargetForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Cloud cold storage"
                      required
                    />
                  </label>
                </div>

                <label className="provision-check">
                  <input
                    type="checkbox"
                    checked={targetForm.enabled}
                    onChange={(event) =>
                      setTargetForm((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  Cible activée
                </label>

            {selectedTargetProvider === "onedrive" || selectedTargetProvider === "gdrive" ? (
              <div className="hint-box">
                <p className="muted">
                  {selectedTargetProvider === "onedrive"
                    ? cloudOauthMode === "central"
                      ? "Connexion OneDrive via le service central ProxmoxCenter. Clique, connecte-toi à Microsoft, autorise l'accès, puis choisis le dossier."
                      : "Connexion OneDrive locale. Configure une fois le client OAuth, puis connecte-toi à Microsoft et choisis le dossier."
                    : cloudOauthMode === "central"
                      ? "Connexion Google Drive via le service central ProxmoxCenter. Clique, connecte-toi à Google, autorise l'accès, puis choisis le dossier."
                      : "Connexion Google Drive locale. Configure une fois le client OAuth, puis connecte-toi à Google et choisis le dossier."}
                </p>
                {!currentProviderOauthReady ? (
                  <>
                    <p className="muted">
                      {cloudOauthMode === "central"
                        ? "Le broker OAuth ProxmoxCenter n'est pas encore disponible sur cette instance."
                        : "Le client OAuth n'est pas encore configuré."}
                    </p>
                    {cloudOauthMode === "local" ? (
                      <div className="setup-actions">
                        <Link className="action-btn" href="/settings?tab=proxmox">
                          Configurer OneDrive / Google Drive
                        </Link>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="quick-actions">
                  {selectedTargetProvider === "onedrive" ? (
                    <button
                      type="button"
                      className="action-btn"
                      onClick={onConnectOneDrive}
                      disabled={
                        oneDriveOauthBusy ||
                        busy ||
                        !currentProviderOauthReady ||
                        (cloudOauthMode === "central" && !cloudOauthBrokerAvailable)
                      }
                    >
                      {oneDriveOauthBusy ? "Connexion OneDrive..." : "Connecter OneDrive"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => void onConnectGoogleDrive()}
                      disabled={
                        googleOauthBusy ||
                        busy ||
                        !currentProviderOauthReady ||
                        (cloudOauthMode === "central" && !cloudOauthBrokerAvailable)
                      }
                    >
                      {googleOauthBusy ? "Connexion Google Drive..." : "Connecter Google Drive"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setCloudFolderModalOpen(true)}
                    disabled={cloudFolderBusy || busy || !hasTargetRefreshToken}
                  >
                    {cloudFolderBusy ? "Lecture..." : "Choisir le dossier cloud"}
                  </button>
                </div>
                {currentCloudOauthStatus ? (
                  <p className="item-subtitle">
                    Etat connexion:{" "}
                    <span className={`inventory-badge ${getStatusBadgeClass(currentCloudOauthStatus.state)}`}>
                      {currentCloudOauthStatus.label}
                    </span>
                  </p>
                ) : null}
                <p className="item-subtitle">
                  Dossier courant:{" "}
                  <strong>
                    {selectedTargetProvider === "gdrive"
                      ? targetForm.settings.folderid || "non sélectionné"
                      : targetForm.settings.rootpath || "non sélectionné"}
                  </strong>
                </p>
                {cloudFolderError ? <p className="muted">{cloudFolderError}</p> : null}
              </div>
            ) : null}

            <div className="hint-box">
              <label className="provision-check">
                <input
                  type="checkbox"
                  checked={cloudEncryptionEnabled}
                  onChange={(event) =>
                    setTargetForm((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        encryptupload: event.target.checked ? "1" : "0",
                      },
                    }))
                  }
                />
                Chiffrer les sauvegardes avant envoi cloud
              </label>
              {cloudEncryptionEnabled ? (
                <div className="provision-grid">
                  <label className="provision-field">
                    <span className="provision-field-label">
                      Passphrase de chiffrement
                      <small>
                        Stockée chiffrée côté serveur. Nécessaire pour relire les sauvegardes cloud.
                      </small>
                    </span>
                    <input
                      className="provision-input"
                      type="password"
                      value={targetForm.secrets.encryptionpassphrase ?? ""}
                      onChange={(event) =>
                        setTargetForm((current) => ({
                          ...current,
                          secrets: {
                            ...current.secrets,
                            encryptionpassphrase: event.target.value,
                          },
                        }))
                      }
                      placeholder="Passphrase de chiffrement"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            {PROVIDER_SETTING_FIELDS[selectedTargetProvider].length > 0 ? (
              <div className="provision-grid">
                {PROVIDER_SETTING_FIELDS[selectedTargetProvider].map((field) => (
                  <label key={field.key} className="provision-field">
                    <span className="provision-field-label">{field.label}</span>
                    <input
                      className="provision-input"
                      value={targetForm.settings[field.key] ?? ""}
                      onChange={(event) =>
                        setTargetForm((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}
              </div>
            ) : null}

            {PROVIDER_SECRET_FIELDS[selectedTargetProvider].length > 0 ? (
              <div className="provision-grid">
                {PROVIDER_SECRET_FIELDS[selectedTargetProvider].map((field) => (
                  <label key={field.key} className="provision-field">
                    <span className="provision-field-label">
                      {field.label}
                      <small>
                        {targetForm.id
                          ? "Laisser vide pour conserver le secret existant."
                          : "Stocké chiffré côté serveur."}
                      </small>
                    </span>
                    <input
                      className="provision-input"
                      type="password"
                      value={targetForm.secrets[field.key] ?? ""}
                      onChange={(event) =>
                        setTargetForm((current) => ({
                          ...current,
                          secrets: {
                            ...current.secrets,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}
              </div>
            ) : null}

            <div className="provision-actions">
              <button className="action-btn primary" type="submit" disabled={busy}>
                {busy ? "Enregistrement..." : targetForm.id ? "Mettre à jour la cible" : "Créer la cible"}
              </button>
              <button className="action-btn" type="button" onClick={resetTargetForm} disabled={busy}>
                Réinitialiser
              </button>
            </div>
              </>
            ) : null}
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Cibles cloud</h2>
            <span className="muted">{cloudTargets.length} cible(s)</span>
          </div>

          <div className="mini-list">
            {cloudTargets.map((target) => (
              <article key={target.id} className="mini-list-item">
                <div>
                  {(() => {
                    const connection = getCloudTargetConnectionState(target, spaceByTarget[target.id]);
                    return (
                      <>
                  <div className="item-title">
                    {target.name}
                    <span className={`inventory-badge ${target.enabled ? "status-running" : "status-stopped"}`}>
                      {target.enabled ? "Actif" : "Off"}
                    </span>
                    <span className={`inventory-badge ${getStatusBadgeClass(connection.state)}`}>
                      {connection.label}
                    </span>
                  </div>
                  <div className="item-subtitle">
                    {PROVIDER_LABEL[target.provider]} • {Object.keys(target.secretState).length} secret(s) configuré(s)
                  </div>
                  <div className="item-subtitle">{connection.detail}</div>
                  <div className="item-subtitle">
                    Chiffrement cloud: {isEnabledSetting(target.settings.encryptupload) ? "activé" : "désactivé"}
                  </div>
                  {spaceByTarget[target.id] ? (
                    <div className="backup-space-block">
                      <div className="backup-space-line">
                        <strong>{formatBytes(spaceByTarget[target.id].usedBytes)}</strong>
                        <span>
                          {spaceByTarget[target.id].totalBytes !== null
                            ? `/ ${formatBytes(spaceByTarget[target.id].totalBytes)}`
                            : "/ quota non définie"}
                        </span>
                        {spaceByTarget[target.id].freeBytes !== null ? (
                          <em>reste {formatBytes(spaceByTarget[target.id].freeBytes)}</em>
                        ) : null}
                      </div>
                      <div className="backup-space-meter" aria-hidden>
                        <span
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min((spaceByTarget[target.id].usageRatio ?? 0) * 100, 100),
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="item-subtitle">
                        {spaceByTarget[target.id].source}
                        {spaceByTarget[target.id].error
                          ? ` • ${spaceByTarget[target.id].error}`
                          : ""}
                      </div>
                    </div>
                  ) : null}
                  <div className="backup-target-meta">
                    {getVisibleCloudTargetSettings(target).map(({ key, value }) => (
                        <span key={`${target.id}-${key}`} className="inventory-tag">
                          {key}: {value}
                        </span>
                      ))}
                  </div>
                      </>
                    );
                  })()}
                </div>
                <div className="backup-plan-actions">
                  <button type="button" className="action-btn" onClick={() => chooseCloudTargetForPlan(target.id)}>
                    Utiliser dans un plan
                  </button>
                  <button type="button" className="action-btn" onClick={() => populateTargetForm(target)}>
                    Modifier
                  </button>
                  <button type="button" className="action-btn" onClick={() => void onDeleteCloudTarget(target.id)}>
                    Supprimer
                  </button>
                </div>
              </article>
            ))}
            {cloudTargets.length === 0 ? (
              <div className="hint-box">
                <p className="muted">Aucune cible cloud configurée.</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
      ) : null}

      {activeTab === "history" ? (
      <section className="panel">
        <div className="panel-head">
          <h2>Historique d’exécution</h2>
          <span className="muted">
            {filteredExecutions.length} affiché(s) / {executions.length}
          </span>
        </div>
        <div className="provision-segment">
          <button
            type="button"
            className={`provision-seg-btn${historyFilter === "all" ? " is-active" : ""}`}
            onClick={() => setHistoryFilter("all")}
          >
            Tous
          </button>
          <button
            type="button"
            className={`provision-seg-btn${historyFilter === "running" ? " is-active" : ""}`}
            onClick={() => setHistoryFilter("running")}
          >
            Running
          </button>
          <button
            type="button"
            className={`provision-seg-btn${historyFilter === "queued" ? " is-active" : ""}`}
            onClick={() => setHistoryFilter("queued")}
          >
            Queued
          </button>
          <button
            type="button"
            className={`provision-seg-btn${historyFilter === "failed" ? " is-active" : ""}`}
            onClick={() => setHistoryFilter("failed")}
          >
            Failed
          </button>
          <button
            type="button"
            className={`provision-seg-btn${historyFilter === "cancelled" ? " is-active" : ""}`}
            onClick={() => setHistoryFilter("cancelled")}
          >
            Cancelled
          </button>
        </div>
        <div className="mini-list">
          {filteredExecutions.slice(0, 15).map((execution) => (
            <article key={execution.id} className="mini-list-item">
              <div>
                <div className="item-title">
                  {execution.planName}
                  <span className={`inventory-badge ${getExecutionBadgeClass(execution.status)}`}>
                    {formatExecutionState(execution.status)}
                  </span>
                  {execution.cancelRequested ? (
                    <span className="inventory-badge status-template">Annulation demandée</span>
                  ) : null}
                </div>
                <div className="item-subtitle">
                  Slot: {execution.scheduledAt} • Steps: {execution.steps.length}
                </div>
                {execution.summary ? <div className="item-subtitle">{execution.summary}</div> : null}
              </div>
              <div className="backup-plan-actions">
                {(execution.status === "running" || execution.status === "queued") ? (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => void onCancelExecution(execution.id)}
                    disabled={busy || execution.cancelRequested}
                  >
                    {execution.cancelRequested ? "Annulation..." : "Annuler"}
                  </button>
                ) : null}
              </div>
              <div className="backup-target-meta">
                {execution.steps.slice(0, 3).map((step) => (
                  <span key={`${execution.id}-${step.workloadId}`} className="inventory-tag">
                    {step.workloadId} • {step.status}
                    {step.sync.provider ? ` • sync ${step.sync.status}` : ""}
                  </span>
                ))}
              </div>
            </article>
          ))}
          {filteredExecutions.length === 0 ? (
            <div className="hint-box">
              <p className="muted">Aucune exécution pour ce filtre.</p>
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {activeTab === "restore" ? (
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Run backup actif</h2>
            <span className="muted">Exécution en cours</span>
          </div>
          {runningExecution ? (
            <div className="mini-list">
              <article className="mini-list-item">
                <div>
                  <div className="item-title">
                    {runningExecution.planName}
                    <span className={`inventory-badge ${getExecutionBadgeClass(runningExecution.status)}`}>
                      {formatExecutionState(runningExecution.status)}
                    </span>
                    {runningExecution.cancelRequested ? (
                      <span className="inventory-badge status-template">Annulation demandée</span>
                    ) : null}
                  </div>
                  <div className="item-subtitle">
                    Démarré {formatScheduleDate(runningExecution.startedAt)} • {runningExecution.steps.length} étape(s)
                  </div>
                </div>
                <div className="backup-plan-actions">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => void onCancelExecution(runningExecution.id)}
                    disabled={busy || runningExecution.cancelRequested}
                  >
                    {runningExecution.cancelRequested ? "Annulation..." : "Annuler"}
                  </button>
                </div>
              </article>
            </div>
          ) : (
            <div className="backup-empty-note">
              <p className="muted">Aucun run backup en cours.</p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Restauration depuis le cloud</h2>
            <span className="muted">Téléchargement, restore Proxmox ou import direct PBS</span>
          </div>

          {restoreError ? (
            <div className="backup-alert error">
              <strong>Erreur</strong>
              <p>{restoreError}</p>
            </div>
          ) : null}
          {restoreNotice ? (
            <div className="backup-alert info">
              <strong>Info</strong>
              <p>{restoreNotice}</p>
            </div>
          ) : null}

          <div className="provision-grid">
            {pbsStatus?.configured ? (
              <label className="provision-field">
                <span className="provision-field-label">Destination</span>
                <select
                  className="provision-input"
                  value={restoreForm.destination}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      destination: event.target.value === "pbs" ? "pbs" : "proxmox",
                    }))
                  }
                >
                  <option value="proxmox">Restore vers VM / CT Proxmox</option>
                  <option value="pbs">Réhydrater vers PBS / stockage backup</option>
                </select>
              </label>
            ) : (
              <div className="hint-box">
                <div className="item-title">Destination</div>
                <div className="item-subtitle">Restore vers VM / CT Proxmox</div>
              </div>
            )}

            <label className="provision-field">
              <span className="provision-field-label">Cible cloud</span>
              <select
                className="provision-input"
                value={restoreForm.targetId}
                onChange={(event) =>
                  setRestoreForm((current) => ({
                    ...current,
                    targetId: event.target.value,
                  }))
                }
              >
                <option value="">Sélectionner une cible</option>
                {cloudTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} ({PROVIDER_LABEL[target.provider]})
                  </option>
                ))}
              </select>
            </label>

            {restoreForm.destination === "proxmox" ? (
              <label className="provision-field">
                <span className="provision-field-label">Nœud cible</span>
                <select
                  className="provision-input"
                  value={restoreForm.node}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      node: event.target.value,
                    }))
                  }
                >
                  <option value="">Sélectionner un nœud</option>
                  {restoreNodeOptions.map((node) => (
                    <option key={node} value={node}>
                      {node}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="hint-box">
                <div className="item-title">Import PBS direct</div>
                <div className="item-subtitle">
                  {pbsStatus?.configured && pbsStatus.runtimeSaved
                    ? `${pbsStatus.runtimeSaved.host}:${pbsStatus.runtimeSaved.port} · datastore ${pbsStatus.runtimeSaved.datastore}${pbsStatus.runtimeSaved.namespace ? ` · namespace ${pbsStatus.runtimeSaved.namespace}` : ""}`
                    : "Connexion PBS directe non configurée."}
                </div>
                {pbsStatus?.tooling && !pbsStatus.tooling.available ? (
                  <div className="item-subtitle">{pbsStatus.tooling.error ?? "Tooling PBS absent."}</div>
                ) : null}
              </div>
            )}
          </div>

          <div className="quick-actions">
            <button
              type="button"
              className="action-btn"
              onClick={() => void onLoadCloudObjects()}
              disabled={restoreBusy || !restoreForm.targetId}
            >
              {restoreBusy ? "Chargement..." : "Lister les backups cloud"}
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => void onDownloadCloudBackup()}
              disabled={restoreBusy || !restoreForm.targetId || !restoreForm.objectKey}
            >
              Télécharger déchiffré
            </button>
          </div>

          <div className="hint-box">
            <div className="backup-restore-list">
              {cloudObjects.map((object) => (
                <button
                  key={`${restoreForm.targetId}-${object.key}`}
                  type="button"
                  className={`backup-restore-item${restoreForm.objectKey === object.key ? " is-active" : ""}`}
                  onClick={() => {
                    const inferred = inferRestoreHintsFromObject(object);
                    setRestoreForm((current) => ({
                      ...current,
                      objectKey: object.key,
                      kind: inferred.kind,
                      vmid: current.vmid || inferred.vmid,
                    }));
                  }}
                >
                  <div>
                    <strong>{object.name}</strong>
                    <div className="item-subtitle">
                      {formatBytes(object.sizeBytes)} • {object.updatedAt ? formatScheduleDate(object.updatedAt) : "date inconnue"}
                    </div>
                  </div>
                  <div className="backup-target-meta">
                    {object.encrypted ? <span className="inventory-badge status-pending">chiffré</span> : null}
                    {object.suggestedKind ? (
                      <span className="inventory-badge status-template">
                        {object.suggestedKind.toUpperCase()} #{object.suggestedVmid ?? "?"}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
              {cloudObjects.length === 0 ? (
                <p className="muted">Aucun objet cloud chargé pour le moment.</p>
              ) : null}
            </div>
          </div>

          <div className="provision-grid">
            {restoreForm.destination === "proxmox" ? (
              <label className="provision-field">
                <span className="provision-field-label">Type restore</span>
                <select
                  className="provision-input"
                  value={restoreForm.kind}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      kind: event.target.value === "lxc" ? "lxc" : "qemu",
                    }))
                  }
                >
                  <option value="qemu">VM (QEMU)</option>
                  <option value="lxc">LXC / CT</option>
                </select>
              </label>
            ) : null}

            {restoreForm.destination === "proxmox" ? (
              <label className="provision-field">
                <span className="provision-field-label">VMID cible</span>
                <input
                  className="provision-input"
                  value={restoreForm.vmid}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      vmid: event.target.value,
                    }))
                  }
                  inputMode="numeric"
                  placeholder="200"
                />
              </label>
            ) : null}

            {restoreForm.destination === "proxmox" ? (
              <label className="provision-field">
                <span className="provision-field-label">Stockage import backup</span>
                <select
                  className="provision-input"
                  value={restoreForm.backupStorage}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      backupStorage: event.target.value,
                    }))
                  }
                >
                  <option value="">Sélectionner</option>
                  {restoreStorageOptions.map((storage) => (
                    <option key={`backup-${storage}`} value={storage}>
                      {storage}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {restoreForm.destination === "proxmox" ? (
              <label className="provision-field">
                <span className="provision-field-label">Stockage restore (optionnel)</span>
                <input
                  className="provision-input"
                  value={restoreForm.restoreStorage}
                  onChange={(event) =>
                    setRestoreForm((current) => ({
                      ...current,
                      restoreStorage: event.target.value,
                    }))
                  }
                  placeholder="local-lvm / ceph-vm"
                />
              </label>
            ) : null}
          </div>

          {restoreForm.destination === "proxmox" ? (
            <label className="provision-check">
              <input
                type="checkbox"
                checked={restoreForm.force}
                onChange={(event) =>
                  setRestoreForm((current) => ({
                    ...current,
                    force: event.target.checked,
                  }))
                }
              />
              Forcer si le VMID existe déjà
            </label>
          ) : null}

          <div className="provision-actions">
            <button
              type="button"
              className="action-btn primary"
              onClick={() => void onRestoreFromCloud()}
              disabled={
                restoreBusy ||
                !restoreForm.targetId ||
                !restoreForm.objectKey ||
                (restoreForm.destination === "proxmox" &&
                  (!restoreForm.node || !restoreForm.backupStorage || !restoreForm.vmid)) ||
                (restoreForm.destination === "pbs" && !pbsStatus?.configured)
              }
            >
              {restoreBusy
                ? "Préparation..."
                : restoreForm.destination === "pbs"
                  ? "Importer vers PBS direct"
                  : "Restaurer vers Proxmox"}
            </button>
            {restoreJob?.state === "running" ? (
              <button
                type="button"
                className="action-btn"
                onClick={() => void onCancelRestoreJob(restoreJob.id)}
                disabled={restoreCancelBusy || restoreBusy}
              >
                {restoreCancelBusy ? "Annulation..." : "Annuler le job"}
              </button>
            ) : null}
          </div>

          {restoreTarget ? (
            <p className="muted">
              Cible choisie: <strong>{restoreTarget.name}</strong>{" "}
              {restoreSelectedObject ? `• objet ${restoreSelectedObject.name}` : ""}
            </p>
          ) : null}

          {restoreJob ? (
            <div className="backup-job-stack">
              <div className="backup-job-head">
                <strong>Suivi détaillé</strong>
                <span
                  className={`inventory-badge status-${
                    restoreJob.state === "success"
                      ? "running"
                      : restoreJob.state === "failed" || restoreJob.state === "cancelled"
                        ? "stopped"
                        : "pending"
                  }`}
                >
                  {formatRestoreState(restoreJob.state)}
                </span>
              </div>

              <div className="backup-job-grid">
                <article className="hint-box">
                  <div className="item-title">{formatRestorePhase(restoreJob.phase)}</div>
                  <div className="item-subtitle">{restoreJob.message ?? "Traitement en cours."}</div>
                </article>
                <article className="hint-box">
                  <div className="item-title">Objet</div>
                  <div className="item-subtitle">{restoreJob.filename ?? restoreJob.objectName ?? "—"}</div>
                </article>
                <article className="hint-box">
                  <div className="item-title">Stockage</div>
                  <div className="item-subtitle">{restoreJob.backupStorage}</div>
                </article>
                <article className="hint-box">
                  <div className="item-title">Job</div>
                  <div className="item-subtitle">{restoreJob.id}</div>
                </article>
              </div>

              <div className="backup-job-task-grid">
                <article className="hint-box">
                  <div className="backup-job-task-head">
                    <strong>Import</strong>
                    <span className="muted">{restoreJob.importTask.upid ?? "en attente"}</span>
                  </div>
                  <div className="inventory-progress inventory-progress-wide" aria-hidden>
                    <span
                      className="tone-orange"
                      style={{ width: `${restoreJob.importTask.progressPercent ?? (restoreJob.importTask.status === "success" ? 100 : 8)}%` }}
                    />
                  </div>
                  <div className="item-subtitle">
                    {restoreJob.importTask.currentLine ?? "Pas encore démarré."}
                  </div>
                  {restoreJob.importTask.lines.length > 0 ? (
                    <div className="backup-job-log">
                      {restoreJob.importTask.lines.map((line, index) => (
                        <div key={`${restoreJob.id}-import-${index}`}>{line}</div>
                      ))}
                    </div>
                  ) : null}
                </article>

                {restoreJob.destination === "proxmox" ? (
                  <article className="hint-box">
                    <div className="backup-job-task-head">
                      <strong>Restore</strong>
                      <span className="muted">{restoreJob.restoreTask.upid ?? "en attente"}</span>
                    </div>
                    <div className="inventory-progress inventory-progress-wide" aria-hidden>
                      <span
                        className="tone-green"
                        style={{ width: `${restoreJob.restoreTask.progressPercent ?? (restoreJob.restoreTask.status === "success" ? 100 : 8)}%` }}
                      />
                    </div>
                    <div className="item-subtitle">
                      {restoreJob.restoreTask.currentLine ?? "Pas encore démarré."}
                    </div>
                    {restoreJob.restoreTask.lines.length > 0 ? (
                      <div className="backup-job-log">
                        {restoreJob.restoreTask.lines.map((line, index) => (
                          <div key={`${restoreJob.id}-restore-${index}`}>{line}</div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ) : null}
              </div>

              {restoreJob.stagedBackupVolid ? (
                <div className="item-subtitle">
                  {restoreJob.destination === "pbs" ? "Snapshot PBS" : "Archive importée"}: {restoreJob.stagedBackupVolid}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="backup-job-history">
            <div className="panel-head">
              <h2>Historique complet des jobs restore</h2>
              <span className="muted">{restoreHistory.length} job(s)</span>
            </div>
            <div className="mini-list">
              {restoreHistory.map((job) => (
                <article key={job.id} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {job.destination === "pbs" ? "PBS direct" : `${job.kind?.toUpperCase() ?? "VM"} #${job.vmid ?? "?"}`}
                    </div>
                    <div className="item-subtitle">
                      {job.filename ?? job.objectName ?? job.objectKey}
                    </div>
                    <div className="item-subtitle">
                      Début {formatScheduleDate(job.startedAt)}
                      {job.finishedAt ? ` • Fin ${formatScheduleDate(job.finishedAt)}` : ""}
                    </div>
                    <div className="item-subtitle">
                      {formatRestorePhase(job.phase)} • {job.backupStorage}
                    </div>
                    {job.message ? <div className="item-subtitle">{job.message}</div> : null}
                    {job.error ? <div className="item-subtitle status-bad">{job.error}</div> : null}
                  </div>
                  <div className="backup-target-meta">
                    <span
                      className={`inventory-badge status-${
                        job.state === "success"
                          ? "running"
                          : job.state === "failed" || job.state === "cancelled"
                            ? "stopped"
                            : "pending"
                      }`}
                    >
                      {formatRestoreState(job.state)}
                    </span>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={() => {
                        setRestoreJob(job);
                        setRestoreJobId(job.id);
                        setRestoreError(null);
                        setRestoreNotice(null);
                      }}
                    >
                      Suivre
                    </button>
                  </div>
                </article>
              ))}
              {restoreHistory.length === 0 ? (
                <div className="hint-box">
                  <p className="muted">Aucun job restore enregistré.</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Pré-requis restore</h2>
            <span className="muted">Points de contrôle</span>
          </div>
          <div className="mini-list">
            <article className="mini-list-item">
              <div>
                <div className="item-title">Cible cloud accessible</div>
                <div className="item-subtitle">
                  Le token doit être valide et le quota accessible.
                </div>
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Passphrase présente</div>
                <div className="item-subtitle">
                  Nécessaire si l’objet cloud est en `.pxenc`.
                </div>
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Connexion PBS ou Proxmox valide</div>
                <div className="item-subtitle">
                  Restore Proxmox: l’app doit être joignable depuis Proxmox. Restore PBS: la connexion PBS directe doit être configurée.
                </div>
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Cible finale</div>
                <div className="item-subtitle">
                  Proxmox: stockage backup temporaire. PBS: datastore direct configuré dans Paramètres.
                </div>
              </div>
            </article>
          </div>
        </section>
      </section>
      ) : null}

      {activeTab === "pbs" ? (
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Navigateur PBS direct</h2>
            <span className="muted">
              {pbsStatus?.configured && pbsStatus.runtimeSaved
                ? `${pbsStatus.runtimeSaved.host}:${pbsStatus.runtimeSaved.port} · ${pbsStatus.runtimeSaved.datastore}`
                : "Connexion PBS requise"}
            </span>
          </div>

          {pbsError ? (
            <div className="backup-alert error">
              <strong>Erreur</strong>
              <p>{pbsError}</p>
            </div>
          ) : null}
          {pbsNotice ? (
            <div className="backup-alert info">
              <strong>Info</strong>
              <p>{pbsNotice}</p>
            </div>
          ) : null}

          <div className="provision-grid">
            <label className="provision-field">
              <span className="provision-field-label">Namespace PBS</span>
              <select
                className="provision-input"
                value={pbsNamespace}
                onChange={(event) => void onSelectPbsNamespace(event.target.value)}
                disabled={pbsBusy || !pbsStatus?.configured}
              >
                <option value="">Racine</option>
                {pbsNamespaces.map((item) => (
                  <option key={item.id} value={item.path}>
                    {item.name || "Racine"}
                  </option>
                ))}
              </select>
            </label>

            <div className="hint-box">
              <div className="item-title">Tooling</div>
              <div className="item-subtitle">
                {pbsStatus?.tooling?.available
                  ? pbsStatus.tooling.version ?? "proxmox-backup-client disponible"
                  : pbsStatus?.tooling?.error ?? "Tooling PBS indisponible"}
              </div>
            </div>
          </div>

          <div className="quick-actions">
            <button
              type="button"
              className="action-btn"
              onClick={() => void onRefreshPbsBrowser()}
              disabled={pbsBusy || !pbsStatus?.configured}
            >
              {pbsBusy ? "Chargement..." : "Actualiser PBS"}
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => void onPreparePbsArchiveDownload()}
              disabled={pbsBusy || !pbsStatus?.configured || !pbsSelectedSnapshot || !pbsSelectedArchive}
            >
              Préparer téléchargement
            </button>
          </div>

          <div className="content-grid backup-overview-grid">
            <section className="hint-box">
              <div className="panel-head">
                <h3 className="subsection-title">Groupes</h3>
                <span className="muted">{pbsGroups.length}</span>
              </div>
              <div className="mini-list">
                {pbsGroups.map((group) => (
                  <article key={group.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{group.label}</div>
                      <div className="item-subtitle">
                        {group.lastBackupAt ? `Dernier backup ${formatScheduleDate(group.lastBackupAt)}` : "Date inconnue"}
                      </div>
                      {group.comment ? <div className="item-subtitle">{group.comment}</div> : null}
                    </div>
                    <div className="backup-plan-actions">
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => void onOpenPbsGroup(group.path)}
                        disabled={pbsBusy}
                      >
                        Ouvrir
                      </button>
                    </div>
                  </article>
                ))}
                {pbsGroups.length === 0 ? (
                  <div className="backup-empty-note">
                    <p className="muted">Aucun groupe PBS chargé.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="hint-box">
              <div className="panel-head">
                <h3 className="subsection-title">Snapshots</h3>
                <span className="muted">{pbsSnapshots.length}</span>
              </div>
              {selectedPbsGroup ? <p className="item-subtitle">{selectedPbsGroup.label}</p> : null}
              <div className="mini-list">
                {pbsSnapshots.map((snapshot) => (
                  <article key={snapshot.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{snapshot.label}</div>
                      <div className="item-subtitle">
                        {snapshot.backupTime ? formatScheduleDate(snapshot.backupTime) : "Horodatage inconnu"}
                        {snapshot.sizeBytes !== null ? ` • ${formatBytes(snapshot.sizeBytes)}` : ""}
                      </div>
                    </div>
                    <div className="backup-plan-actions">
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => void onOpenPbsSnapshot(snapshot.path)}
                        disabled={pbsBusy}
                      >
                        Voir archives
                      </button>
                    </div>
                  </article>
                ))}
                {pbsSnapshots.length === 0 ? (
                  <div className="backup-empty-note">
                    <p className="muted">Choisis un groupe PBS pour lister ses snapshots.</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="hint-box">
              <div className="panel-head">
                <h3 className="subsection-title">Archives</h3>
                <span className="muted">{pbsFiles.length}</span>
              </div>
              {selectedPbsSnapshot ? <p className="item-subtitle">{selectedPbsSnapshot.path}</p> : null}
              <div className="backup-restore-list">
                {pbsFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className={`backup-restore-item${pbsSelectedArchive === file.archiveName ? " is-active" : ""}`}
                    onClick={() => setPbsSelectedArchive(file.archiveName)}
                  >
                    <div>
                      <strong>{file.name}</strong>
                      <div className="item-subtitle">
                        {file.sizeBytes !== null ? formatBytes(file.sizeBytes) : "taille inconnue"}
                      </div>
                    </div>
                    <div className="backup-target-meta">
                      {file.cryptMode ? (
                        <span className="inventory-badge status-template">{file.cryptMode}</span>
                      ) : null}
                    </div>
                  </button>
                ))}
                {pbsFiles.length === 0 ? (
                  <p className="muted">Choisis un snapshot pour voir ses archives.</p>
                ) : null}
              </div>
            </section>
          </div>

          <div className="hint-box">
            <div className="item-title">Extraction PBS</div>
            <div className="item-subtitle">
              L’action prépare un téléchargement web à partir de l’archive PBS sélectionnée.
            </div>
            {selectedPbsFile ? (
              <div className="item-subtitle">
                Archive choisie: <strong>{selectedPbsFile.name}</strong>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>État PBS</h2>
            <span className="muted">Direct client</span>
          </div>
          <div className="mini-list">
            <article className="mini-list-item">
              <div>
                <div className="item-title">Connexion runtime</div>
                <div className="item-subtitle">
                  {pbsStatus?.configured && pbsStatus.runtimeSaved
                    ? `${pbsStatus.runtimeSaved.host}:${pbsStatus.runtimeSaved.port} • datastore ${pbsStatus.runtimeSaved.datastore}`
                    : "Non configurée"}
                </div>
                {pbsStatus?.runtimeSaved?.namespace ? (
                  <div className="item-subtitle">Namespace par défaut: {pbsStatus.runtimeSaved.namespace}</div>
                ) : null}
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Archive sélectionnée</div>
                <div className="item-subtitle">{selectedPbsFile?.name ?? "Aucune"}</div>
                {selectedPbsSnapshot ? (
                  <div className="item-subtitle">{selectedPbsSnapshot.path}</div>
                ) : null}
              </div>
            </article>
            <article className="mini-list-item">
              <div>
                <div className="item-title">Restauration VM/CT</div>
                <div className="item-subtitle">
                  Le navigateur PBS gère l’exploration et l’extraction. Les restores VM/CT complets restent pilotés depuis l’onglet restauration.
                </div>
              </div>
            </article>
          </div>
        </section>
      </section>
      ) : null}

      {cloudFolderModalOpen &&
      activeCloudFolder &&
      activeCloudFolderPath &&
      (selectedTargetProvider === "onedrive" || selectedTargetProvider === "gdrive") ? (
        <>
          <button
            type="button"
            className="logout-confirm-backdrop"
            aria-label="Fermer la sélection du dossier cloud"
            onClick={() => setCloudFolderModalOpen(false)}
          />
          <section className="logout-confirm-dialog backup-folder-modal" role="dialog" aria-modal="true">
            <div className="panel-head">
              <h2>Choisir le dossier cloud</h2>
              <span className="muted">{selectedTargetProvider === "onedrive" ? "OneDrive" : "Google Drive"}</span>
            </div>

            <div className="quick-actions">
              <button
                type="button"
                className="action-btn"
                onClick={() => onSelectCloudFolder(activeCloudFolder)}
                disabled={cloudFolderBusy}
              >
                Sélectionner ici
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={() => onOpenCloudFolderParent()}
                disabled={cloudFolderBusy || cloudFolderTrail.length === 0}
              >
                Retour
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={() => void onBrowseCloudFolders()}
                disabled={cloudFolderBusy}
              >
                {cloudFolderBusy ? "Lecture..." : "Actualiser"}
              </button>
            </div>

            <div className="item-subtitle">{activeCloudFolderPath}</div>

            <label className="provision-field">
              <span className="provision-field-label">Créer un dossier</span>
              <input
                className="provision-input"
                value={newCloudFolderName}
                onChange={(event) => setNewCloudFolderName(event.target.value)}
                placeholder={
                  selectedTargetProvider === "onedrive"
                    ? "Nom du dossier OneDrive"
                    : "Nom du dossier Google Drive"
                }
              />
            </label>

            <div className="quick-actions">
              <button
                type="button"
                className="action-btn"
                onClick={() => void onCreateCloudFolder()}
                disabled={cloudFolderBusy}
              >
                {cloudFolderBusy ? "Création..." : "Créer et sélectionner"}
              </button>
            </div>

            {cloudFolderError ? <p className="warning">{cloudFolderError}</p> : null}

            <div className="backup-restore-list backup-folder-list">
              {cloudFolders.map((folder) => (
                <div key={`${selectedTargetProvider}-${folder.id}`} className="backup-restore-item backup-folder-item">
                  <div>
                    <strong>{folder.name}</strong>
                    <div className="item-subtitle">{folder.value}</div>
                  </div>
                  <div className="backup-folder-actions">
                    <button type="button" className="action-btn" onClick={() => onOpenCloudFolder(folder)}>
                      Ouvrir
                    </button>
                    <button type="button" className="action-btn" onClick={() => onSelectCloudFolder(folder)}>
                      Choisir
                    </button>
                  </div>
                </div>
              ))}
              {cloudFolders.length === 0 && !cloudFolderBusy ? (
                <p className="muted">Aucun sous-dossier ici.</p>
              ) : null}
            </div>

            <div className="provision-actions">
              <button type="button" className="action-btn" onClick={() => setCloudFolderModalOpen(false)}>
                Fermer
              </button>
            </div>
          </section>
        </>
      ) : null}

      <StrongConfirmDialog
        key={confirmRequest ? `${confirmRequest.kind}-${confirmRequest.expectedText}` : "backup-confirm-closed"}
        open={Boolean(confirmRequest)}
        title={confirmRequest?.title ?? "Confirmer l’action"}
        message={confirmRequest?.message ?? ""}
        expectedText={confirmRequest?.expectedText ?? "CONFIRM"}
        confirmLabel={confirmRequest?.kind === "restore" ? "Lancer" : "Confirmer"}
        busy={busy || restoreBusy}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={(confirmationText) => {
          void confirmPendingAction(confirmationText);
        }}
      />
    </section>
  );
}
