import { NextRequest, NextResponse } from "next/server";
import { getPasswordPolicyError } from "@/lib/auth/password-policy";
import { requireRequestCapability } from "@/lib/auth/authz";
import { normalizeRuntimeAuthUserRole } from "@/lib/auth/rbac";
import { hashPasswordWithSalt, randomHex } from "@/lib/auth/session";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import {
  addRuntimeAuthUser,
  deleteRuntimeAuthUser,
  listRuntimeAuthUsers,
  normalizeLocalUsernameInput,
  readRuntimeAuthConfig,
  revokeRuntimeAuthOtherSessions,
  revokeRuntimeAuthUserSessions,
  setRuntimeAuthPrimaryUser,
  setRuntimeAuthUserEnabled,
  updateRuntimeAuthUserRole,
  updateRuntimeAuthUserPassword,
} from "@/lib/auth/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";
import { assertStrongConfirmation } from "@/lib/security/strong-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_USERS_MUTATION_LIMIT = {
  windowMs: 10 * 60_000,
  max: 25,
  blockMs: 15 * 60_000,
} as const;

type LocalUserBody = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  userId?: unknown;
  enabled?: unknown;
  action?: unknown;
  confirmationText?: unknown;
};

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asEmailOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) return null;
  return email;
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

function buildPayload() {
  const runtimeAuth = readRuntimeAuthConfig();
  const users = listRuntimeAuthUsers();

  return {
    ok: true,
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      enabled: user.enabled,
      isPrimary: runtimeAuth?.primaryUserId === user.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      sessionRevokedAt: user.sessionRevokedAt,
    })),
    primaryUserId: runtimeAuth?.primaryUserId ?? null,
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

  const gate = consumeRateLimit(`settings:local-users:post:${getClientIp(request)}`, LOCAL_USERS_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications utilisateurs. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: LocalUserBody;
  try {
    body = (await request.json()) as LocalUserBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const username = normalizeLocalUsernameInput(body.username);
  const email = asEmailOrNull(body.email);
  const password = asNonEmptyString(body.password);
  const role = normalizeRuntimeAuthUserRole(body.role);

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "Utilisateur et mot de passe requis." },
      { status: 400 },
    );
  }

  const passwordPolicyError = getPasswordPolicyError(password);
  if (passwordPolicyError) {
    return NextResponse.json({ ok: false, error: passwordPolicyError }, { status: 400 });
  }

  try {
    const passwordSalt = randomHex(16);
    const passwordHash = await hashPasswordWithSalt(password, passwordSalt);
    addRuntimeAuthUser({
      username,
      email,
      passwordHash,
      passwordSalt,
      role,
    });
    appendAuditLogEntry({
      severity: "info",
      category: "security",
      action: "local-user.create",
      summary: `Compte local créé: ${username}`,
      actor: buildAuditActor(capability.session),
      targetType: "local-user",
      targetId: username,
      targetLabel: username,
      changes: [
        { field: "role", before: null, after: role },
        { field: "enabled", before: null, after: "true" },
      ],
      details: {
        email: email ?? "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible d’ajouter le compte local.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...buildPayload(),
    message: "Utilisateur local ajouté.",
  });
}

export async function PATCH(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`settings:local-users:patch:${getClientIp(request)}`, LOCAL_USERS_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications utilisateurs. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: LocalUserBody;
  try {
    body = (await request.json()) as LocalUserBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const userId = asNonEmptyString(body.userId);
  const action = asNonEmptyString(body.action);
  if (!userId || !action) {
    return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  }

  const currentUser = listRuntimeAuthUsers().find((entry) => entry.id === userId) ?? null;

  try {
    if (action === "primary") {
      setRuntimeAuthPrimaryUser(userId);
      if (currentUser) {
        appendAuditLogEntry({
          severity: "info",
          category: "security",
          action: "local-user.set-primary",
          summary: `Compte principal défini: ${currentUser.username}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [],
          details: {},
        });
      }
    } else if (action === "enabled") {
      const nextEnabled = asBoolean(body.enabled, true);
      setRuntimeAuthUserEnabled(userId, nextEnabled);
      if (currentUser) {
        appendAuditLogEntry({
          severity: nextEnabled ? "info" : "warning",
          category: "security",
          action: "local-user.enabled",
          summary: `${currentUser.username} ${nextEnabled ? "activé" : "désactivé"}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [{ field: "enabled", before: String(currentUser.enabled), after: String(nextEnabled) }],
          details: {},
        });
      }
    } else if (action === "role") {
      if (capability.session.authMethod === "local" && capability.session.userId === userId) {
        throw new Error("Ton propre rôle ne peut pas être modifié depuis ta session active.");
      }
      const nextRole = normalizeRuntimeAuthUserRole(body.role);
      updateRuntimeAuthUserRole(userId, nextRole);
      if (currentUser) {
        appendAuditLogEntry({
          severity: "warning",
          category: "security",
          action: "local-user.role",
          summary: `Rôle modifié pour ${currentUser.username}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [{ field: "role", before: currentUser.role, after: nextRole }],
          details: {},
        });
      }
    } else if (action === "password") {
      const password = asNonEmptyString(body.password);
      if (!password) {
        throw new Error("Mot de passe requis.");
      }
      const passwordPolicyError = getPasswordPolicyError(password);
      if (passwordPolicyError) {
        throw new Error(passwordPolicyError);
      }
      const passwordSalt = randomHex(16);
      const passwordHash = await hashPasswordWithSalt(password, passwordSalt);
      updateRuntimeAuthUserPassword(userId, passwordHash, passwordSalt);
      if (currentUser) {
        appendAuditLogEntry({
          severity: "warning",
          category: "security",
          action: "local-user.password",
          summary: `Mot de passe modifié pour ${currentUser.username}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [],
          details: {},
        });
      }
    } else if (action === "force-logout") {
      revokeRuntimeAuthUserSessions(userId);
      if (currentUser) {
        appendAuditLogEntry({
          severity: "warning",
          category: "security",
          action: "local-user.force-logout",
          summary: `Sessions révoquées pour ${currentUser.username}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [],
          details: {},
        });
      }
    } else if (action === "force-logout-others") {
      if (
        capability.session.authMethod !== "local" ||
        !capability.session.userId ||
        capability.session.userId !== userId
      ) {
        throw new Error("Cette action doit être lancée depuis la session locale du compte concerné.");
      }
      revokeRuntimeAuthOtherSessions(userId, capability.session.issuedAt);
      if (currentUser) {
        appendAuditLogEntry({
          severity: "warning",
          category: "security",
          action: "local-user.force-logout-others",
          summary: `Autres sessions révoquées pour ${currentUser.username}`,
          actor: buildAuditActor(capability.session),
          targetType: "local-user",
          targetId: currentUser.id,
          targetLabel: currentUser.username,
          changes: [],
          details: {},
        });
      }
    } else {
      throw new Error("Action inconnue.");
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible de modifier le compte local.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...buildPayload(),
    message: "Compte local mis à jour.",
  });
}

export async function DELETE(request: NextRequest) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`settings:local-users:delete:${getClientIp(request)}`, LOCAL_USERS_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications utilisateurs. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: LocalUserBody;
  try {
    body = (await request.json()) as LocalUserBody;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const userId = asNonEmptyString(body.userId);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Utilisateur requis." }, { status: 400 });
  }

  try {
    const user = listRuntimeAuthUsers().find((entry) => entry.id === userId) ?? null;
    const expectedText = `DELETE ${user?.username ?? "USER"}`;
    assertStrongConfirmation(
      body.confirmationText,
      expectedText,
      `Confirmation forte requise. Tape "${expectedText}".`,
    );
    deleteRuntimeAuthUser(userId);
    if (user) {
      appendAuditLogEntry({
        severity: "warning",
        category: "security",
        action: "local-user.delete",
        summary: `Compte local supprimé: ${user.username}`,
        actor: buildAuditActor(capability.session),
        targetType: "local-user",
        targetId: user.id,
        targetLabel: user.username,
        changes: [],
        details: {
          role: user.role,
          email: user.email ?? "",
        },
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible de supprimer le compte local.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...buildPayload(),
    message: "Compte local supprimé.",
  });
}
