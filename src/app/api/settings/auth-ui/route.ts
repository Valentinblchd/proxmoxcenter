import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { getAuthStatus } from "@/lib/auth/session";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import { readRuntimeProxmoxConfig } from "@/lib/proxmox/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import {
  listRuntimeAuthUsers,
  readRuntimeAuthConfig,
  updateRuntimeAuthSessionSettings,
} from "@/lib/auth/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_UI_MUTATION_LIMIT = {
  windowMs: 10 * 60_000,
  max: 20,
  blockMs: 15 * 60_000,
} as const;

type AuthUiSettingsBody = {
  sessionTtlHours?: unknown;
  secureCookie?: unknown;
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

function asPositiveInt(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function buildPayload() {
  const runtimeAuth = readRuntimeAuthConfig();
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  const users = listRuntimeAuthUsers();

  return {
    ok: true,
    auth: getAuthStatus(),
    settings: runtimeAuth
      ? {
          sessionTtlHours: Math.max(1, Math.round(runtimeAuth.sessionTtlSeconds / 3600)),
          secureCookie: runtimeAuth.secureCookie,
          primaryUsername: runtimeAuth.username,
          localUsersCount: users.length,
          enabledUsersCount: users.filter((user) => user.enabled).length,
        }
      : null,
    ldapSecondaryEnabled: Boolean(proxmoxRuntime?.ldap.enabled),
  };
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }
  return NextResponse.json(buildPayload());
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`settings:auth-ui:post:${getClientIp(request)}`, AUTH_UI_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications session. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: AuthUiSettingsBody;
  try {
    body = (await request.json()) as AuthUiSettingsBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  try {
    const runtimeAuth = readRuntimeAuthConfig();
    const nextSessionTtlHours = asPositiveInt(body.sessionTtlHours, 12);
    const nextSecureCookie = asBoolean(body.secureCookie, false);
    updateRuntimeAuthSessionSettings({
      sessionTtlSeconds: nextSessionTtlHours * 3600,
      secureCookie: nextSecureCookie,
    });
    appendAuditLogEntry({
      severity: "info",
      category: "settings",
      action: "auth-ui.settings",
      summary: "Réglages de session mis à jour",
      actor: buildAuditActor(capability.session),
      targetType: "auth-ui",
      targetId: "session",
      targetLabel: "Sessions UI",
      changes: [
        {
          field: "sessionTtlHours",
          before: runtimeAuth ? String(Math.max(1, Math.round(runtimeAuth.sessionTtlSeconds / 3600))) : null,
          after: String(nextSessionTtlHours),
        },
        {
          field: "secureCookie",
          before: runtimeAuth ? String(runtimeAuth.secureCookie) : null,
          after: String(nextSecureCookie),
        },
      ],
      details: {},
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible d’enregistrer les réglages.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...buildPayload(),
    message: "Réglages de session enregistrés.",
  });
}
