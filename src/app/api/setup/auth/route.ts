import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getAuthStatus,
  hashPasswordWithSalt,
  randomHex,
} from "@/lib/auth/session";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import {
  deleteRuntimeAuthConfig,
  normalizeLocalUsernameInput,
  readRuntimeAuthConfig,
  writeRuntimeAuthConfig,
} from "@/lib/auth/runtime-config";
import { readRuntimeProxmoxConfig } from "@/lib/proxmox/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  ensureSameOriginRequest,
  getClientIp,
  isConfiguredPublicOriginHttps,
} from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_SETUP_POST_LIMIT = {
  windowMs: 10 * 60_000,
  max: 10,
  blockMs: 15 * 60_000,
} as const;

type AuthSetupBody = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  sessionSecret?: unknown;
  confirmationText?: unknown;
  secureCookie?: unknown;
  sessionTtlSeconds?: unknown;
  autoLogin?: unknown;
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

function asPositiveInt(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) return null;
  return email;
}

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, secret.length - 4))}${secret.slice(-4)}`;
}

function buildAuthSetupStatus() {
  const runtime = readRuntimeAuthConfig();
  const status = getAuthStatus();
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  const localAccountRequired = Boolean(proxmoxRuntime?.ldap.enabled);
  const recommendedSecureCookie = isConfiguredPublicOriginHttps();

  return {
    auth: status,
    localAccountRequired,
    deployment: {
      recommendedSecureCookie,
    },
    runtimeSaved: runtime
      ? {
          enabled: runtime.enabled,
          username: runtime.username,
          email: runtime.email,
          sessionTtlSeconds: runtime.sessionTtlSeconds,
          secureCookie: runtime.secureCookie,
          sessionSecretMasked: maskSecret(runtime.sessionSecret),
          updatedAt: runtime.updatedAt,
        }
      : null,
    envOverridesRuntime: false,
  };
}

export async function GET(request: NextRequest) {
  if (getAuthStatus().active) {
    const capability = await requireRequestCapability(request, "admin");
    if (!capability.ok) {
      return capability.response;
    }
  }

  return NextResponse.json({
    ok: true,
    ...buildAuthSetupStatus(),
  });
}

export async function POST(request: NextRequest) {
  const authStatus = getAuthStatus();
  let auditActor: ReturnType<typeof buildAuditActor> = {
    username: "bootstrap",
    role: "admin",
    authMethod: "local",
    userId: null,
  };

  if (authStatus.active) {
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
    auditActor = buildAuditActor(capability.session);
  }

  const gate = consumeRateLimit(`setup-auth:post:${getClientIp(request)}`, AUTH_SETUP_POST_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: AuthSetupBody;
  try {
    body = (await request.json()) as AuthSetupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const username = asNonEmptyString(body.username);
  const email = normalizeEmail(body.email);
  const password = asNonEmptyString(body.password);
  const autoLogin = asBoolean(body.autoLogin, false);
  const existingRuntimeAuth = readRuntimeAuthConfig();
  const hadRuntimeAuth = Boolean(existingRuntimeAuth);

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Fields required: username, email, password." },
      { status: 400 },
    );
  }

  const normalizedUsername = normalizeLocalUsernameInput(username);
  if (!normalizedUsername) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nom d’utilisateur invalide. Utilise 3-64 caractères alphanumériques, ., _ ou -.",
      },
      { status: 400 },
    );
  }

  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Adresse e-mail invalide." },
      { status: 400 },
    );
  }

  const passwordPolicyError = getPasswordPolicyError(password);
  if (passwordPolicyError) {
    return NextResponse.json(
      { ok: false, error: passwordPolicyError },
      { status: 400 },
    );
  }

  const passwordSalt = randomHex(16);
  const passwordHash = await hashPasswordWithSalt(password, passwordSalt);

  try {
    if (existingRuntimeAuth) {
      const now = new Date().toISOString();
      const nextUsers = existingRuntimeAuth.users.map((user) =>
        user.id === existingRuntimeAuth.primaryUserId
          ? {
              ...user,
              username: normalizedUsername,
              email,
              passwordHash,
              passwordSalt,
              updatedAt: now,
            }
          : user,
      );

      writeRuntimeAuthConfig({
        ...existingRuntimeAuth,
        enabled: true,
        username: normalizedUsername,
        email,
        passwordHash,
        passwordSalt,
        users: nextUsers,
        primaryUserId: existingRuntimeAuth.primaryUserId,
        sessionSecret: asNonEmptyString(body.sessionSecret) ?? existingRuntimeAuth.sessionSecret,
        sessionTtlSeconds: asPositiveInt(body.sessionTtlSeconds, existingRuntimeAuth.sessionTtlSeconds),
        secureCookie: asBoolean(body.secureCookie, existingRuntimeAuth.secureCookie || isConfiguredPublicOriginHttps()),
        updatedAt: now,
      });
    } else {
      writeRuntimeAuthConfig({
        enabled: true,
        username: normalizedUsername,
        email,
        passwordHash,
        passwordSalt,
        users: [
          {
            id: "local-admin-bootstrap",
            username: normalizedUsername,
            email,
            passwordHash,
            passwordSalt,
            role: "admin",
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLoginAt: null,
          },
        ],
        primaryUserId: "local-admin-bootstrap",
        sessionSecret: asNonEmptyString(body.sessionSecret) ?? randomHex(32),
        sessionTtlSeconds: asPositiveInt(body.sessionTtlSeconds, 60 * 60 * 12),
        secureCookie: asBoolean(body.secureCookie, isConfiguredPublicOriginHttps()),
      });
    }
    appendAuditLogEntry({
      severity: "info",
      category: "security",
      action: hadRuntimeAuth ? "auth.setup.update" : "auth.setup.create",
      summary: hadRuntimeAuth ? "Configuration d’auth mise à jour" : "Compte admin bootstrap créé",
      actor: auditActor,
      targetType: "auth",
      targetId: normalizedUsername,
      targetLabel: normalizedUsername,
      changes: [
        { field: "username", before: existingRuntimeAuth?.username ?? null, after: normalizedUsername },
        { field: "secureCookie", before: existingRuntimeAuth ? String(existingRuntimeAuth.secureCookie) : null, after: String(asBoolean(body.secureCookie, existingRuntimeAuth?.secureCookie ?? false)) },
      ],
      details: {
        email: email ?? "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save auth config.",
      },
      { status: 500 },
    );
  }

  const response = NextResponse.json({
    ok: true,
    message: hadRuntimeAuth ? "Configuration d’auth enregistrée." : "Compte administrateur créé.",
    ...buildAuthSetupStatus(),
  });

  if (autoLogin) {
    try {
      const primaryUserId = readRuntimeAuthConfig()?.primaryUserId ?? null;
      const session = await createSessionToken({
        userId: primaryUserId,
        username: normalizedUsername,
        role: "admin",
        authMethod: "local",
      });
      response.cookies.set({
        name: AUTH_COOKIE_NAME,
        value: session.token,
        httpOnly: true,
        sameSite: "lax",
        secure: session.secureCookie,
        path: "/",
        maxAge: session.maxAge,
      });
    } catch {
      // Account creation succeeded even if cookie bootstrap failed.
    }
  }

  return response;
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

  let body: AuthSetupBody = {};
  try {
    body = (await request.json()) as AuthSetupBody;
  } catch {
    body = {};
  }

  try {
    assertStrongConfirmation(
      body.confirmationText,
      "DELETE AUTH CONFIG",
      'Confirmation forte requise. Tape "DELETE AUTH CONFIG".',
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Confirmation invalide.",
      },
      { status: 400 },
    );
  }

  const authRuntime = readRuntimeAuthConfig();
  const secureCookie = authRuntime?.secureCookie ?? false;
  const proxmoxRuntime = readRuntimeProxmoxConfig();
  if (proxmoxRuntime?.ldap.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Suppression bloquée: LDAP activé. Un compte local UI doit rester disponible en permanence.",
        ...buildAuthSetupStatus(),
      },
      { status: 409 },
    );
  }

  deleteRuntimeAuthConfig();
  appendAuditLogEntry({
    severity: "warning",
    category: "security",
    action: "auth.setup.delete",
    summary: "Configuration d’auth UI supprimée",
    actor: buildAuditActor(capability.session),
    targetType: "auth",
    targetId: "runtime",
    targetLabel: "Auth UI",
    changes: [],
    details: {},
  });
  const response = NextResponse.json({
    ok: true,
    message: "Configuration d’auth UI supprimée.",
    ...buildAuthSetupStatus(),
  });

  // Expire current session cookie if present.
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: 0,
  });

  return response;
}
