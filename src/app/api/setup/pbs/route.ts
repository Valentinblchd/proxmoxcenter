import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import {
  deleteRuntimePbsConfig,
  normalizeRuntimePbsConfigInput,
  readRuntimePbsConfig,
  writeRuntimePbsConfig,
} from "@/lib/pbs/runtime-config";
import { readPbsToolingStatus } from "@/lib/pbs/tooling";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PBS_SETUP_MUTATION_LIMIT = {
  windowMs: 5 * 60_000,
  max: 20,
  blockMs: 10 * 60_000,
} as const;

type RequestBody = {
  host?: unknown;
  port?: unknown;
  datastore?: unknown;
  authId?: unknown;
  secret?: unknown;
  namespace?: unknown;
  fingerprint?: unknown;
  confirmationText?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, secret.length - 4))}${secret.slice(-4)}`;
}

function buildConfigResponsePayload(tooling: Awaited<ReturnType<typeof readPbsToolingStatus>>) {
  const runtimeSaved = readRuntimePbsConfig();
  return {
    configured: Boolean(runtimeSaved),
    runtimeSaved: runtimeSaved
      ? {
          host: runtimeSaved.host,
          port: runtimeSaved.port,
          datastore: runtimeSaved.datastore,
          authId: runtimeSaved.authId,
          namespace: runtimeSaved.namespace,
          fingerprintConfigured: Boolean(runtimeSaved.fingerprint),
          secretMasked: maskSecret(runtimeSaved.secret),
          updatedAt: runtimeSaved.updatedAt,
        }
      : null,
    tooling,
  };
}

function mergeCandidateInput(body: RequestBody) {
  const runtimeExisting = readRuntimePbsConfig();
  const secretInput = asNonEmptyString(body.secret);

  return {
    host: body.host ?? runtimeExisting?.host,
    port: body.port ?? runtimeExisting?.port ?? 8007,
    datastore: body.datastore ?? runtimeExisting?.datastore,
    authId: body.authId ?? runtimeExisting?.authId,
    secret: secretInput ?? runtimeExisting?.secret ?? null,
    namespace: body.namespace ?? runtimeExisting?.namespace,
    fingerprint: body.fingerprint ?? runtimeExisting?.fingerprint,
  };
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  const tooling = await readPbsToolingStatus();
  return NextResponse.json({
    ok: true,
    ...buildConfigResponsePayload(tooling),
  });
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
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

  const gate = consumeRateLimit(
    `setup-pbs:post:${getClientIp(request)}`,
    PBS_SETUP_MUTATION_LIMIT,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const candidateInput = mergeCandidateInput(body);
  const normalized = normalizeRuntimePbsConfigInput(candidateInput);
  if (!normalized) {
    return NextResponse.json(
      {
        ok: false,
        error: "Configuration PBS invalide. Vérifie host, port, datastore, Auth ID et secret.",
      },
      { status: 400 },
    );
  }

  try {
    writeRuntimePbsConfig(candidateInput);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save PBS config.",
      },
      { status: 500 },
    );
  }

  const tooling = await readPbsToolingStatus();
  return NextResponse.json({
    ok: true,
    saved: true,
    ...buildConfigResponsePayload(tooling),
  });
}

export async function DELETE(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
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

  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    body = {};
  }

  try {
    assertStrongConfirmation(
      body.confirmationText,
      "DELETE PBS CONFIG",
      'Confirmation forte requise. Tape "DELETE PBS CONFIG".',
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Confirmation invalide." },
      { status: 400 },
    );
  }

  deleteRuntimePbsConfig();
  const tooling = await readPbsToolingStatus();
  return NextResponse.json({
    ok: true,
    message: "Runtime PBS config deleted.",
    ...buildConfigResponsePayload(tooling),
  });
}
