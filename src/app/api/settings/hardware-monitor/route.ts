import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import { probeHardwareMonitor } from "@/lib/hardware/redfish";
import {
  deleteRuntimeHardwareMonitorConfig,
  maskHardwareMonitorSecret,
  normalizeRuntimeHardwareMonitorConfigInput,
  readRuntimeHardwareMonitorConfig,
  writeRuntimeHardwareMonitorConfig,
} from "@/lib/hardware/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HARDWARE_MONITOR_MUTATION_LIMIT = {
  windowMs: 5 * 60_000,
  max: 20,
  blockMs: 10 * 60_000,
} as const;

type RequestBody = {
  enabled?: unknown;
  nodeName?: unknown;
  label?: unknown;
  baseUrl?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  tlsMode?: unknown;
  allowInsecureTls?: unknown;
  customCaCertPem?: unknown;
  testOnly?: unknown;
  skipTest?: unknown;
  confirmationText?: unknown;
};

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildResponsePayload(probe?: Awaited<ReturnType<typeof probeHardwareMonitor>> | null) {
  const runtimeSaved = readRuntimeHardwareMonitorConfig();
  return {
    configured: Boolean(runtimeSaved),
    runtimeSaved: runtimeSaved
      ? {
          enabled: runtimeSaved.enabled,
          nodeName: runtimeSaved.nodeName,
          label: runtimeSaved.label,
          baseUrl: runtimeSaved.baseUrl,
          protocol: runtimeSaved.protocol,
          host: runtimeSaved.host,
          port: runtimeSaved.port,
          username: runtimeSaved.username,
          tlsMode: runtimeSaved.tlsMode,
          allowInsecureTls: runtimeSaved.allowInsecureTls,
          customCaConfigured: Boolean(runtimeSaved.customCaCertPem),
          passwordMasked: maskHardwareMonitorSecret(runtimeSaved.password),
          updatedAt: runtimeSaved.updatedAt,
        }
      : null,
    probe: probe ?? null,
  };
}

function mergeCandidateInput(body: RequestBody) {
  const existing = readRuntimeHardwareMonitorConfig();
  const passwordInput = asNonEmptyString(body.password);
  const tlsModeInput = asNonEmptyString(body.tlsMode);
  const customCaInput = asNonEmptyString(body.customCaCertPem);
  const useCustomCaMode =
    tlsModeInput === "custom-ca" ||
    (!tlsModeInput && customCaInput !== null) ||
    (!tlsModeInput && !customCaInput && existing?.tlsMode === "custom-ca");
  const customCaCertPem = useCustomCaMode
    ? customCaInput ?? existing?.customCaCertPem ?? null
    : customCaInput;

  return {
    enabled: body.enabled ?? existing?.enabled ?? true,
    nodeName: body.nodeName ?? existing?.nodeName,
    label: body.label ?? existing?.label,
    baseUrl: body.baseUrl ?? existing?.baseUrl,
    protocol: body.protocol ?? existing?.protocol,
    host: body.host ?? existing?.host,
    port: body.port ?? existing?.port,
    username: body.username ?? existing?.username,
    password: passwordInput ?? existing?.password ?? null,
    tlsMode: body.tlsMode ?? existing?.tlsMode ?? body.allowInsecureTls,
    allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? false,
    customCaCertPem,
  };
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) return capability.response;

  return NextResponse.json({
    ok: true,
    ...buildResponsePayload(),
  });
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) return capability.response;

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine de requête invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(
    `settings-hardware-monitor:post:${getClientIp(request)}`,
    HARDWARE_MONITOR_MUTATION_LIMIT,
  );
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "Trop de tentatives. Réessaie plus tard." }, { status: 429 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const candidateInput = mergeCandidateInput(body);
  const normalized = normalizeRuntimeHardwareMonitorConfigInput(candidateInput);
  if (!normalized) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Configuration BMC/iLO invalide. Vérifie host, port, login, mot de passe et mode TLS.",
      },
      { status: 400 },
    );
  }

  const testOnly = asBoolean(body.testOnly, false);
  const skipTest = asBoolean(body.skipTest, false);
  let probe: Awaited<ReturnType<typeof probeHardwareMonitor>> | null = null;

  if (!skipTest) {
    try {
      probe = await probeHardwareMonitor(normalized);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Impossible de joindre le BMC/iLO.",
        },
        { status: 502 },
      );
    }
  }

  if (!testOnly) {
    try {
      const previous = readRuntimeHardwareMonitorConfig();
      writeRuntimeHardwareMonitorConfig(candidateInput);
      appendAuditLogEntry({
        severity: normalized.allowInsecureTls ? "warning" : "info",
        category: "settings",
        action: previous ? "hardware-monitor.update" : "hardware-monitor.create",
        summary: previous ? "Sonde BMC/iLO mise à jour" : "Sonde BMC/iLO configurée",
        actor: buildAuditActor(capability.session),
        targetType: "hardware-monitor",
        targetId: normalized.host,
        targetLabel: normalized.label ?? normalized.host,
        changes: [
          { field: "host", before: previous?.host ?? null, after: normalized.host },
          { field: "nodeName", before: previous?.nodeName ?? null, after: normalized.nodeName },
          { field: "tlsMode", before: previous?.tlsMode ?? null, after: normalized.tlsMode },
        ],
        details: {},
      });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Failed to save BMC/iLO config." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    saved: !testOnly,
    tested: !skipTest,
    ...buildResponsePayload(probe),
  });
}

export async function DELETE(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) return capability.response;

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine de requête invalide." }, { status: 403 });
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
      "DELETE HARDWARE MONITOR",
      'Confirmation forte requise. Tape "DELETE HARDWARE MONITOR".',
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Confirmation invalide." },
      { status: 400 },
    );
  }

  const previous = readRuntimeHardwareMonitorConfig();
  deleteRuntimeHardwareMonitorConfig();
  if (previous) {
    appendAuditLogEntry({
      severity: "info",
      category: "settings",
      action: "hardware-monitor.delete",
      summary: "Sonde BMC/iLO supprimée",
      actor: buildAuditActor(capability.session),
      targetType: "hardware-monitor",
      targetId: previous.host,
      targetLabel: previous.label ?? previous.host,
      changes: [],
      details: {},
    });
  }

  return NextResponse.json({
    ok: true,
    ...buildResponsePayload(),
  });
}
