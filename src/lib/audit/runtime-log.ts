import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthMethod, AuthSession } from "@/lib/auth/session";

export type AuditLogSeverity = "info" | "warning" | "error";
export type AuditLogCategory =
  | "auth"
  | "security"
  | "settings"
  | "workload"
  | "backup"
  | "observability";

export type AuditLogActor = {
  username: string;
  role: string;
  authMethod: AuthMethod;
  userId: string | null;
};

export type AuditLogChange = {
  field: string;
  before: string | null;
  after: string | null;
};

export type AuditLogEntry = {
  id: string;
  at: string;
  severity: AuditLogSeverity;
  category: AuditLogCategory;
  action: string;
  summary: string;
  actor: AuditLogActor;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  changes: AuditLogChange[];
  details: Record<string, string>;
};

type AuditLogFile = {
  version?: unknown;
  updatedAt?: unknown;
  entries?: unknown;
};

const MAX_ENTRIES = 1500;

function getDefaultAuditLogPath() {
  return path.join(process.cwd(), "data", "audit-log.json");
}

export function getRuntimeAuditLogPath() {
  const custom = process.env.PROXCENTER_AUDIT_LOG_PATH?.trim();
  return custom || getDefaultAuditLogPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function asNonEmptyString(value: unknown, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function serializeDetailValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = value
      .map((item) => serializeDetailValue(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeDetails(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    const normalizedKey = key.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const normalizedValue = serializeDetailValue(raw);
    if (!normalizedKey || !normalizedValue) continue;
    out[normalizedKey] = normalizedValue.slice(0, 1000);
  }
  return out;
}

function normalizeChanges(value: unknown) {
  if (!Array.isArray(value)) return [] as AuditLogChange[];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const field = asNonEmptyString(record.field, 120);
      if (!field) return null;
      return {
        field,
        before: serializeDetailValue(record.before),
        after: serializeDetailValue(record.after),
      } satisfies AuditLogChange;
    })
    .filter((entry): entry is AuditLogChange => Boolean(entry));
}

function normalizeEntry(value: unknown): AuditLogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = asNonEmptyString(record.id, 120) ?? randomUUID();
  const at = asIsoDate(record.at) ?? new Date().toISOString();
  const severity =
    record.severity === "warning" || record.severity === "error" ? record.severity : "info";
  const category =
    record.category === "auth" ||
    record.category === "security" ||
    record.category === "settings" ||
    record.category === "workload" ||
    record.category === "backup" ||
    record.category === "observability"
      ? record.category
      : "settings";
  const action = asNonEmptyString(record.action, 120);
  const summary = asNonEmptyString(record.summary, 400);
  const targetType = asNonEmptyString(record.targetType, 80);
  if (!action || !summary || !targetType) return null;

  const actorRecord = record.actor && typeof record.actor === "object" ? (record.actor as Record<string, unknown>) : {};
  const username = asNonEmptyString(actorRecord.username, 120) ?? "system";
  const role = asNonEmptyString(actorRecord.role, 80) ?? "system";
  const authMethod = actorRecord.authMethod === "ldap" ? "ldap" : "local";

  return {
    id,
    at,
    severity,
    category,
    action,
    summary,
    actor: {
      username,
      role,
      authMethod,
      userId: asNonEmptyString(actorRecord.userId, 120),
    },
    targetType,
    targetId: asNonEmptyString(record.targetId, 200),
    targetLabel: asNonEmptyString(record.targetLabel, 200),
    changes: normalizeChanges(record.changes),
    details: sanitizeDetails(record.details),
  };
}

export function readRuntimeAuditLog() {
  const filePath = getRuntimeAuditLogPath();
  if (!fs.existsSync(filePath)) {
    return {
      updatedAt: new Date().toISOString(),
      entries: [] as AuditLogEntry[],
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return {
        updatedAt: new Date().toISOString(),
        entries: [] as AuditLogEntry[],
      };
    }
    const parsed = JSON.parse(raw) as AuditLogFile;
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is AuditLogEntry => Boolean(entry))
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, MAX_ENTRIES);

    return {
      updatedAt: asIsoDate(parsed.updatedAt) ?? new Date().toISOString(),
      entries,
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      entries: [] as AuditLogEntry[],
    };
  }
}

export function writeRuntimeAuditLog(entries: AuditLogEntry[]) {
  const filePath = getRuntimeAuditLogPath();
  ensureParentDirectory(filePath);
  const updatedAt = new Date().toISOString();
  const normalizedEntries = entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is AuditLogEntry => Boolean(entry))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, MAX_ENTRIES);

  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt,
        entries: normalizedEntries,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  return {
    updatedAt,
    entries: normalizedEntries,
  };
}

export function buildAuditActor(session: Pick<AuthSession, "username" | "role" | "authMethod" | "userId">): AuditLogActor {
  return {
    username: session.username,
    role: session.role,
    authMethod: session.authMethod,
    userId: session.userId,
  };
}

export function appendAuditLogEntry(input: Omit<AuditLogEntry, "id" | "at"> & { at?: string; id?: string }) {
  const current = readRuntimeAuditLog();
  const entry = normalizeEntry({
    ...input,
    id: input.id ?? randomUUID(),
    at: input.at ?? new Date().toISOString(),
  });
  if (!entry) {
    throw new Error("Entrée audit invalide.");
  }
  return writeRuntimeAuditLog([entry, ...current.entries]);
}
