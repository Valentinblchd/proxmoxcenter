import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import { getAuthStatus } from "@/lib/auth/session";
import { proxmoxRequestWithConfig } from "@/lib/proxmox/client";
import {
  getProxmoxConfig,
  getProxmoxConfigSource,
  type ProxmoxConfig,
} from "@/lib/proxmox/config";
import {
  deleteRuntimeProxmoxConfig,
  maskSecret,
  normalizeRuntimeProxmoxConfigInput,
  readRuntimeProxmoxConfig,
  writeRuntimeProxmoxConfig,
} from "@/lib/proxmox/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROXMOX_SETUP_MUTATION_LIMIT = {
  windowMs: 5 * 60_000,
  max: 20,
  blockMs: 10 * 60_000,
} as const;

type RequestBody = {
  baseUrl?: unknown;
  protocol?: unknown;
  host?: unknown;
  port?: unknown;
  tokenId?: unknown;
  tokenSecret?: unknown;
  tlsMode?: unknown;
  allowInsecureTls?: unknown;
  customCaCertPem?: unknown;
  ldap?: unknown;
  testOnly?: unknown;
  skipTest?: unknown;
  confirmationText?: unknown;
};

type ProxmoxVersionResponse = {
  version?: string;
  release?: string;
  repoid?: string;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildConfigResponsePayload() {
  const source = getProxmoxConfigSource();
  const effective = getProxmoxConfig();
  const runtimeSaved = readRuntimeProxmoxConfig();

  return {
    configured: Boolean(effective),
    localAuthActive: getAuthStatus().active,
    source,
    effective: effective
      ? {
          baseUrl: effective.baseUrl,
          protocol: effective.protocol,
          host: effective.host,
          port: effective.port,
          tokenId: effective.tokenId,
          tlsMode: effective.tlsMode,
          allowInsecureTls: effective.allowInsecureTls,
          customCaConfigured: Boolean(effective.customCaCertPem),
          tokenSecretMasked: maskSecret(effective.tokenSecret),
        }
      : null,
    runtimeSaved: runtimeSaved
      ? {
          baseUrl: runtimeSaved.baseUrl,
          protocol: runtimeSaved.protocol,
          host: runtimeSaved.host,
          port: runtimeSaved.port,
          tokenId: runtimeSaved.tokenId,
          tlsMode: runtimeSaved.tlsMode,
          allowInsecureTls: runtimeSaved.allowInsecureTls,
          customCaConfigured: Boolean(runtimeSaved.customCaCertPem),
          tokenSecretMasked: maskSecret(runtimeSaved.tokenSecret),
          ldap: {
            enabled: runtimeSaved.ldap.enabled,
            serverUrl: runtimeSaved.ldap.serverUrl,
            baseDn: runtimeSaved.ldap.baseDn,
            bindDn: runtimeSaved.ldap.bindDn,
            bindPasswordConfigured: Boolean(runtimeSaved.ldap.bindPasswordCipher),
            userFilter: runtimeSaved.ldap.userFilter,
            realm: runtimeSaved.ldap.realm,
            startTls: runtimeSaved.ldap.startTls,
            allowInsecureTls: runtimeSaved.ldap.allowInsecureTls,
          },
          updatedAt: runtimeSaved.updatedAt,
        }
      : null,
    envOverridesRuntime: false,
  };
}

async function testProxmoxConnection(config: ProxmoxConfig) {
  const version = await proxmoxRequestWithConfig<ProxmoxVersionResponse>(config, "version");
  return {
    ok: true as const,
    version: {
      version: version?.version ?? "unknown",
      release: version?.release ?? null,
      repoid: version?.repoid ?? null,
    },
  };
}

function mergeCandidateInput(body: RequestBody) {
  const runtimeExisting = readRuntimeProxmoxConfig();
  const ldapBody = isRecord(body.ldap) ? body.ldap : {};
  const existingLdap = runtimeExisting?.ldap;

  const tokenSecretInput = asNonEmptyString(body.tokenSecret);
  const tokenSecret = tokenSecretInput ?? runtimeExisting?.tokenSecret ?? null;

  const tlsModeInput = asNonEmptyString(body.tlsMode);
  const customCaInput = asNonEmptyString(body.customCaCertPem);
  const useCustomCaMode =
    tlsModeInput === "custom-ca" ||
    (!tlsModeInput && customCaInput !== null) ||
    (!tlsModeInput && !customCaInput && runtimeExisting?.tlsMode === "custom-ca");
  const customCaCertPem = useCustomCaMode
    ? customCaInput ?? runtimeExisting?.customCaCertPem ?? null
    : customCaInput;

  const ldapBindPasswordInput = asNonEmptyString(ldapBody.bindPassword);

  return {
    baseUrl: body.baseUrl ?? runtimeExisting?.baseUrl,
    protocol: body.protocol ?? runtimeExisting?.protocol,
    host: body.host ?? runtimeExisting?.host,
    port: body.port ?? runtimeExisting?.port,
    tokenId: body.tokenId ?? runtimeExisting?.tokenId,
    tokenSecret,
    tlsMode: body.tlsMode ?? runtimeExisting?.tlsMode ?? body.allowInsecureTls,
    allowInsecureTls: body.allowInsecureTls ?? runtimeExisting?.allowInsecureTls ?? false,
    customCaCertPem,
    ldap: {
      enabled:
        ldapBody.enabled ??
        existingLdap?.enabled ??
        false,
      serverUrl: ldapBody.serverUrl ?? existingLdap?.serverUrl ?? "",
      baseDn: ldapBody.baseDn ?? existingLdap?.baseDn ?? "",
      bindDn: ldapBody.bindDn ?? existingLdap?.bindDn ?? "",
      bindPassword: ldapBindPasswordInput ?? undefined,
      bindPasswordCipher:
        ldapBindPasswordInput == null
          ? existingLdap?.bindPasswordCipher ?? null
          : undefined,
      userFilter: ldapBody.userFilter ?? existingLdap?.userFilter ?? "(uid={username})",
      realm: ldapBody.realm ?? existingLdap?.realm ?? "ldap",
      startTls: ldapBody.startTls ?? existingLdap?.startTls ?? false,
      allowInsecureTls:
        ldapBody.allowInsecureTls ??
        existingLdap?.allowInsecureTls ??
        false,
    },
  };
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }

  return NextResponse.json({
    ok: true,
    ...buildConfigResponsePayload(),
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
    `setup-proxmox:post:${getClientIp(request)}`,
    PROXMOX_SETUP_MUTATION_LIMIT,
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
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: 400 });
  }

  const testOnly = asBoolean(body.testOnly, false);
  const skipTest = asBoolean(body.skipTest, false);
  const candidateInput = mergeCandidateInput(body);
  const normalized = normalizeRuntimeProxmoxConfigInput(candidateInput);

  if (!normalized) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Configuration invalide. Vérifie host/DNS, port, token API, mode TLS/certificat et paramètres LDAP.",
      },
      { status: 400 },
    );
  }

  if (normalized.ldap.enabled && !getAuthStatus().active) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "LDAP peut être activé uniquement si un compte local UI est déjà actif (fallback obligatoire).",
      },
      { status: 400 },
    );
  }

  const candidate: ProxmoxConfig = {
    baseUrl: normalized.baseUrl,
    protocol: normalized.protocol,
    host: normalized.host,
    port: normalized.port,
    tokenId: normalized.tokenId,
    tokenSecret: normalized.tokenSecret,
    tlsMode: normalized.tlsMode,
    allowInsecureTls: normalized.allowInsecureTls,
    customCaCertPem: normalized.customCaCertPem,
  };

  let testResult:
    | {
        ok: true;
        version: { version: string; release: string | null; repoid: string | null };
      }
    | null = null;

  if (!skipTest) {
    try {
      testResult = await testProxmoxConnection(candidate);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Impossible de joindre l’API Proxmox.",
        },
        { status: 502 },
      );
    }
  }

  if (!testOnly) {
    try {
      const previous = readRuntimeProxmoxConfig();
      writeRuntimeProxmoxConfig(candidateInput);
      appendAuditLogEntry({
        severity: normalized.allowInsecureTls ? "warning" : "info",
        category: "settings",
        action: previous ? "proxmox.settings.update" : "proxmox.settings.create",
        summary: previous ? "Connexion Proxmox mise à jour" : "Connexion Proxmox configurée",
        actor: buildAuditActor(capability.session),
        targetType: "proxmox",
        targetId: normalized.host,
        targetLabel: normalized.baseUrl,
        changes: [
          { field: "host", before: previous?.host ?? null, after: normalized.host },
          { field: "tlsMode", before: previous?.tlsMode ?? null, after: normalized.tlsMode },
          { field: "ldapEnabled", before: previous ? String(previous.ldap.enabled) : null, after: String(normalized.ldap.enabled) },
        ],
        details: {},
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Impossible d’enregistrer la configuration.",
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    test: testResult,
    saved: !testOnly,
    tested: !skipTest,
    ...buildConfigResponsePayload(),
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
      "DELETE PROXMOX CONFIG",
      'Confirmation forte requise. Tape "DELETE PROXMOX CONFIG".',
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Confirmation invalide." },
      { status: 400 },
    );
  }

  deleteRuntimeProxmoxConfig();
  appendAuditLogEntry({
    severity: "warning",
    category: "settings",
    action: "proxmox.settings.delete",
    summary: "Connexion Proxmox supprimée",
    actor: buildAuditActor(capability.session),
    targetType: "proxmox",
    targetId: "runtime",
    targetLabel: "Proxmox",
    changes: [],
    details: {},
  });
  return NextResponse.json({
    ok: true,
    message: "Runtime Proxmox config deleted.",
    ...buildConfigResponsePayload(),
  });
}
