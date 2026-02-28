import "server-only";
import fs from "node:fs";
import path from "node:path";
import type {
  ProvisionDraft,
  ProvisionKind,
  WorkloadPowerAction,
} from "@/lib/provision/schema";

type AssistantActionMemory = {
  action: WorkloadPowerAction;
  kind: ProvisionKind;
  node: string;
  vmid: string;
  updatedAt: string;
};

export type AssistantMemory = {
  firstName: string | null;
  lastQuestions: string[];
  lastProvisionDraft: Partial<ProvisionDraft> | null;
  lastWorkloadAction: AssistantActionMemory | null;
  updatedAt: string;
};

const MAX_QUESTIONS = 12;

function getDefaultMemoryDir() {
  return path.join(process.cwd(), "data");
}

function sanitizeScope(scope: string | undefined) {
  if (!scope) return "default";
  const trimmed = scope.trim().toLowerCase();
  if (!trimmed) return "default";
  const safe = trimmed.replace(/[^a-z0-9._-]/g, "_").slice(0, 64);
  return safe || "default";
}

function getMemoryPath(scope?: string) {
  const custom = process.env.PROXCENTER_ASSISTANT_MEMORY_PATH?.trim();
  if (custom) return custom;
  const safeScope = sanitizeScope(scope);
  return path.join(getDefaultMemoryDir(), `assistant-memory.${safeScope}.json`);
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function asTrimmedString(value: unknown, maxLength = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function sanitizeQuestion(value: unknown) {
  return asTrimmedString(value, 280);
}

function sanitizeFirstName(value: unknown) {
  const first = asTrimmedString(value, 40);
  if (!first) return null;
  if (!/^[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ' -]*$/.test(first)) return null;
  return `${first[0]?.toUpperCase() ?? ""}${first.slice(1)}`;
}

function sanitizeVmid(value: unknown) {
  const raw = asTrimmedString(value, 12);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9_999_999) return null;
  return String(parsed);
}

function sanitizeNode(value: unknown) {
  const node = asTrimmedString(value, 63);
  if (!node) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(node)) return null;
  return node;
}

function sanitizeKind(value: unknown): ProvisionKind | null {
  return value === "qemu" || value === "lxc" ? value : null;
}

function sanitizeAction(value: unknown): WorkloadPowerAction | null {
  return value === "start" ||
    value === "stop" ||
    value === "shutdown" ||
    value === "reboot"
    ? value
    : null;
}

function sanitizeDraft(input: unknown): Partial<ProvisionDraft> | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const sanitized: Partial<ProvisionDraft> = {};

  const kind = sanitizeKind(source.kind);
  if (kind) sanitized.kind = kind;

  const simpleStringKeys: Array<keyof ProvisionDraft> = [
    "presetId",
    "node",
    "vmid",
    "name",
    "memoryMiB",
    "cores",
    "sockets",
    "diskGb",
    "storage",
    "bridge",
    "ostype",
    "cpuType",
    "isoSourceMode",
    "isoVolume",
    "isoUrl",
    "isoStorage",
    "isoFilename",
    "lxcTemplate",
    "lxcSwapMiB",
  ];

  for (const key of simpleStringKeys) {
    const value = asTrimmedString(source[key], 140);
    if (value) {
      sanitized[key] = value as never;
    }
  }

  if (source.bios === "ovmf" || source.bios === "seabios") {
    sanitized.bios = source.bios;
  }

  if (source.machine === "q35" || source.machine === "i440fx") {
    sanitized.machine = source.machine;
  }

  if (typeof source.enableAgent === "boolean") {
    sanitized.enableAgent = source.enableAgent;
  }

  if (typeof source.enableTpm === "boolean") {
    sanitized.enableTpm = source.enableTpm;
  }

  if (typeof source.lxcUnprivileged === "boolean") {
    sanitized.lxcUnprivileged = source.lxcUnprivileged;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeActionMemory(input: unknown): AssistantActionMemory | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const action = sanitizeAction(source.action);
  const kind = sanitizeKind(source.kind);
  const node = sanitizeNode(source.node);
  const vmid = sanitizeVmid(source.vmid);
  if (!action || !kind || !node || !vmid) return null;
  return {
    action,
    kind,
    node,
    vmid,
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim()
        ? source.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeMemory(input: unknown): AssistantMemory {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const firstName = sanitizeFirstName(source.firstName);
  const lastQuestions = Array.isArray(source.lastQuestions)
    ? source.lastQuestions
        .map((item) => sanitizeQuestion(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, MAX_QUESTIONS)
    : [];
  const lastProvisionDraft = sanitizeDraft(source.lastProvisionDraft);
  const lastWorkloadAction = sanitizeActionMemory(source.lastWorkloadAction);

  return {
    firstName,
    lastQuestions,
    lastProvisionDraft,
    lastWorkloadAction,
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim()
        ? source.updatedAt
        : new Date().toISOString(),
  };
}

export function readAssistantMemory(scope?: string) {
  const filePath = getMemoryPath(scope);
  if (!fs.existsSync(filePath)) {
    return normalizeMemory({});
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return normalizeMemory({});
    return normalizeMemory(JSON.parse(raw));
  } catch {
    return normalizeMemory({});
  }
}

function writeAssistantMemory(memory: AssistantMemory, scope?: string) {
  const filePath = getMemoryPath(scope);
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

export function resetAssistantMemory(scope?: string) {
  const filePath = getMemoryPath(scope);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function rememberAssistantQuestion(question: string, scope?: string) {
  const cleaned = sanitizeQuestion(question);
  if (!cleaned) return readAssistantMemory(scope);

  const current = readAssistantMemory(scope);
  const nextQuestions = [...current.lastQuestions, cleaned].slice(-MAX_QUESTIONS);
  const next: AssistantMemory = {
    ...current,
    lastQuestions: nextQuestions,
    updatedAt: new Date().toISOString(),
  };
  writeAssistantMemory(next, scope);
  return next;
}

export function rememberAssistantFirstName(firstName: string, scope?: string) {
  const cleaned = sanitizeFirstName(firstName);
  if (!cleaned) return readAssistantMemory(scope);

  const current = readAssistantMemory(scope);
  const next: AssistantMemory = {
    ...current,
    firstName: cleaned,
    updatedAt: new Date().toISOString(),
  };
  writeAssistantMemory(next, scope);
  return next;
}

export function rememberAssistantProvisionDraft(draft: Partial<ProvisionDraft>, scope?: string) {
  const cleaned = sanitizeDraft(draft);
  if (!cleaned) return readAssistantMemory(scope);

  const current = readAssistantMemory(scope);
  const next: AssistantMemory = {
    ...current,
    lastProvisionDraft: cleaned,
    updatedAt: new Date().toISOString(),
  };
  writeAssistantMemory(next, scope);
  return next;
}

export function rememberAssistantWorkloadAction(input: {
  action: WorkloadPowerAction;
  kind: ProvisionKind;
  node: string;
  vmid: string;
}, scope?: string) {
  const cleaned = sanitizeActionMemory(input);
  if (!cleaned) return readAssistantMemory(scope);

  const current = readAssistantMemory(scope);
  const next: AssistantMemory = {
    ...current,
    lastWorkloadAction: {
      ...cleaned,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  writeAssistantMemory(next, scope);
  return next;
}
