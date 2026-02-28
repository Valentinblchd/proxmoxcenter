import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import {
  clearRuntimeCloudOauthAppConfig,
  getPublicCloudOauthAppStatus,
  writeRuntimeCloudOauthAppConfig,
  type CloudOauthProvider,
} from "@/lib/backups/oauth-app-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLOUD_OAUTH_MUTATION_LIMIT = {
  windowMs: 10 * 60_000,
  max: 20,
  blockMs: 15 * 60_000,
} as const;

type Body = {
  provider?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  authority?: unknown;
};

function asProvider(value: unknown): CloudOauthProvider | null {
  return value === "onedrive" || value === "gdrive" ? value : null;
}

function buildPayload() {
  return {
    ok: true,
    providers: getPublicCloudOauthAppStatus(),
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

  const gate = consumeRateLimit(
    `settings:cloud-oauth:post:${getClientIp(request)}`,
    CLOUD_OAUTH_MUTATION_LIMIT,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications OAuth cloud. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const provider = asProvider(body.provider);
  if (!provider) {
    return NextResponse.json({ ok: false, error: "Provider OAuth invalide." }, { status: 400 });
  }

  try {
    if (provider === "onedrive") {
      writeRuntimeCloudOauthAppConfig({
        provider,
        onedrive: {
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          authority: body.authority,
        },
      });
    } else {
      writeRuntimeCloudOauthAppConfig({
        provider,
        gdrive: {
          clientId: body.clientId,
          clientSecret: body.clientSecret,
        },
      });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Impossible d’enregistrer OAuth cloud." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ...buildPayload(),
    message:
      provider === "onedrive"
        ? "Application OAuth OneDrive enregistrée."
        : "Application OAuth Google Drive enregistrée.",
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

  const gate = consumeRateLimit(
    `settings:cloud-oauth:delete:${getClientIp(request)}`,
    CLOUD_OAUTH_MUTATION_LIMIT,
  );
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de modifications OAuth cloud. Réessaie plus tard." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const provider = asProvider(body.provider);
  if (!provider) {
    return NextResponse.json({ ok: false, error: "Provider OAuth invalide." }, { status: 400 });
  }

  clearRuntimeCloudOauthAppConfig(provider);
  return NextResponse.json({
    ...buildPayload(),
    message:
      provider === "onedrive"
        ? "Application OAuth OneDrive réinitialisée."
        : "Application OAuth Google Drive réinitialisée.",
  });
}
