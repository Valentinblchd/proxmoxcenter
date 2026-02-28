import { NextRequest, NextResponse } from "next/server";
import {
  downloadBackupObjectFromCloud,
  listBackupObjectsOnCloud,
  type CloudBackupObject,
} from "@/lib/backups/cloud-providers";
import { decryptUploadPayloadIfNeeded } from "@/lib/backups/cloud-encryption";
import { stageRestorePayload } from "@/lib/backups/restore-staging";
import {
  createRestoreJob,
  getRestoreJob,
  listRestoreJobs,
  requestRestoreJobCancellation,
  startRestoreJobRunner,
} from "@/lib/backups/restore-jobs";
import { readRuntimeBackupConfig } from "@/lib/backups/runtime-config";
import { readRuntimePbsConfig } from "@/lib/pbs/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  ensureSameOriginRequest,
  getClientIp,
  getTrustedOriginForRequest,
} from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action =
  | "list-objects"
  | "prepare-download"
  | "restore-proxmox"
  | "restore-pbs"
  | "cancel-job";

type RequestBody = {
  action?: unknown;
  targetId?: unknown;
  objectKey?: unknown;
  node?: unknown;
  kind?: unknown;
  vmid?: unknown;
  backupStorage?: unknown;
  restoreStorage?: unknown;
  force?: unknown;
  jobId?: unknown;
};

const CLOUD_RESTORE_LIMIT = {
  windowMs: 10 * 60_000,
  max: 20,
  blockMs: 10 * 60_000,
} as const;

function asNonEmptyString(value: unknown, maxLength = 400) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asPositiveInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
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

function asAction(value: unknown): Action | null {
  const raw = asNonEmptyString(value, 40);
  return raw === "list-objects" ||
    raw === "prepare-download" ||
    raw === "restore-proxmox" ||
    raw === "restore-pbs" ||
    raw === "cancel-job"
    ? raw
    : null;
}

function inferObjectMetadata(object: CloudBackupObject) {
  const match = object.name.match(/^vzdump-(qemu|lxc)-(\d+)-/i);
  if (!match) {
    return {
      suggestedKind: null,
      suggestedVmid: null,
    };
  }

  return {
    suggestedKind: match[1].toLowerCase() as "qemu" | "lxc",
    suggestedVmid: Number.parseInt(match[2], 10),
  };
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const gate = consumeRateLimit(`backups:cloud-restore:${getClientIp(request)}`, CLOUD_RESTORE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes restore cloud. Réessaie plus tard." },
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
    return NextResponse.json({ ok: false, error: "action requise." }, { status: 400 });
  }

  if (action === "cancel-job") {
    const jobId = asNonEmptyString(body.jobId, 120);
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "jobId requis." }, { status: 400 });
    }
    const job = requestRestoreJobCancellation(jobId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Job de restauration introuvable." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      job,
      message:
        job.state === "running"
          ? "Annulation demandée. Le job va s’arrêter dès que possible."
          : "Ce job n’est plus annulable.",
    });
  }

  const targetId = asNonEmptyString(body.targetId, 120);
  if (!targetId) {
    return NextResponse.json({ ok: false, error: "targetId requis." }, { status: 400 });
  }
  const config = readRuntimeBackupConfig();
  const target = config.cloudTargets.find((item) => item.id === targetId) ?? null;
  if (!target) {
    return NextResponse.json({ ok: false, error: "Cible cloud introuvable." }, { status: 404 });
  }

  try {
    if (action === "list-objects") {
      const objects = await listBackupObjectsOnCloud(target);
      return NextResponse.json({
        ok: true,
        objects: objects.map((object) => ({
          ...object,
          ...inferObjectMetadata(object),
        })),
      });
    }

    const objectKey = asNonEmptyString(body.objectKey, 1000);
    if (!objectKey) {
      return NextResponse.json({ ok: false, error: "objectKey requis." }, { status: 400 });
    }

    if (action === "prepare-download") {
      const downloaded = await downloadBackupObjectFromCloud(target, objectKey);
      const decrypted = decryptUploadPayloadIfNeeded(target, downloaded);
      const staged = stageRestorePayload({
        filename: decrypted.filename,
        contentType: decrypted.contentType,
        bytes: decrypted.bytes,
      });
      const origin = getTrustedOriginForRequest(request);
      const downloadUrl = origin ? `${origin}/api/backups/staged/${staged.token}` : null;
      return NextResponse.json({
        ok: true,
        filename: decrypted.filename,
        token: staged.token,
        downloadUrl,
        expiresAt: staged.expiresAt,
      });
    }

    const node = asNonEmptyString(body.node, 120);
    const kind = body.kind === "lxc" ? "lxc" : body.kind === "qemu" ? "qemu" : null;
    const vmid = asPositiveInt(body.vmid);
    const backupStorage = asNonEmptyString(body.backupStorage, 120);
    const restoreStorage = asNonEmptyString(body.restoreStorage, 120);
    const force = asBoolean(body.force, false);
    const destination = action === "restore-pbs" ? "pbs" : "proxmox";
    const origin = getTrustedOriginForRequest(request);
    const pbsConfig = destination === "pbs" ? readRuntimePbsConfig() : null;

    if (destination === "proxmox" && !origin) {
      throw new Error("Origine applicative introuvable pour staging restore.");
    }
    if (destination === "proxmox" && (!node || !backupStorage)) {
      throw new Error("node et backupStorage requis pour l’import cloud.");
    }
    if (destination === "proxmox" && (!kind || !vmid)) {
      throw new Error("kind et vmid requis pour restaurer vers Proxmox.");
    }
    if (destination === "pbs" && !pbsConfig) {
      throw new Error("Connexion PBS directe non configurée.");
    }

    const job = createRestoreJob({
      destination,
      target,
      objectKey,
      node: destination === "pbs" ? (pbsConfig?.host ?? "pbs") : (node as string),
      kind,
      vmid,
      backupStorage: destination === "pbs" ? (pbsConfig?.datastore ?? "pbs") : (backupStorage as string),
      restoreStorage,
      force,
    });
    startRestoreJobRunner({
      jobId: job.id,
      target,
      objectKey,
      origin: origin ?? "",
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      job: getRestoreJob(job.id),
      message:
        destination === "pbs"
          ? `Import PBS direct vers ${pbsConfig?.datastore ?? "PBS"} lancé.`
          : `Restauration ${kind?.toUpperCase() ?? "VM"} #${vmid ?? "?"} lancée.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erreur restore cloud.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request, { allowMissingOrigin: true });
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const gate = consumeRateLimit(`backups:cloud-restore:get:${getClientIp(request)}`, CLOUD_RESTORE_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de requêtes restore cloud. Réessaie plus tard." },
      { status: 429 },
    );
  }

  const jobId = asNonEmptyString(request.nextUrl.searchParams.get("jobId"), 120);
  if (jobId) {
    const job = getRestoreJob(jobId);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Job de restauration introuvable." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, job });
  }

  return NextResponse.json({
    ok: true,
    jobs: listRestoreJobs(),
  });
}
