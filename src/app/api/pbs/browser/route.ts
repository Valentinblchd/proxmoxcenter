import { NextRequest, NextResponse } from "next/server";
import { stageRestorePayload } from "@/lib/backups/restore-staging";
import { readPbsToolingStatus, requireRuntimePbsConfig, restoreArchiveFromPbs, runPbsJsonCommand } from "@/lib/pbs/tooling";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  ensureSameOriginRequest,
  getClientIp,
  getTrustedOriginForRequest,
} from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action =
  | "list-namespaces"
  | "list-groups"
  | "list-snapshots"
  | "list-files"
  | "prepare-download";

type RequestBody = {
  action?: unknown;
  namespace?: unknown;
  group?: unknown;
  snapshot?: unknown;
  archiveName?: unknown;
};

const PBS_BROWSER_LIMIT = {
  windowMs: 5 * 60_000,
  max: 40,
  blockMs: 10 * 60_000,
} as const;

function asNonEmptyString(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asAction(value: unknown): Action | null {
  const raw = asNonEmptyString(value, 40);
  switch (raw) {
    case "list-namespaces":
    case "list-groups":
    case "list-snapshots":
    case "list-files":
    case "prepare-download":
      return raw;
    default:
      return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const asNumber = Number.parseInt(value, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === value) {
    const date = new Date(asNumber * 1000);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function mapNamespaces(raw: unknown) {
  return toArray(raw).map((item, index) => {
    if (typeof item === "string") {
      return {
        id: item || "root",
        name: item || "Racine",
        path: item || "",
      };
    }
    const record = asRecord(item);
    const path = pickString(record, ["ns", "namespace", "path"]) ?? "";
    return {
      id: path || `root-${index}`,
      name: path || "Racine",
      path,
    };
  });
}

function mapGroups(raw: unknown) {
  return toArray(raw)
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) return null;
      const type = pickString(record, ["backup-type", "backup_type", "type"]);
      const backupId = pickString(record, ["backup-id", "backup_id", "id", "backup-group"]);
      const label = type && backupId ? `${type}/${backupId}` : backupId ?? type ?? `groupe-${index + 1}`;
      return {
        id: label,
        label,
        path: label,
        backupType: type,
        backupId,
        lastBackupAt: normalizeDate(pickString(record, ["last-backup", "last_backup"])),
        owner: pickString(record, ["owner"]),
        comment: pickString(record, ["comment", "notes"]),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mapSnapshots(raw: unknown) {
  return toArray(raw)
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) return null;
      const type = pickString(record, ["backup-type", "backup_type", "type"]);
      const backupId = pickString(record, ["backup-id", "backup_id", "id"]);
      const timeRaw = pickString(record, ["backup-time", "backup_time", "time", "snapshot"]);
      const snapshotPath =
        pickString(record, ["backup", "snapshot", "backup-dir", "backup_dir"]) ??
        (type && backupId && timeRaw ? `${type}/${backupId}/${timeRaw}` : null);
      const label = snapshotPath ?? `${type ?? "snapshot"}/${backupId ?? index + 1}`;
      return {
        id: label,
        label,
        path: snapshotPath ?? label,
        backupType: type,
        backupId,
        backupTime: normalizeDate(timeRaw),
        comment: pickString(record, ["comment", "notes"]),
        sizeBytes: pickNumber(record, ["size", "backup-size", "backup_size"]),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mapFiles(raw: unknown) {
  return toArray(raw)
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `${item}-${index}`,
          archiveName: item,
          name: item,
          sizeBytes: null,
          cryptMode: null,
        };
      }
      const record = asRecord(item);
      if (!record) return null;
      const archiveName = pickString(record, ["filename", "archive-name", "archive_name", "name"]);
      if (!archiveName) return null;
      return {
        id: `${archiveName}-${index}`,
        archiveName,
        name: archiveName,
        sizeBytes: pickNumber(record, ["size", "archive-size", "archive_size"]),
        cryptMode: pickString(record, ["crypt-mode", "crypt_mode"]),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export async function GET(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request, { allowMissingOrigin: true });
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const config = requireRuntimePbsConfig();
    const tooling = await readPbsToolingStatus();
    return NextResponse.json({
      ok: true,
      configured: true,
      namespace: config.namespace,
      host: config.host,
      port: config.port,
      datastore: config.datastore,
      tooling,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: error instanceof Error ? error.message : "Connexion PBS indisponible.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const gate = consumeRateLimit(`pbs:browser:${getClientIp(request)}`, PBS_BROWSER_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes PBS. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = asAction(body.action);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action PBS invalide." }, { status: 400 });
  }

  try {
    const config = requireRuntimePbsConfig();
    const namespace = asNonEmptyString(body.namespace, 300);

    if (action === "list-namespaces") {
      const namespaces = await runPbsJsonCommand(config, ["namespace", "list"], { namespace });
      return NextResponse.json({
        ok: true,
        namespaces: mapNamespaces(namespaces),
      });
    }

    if (action === "list-groups") {
      const groups = await runPbsJsonCommand(config, ["list"], { namespace });
      return NextResponse.json({
        ok: true,
        groups: mapGroups(groups),
      });
    }

    if (action === "list-snapshots") {
      const group = asNonEmptyString(body.group, 300);
      if (!group) {
        throw new Error("Groupe PBS requis.");
      }
      const snapshots = await runPbsJsonCommand(config, ["snapshot", "list", group], { namespace });
      return NextResponse.json({
        ok: true,
        snapshots: mapSnapshots(snapshots),
      });
    }

    if (action === "list-files") {
      const snapshot = asNonEmptyString(body.snapshot, 500);
      if (!snapshot) {
        throw new Error("Snapshot PBS requis.");
      }
      const files = await runPbsJsonCommand(config, ["snapshot", "files", snapshot], { namespace });
      return NextResponse.json({
        ok: true,
        files: mapFiles(files),
      });
    }

    const snapshot = asNonEmptyString(body.snapshot, 500);
    const archiveName = asNonEmptyString(body.archiveName, 400);
    if (!snapshot || !archiveName) {
      throw new Error("Snapshot et archive requis.");
    }

    const restored = await restoreArchiveFromPbs({
      config,
      snapshot,
      archiveName,
      namespace,
    });
    const staged = stageRestorePayload({
      filename: restored.filename,
      contentType: restored.contentType,
      bytes: restored.bytes,
    });
    const origin = getTrustedOriginForRequest(request);

    return NextResponse.json({
      ok: true,
      filename: restored.filename,
      token: staged.token,
      expiresAt: staged.expiresAt,
      downloadUrl: origin ? `${origin}/api/backups/staged/${staged.token}` : null,
      lines: restored.lines,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur navigateur PBS.",
      },
      { status: 400 },
    );
  }
}
