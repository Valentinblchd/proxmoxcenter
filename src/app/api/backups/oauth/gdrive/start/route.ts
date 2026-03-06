import { NextRequest, NextResponse } from "next/server";
import { getCloudOauthBrokerStatus } from "@/lib/backups/cloud-oauth-broker";
import { readRuntimeCloudOauthAppConfig } from "@/lib/backups/oauth-app-config";
import { issueGoogleOauthState } from "@/lib/backups/google-oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp, getTrustedOriginForRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_START_LIMIT = {
  windowMs: 5 * 60_000,
  max: 30,
  blockMs: 10 * 60_000,
} as const;

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function asNonEmptyString(value: unknown, maxLength = 300) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export async function POST(request: NextRequest) {
  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: origine de requête invalide." },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`backup:gdrive:start:${getClientIp(request)}`, OAUTH_START_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives OAuth Google Drive. Réessaie plus tard." },
      { status: 429 },
    );
  }

  const broker = getCloudOauthBrokerStatus();
  if (broker.mode === "central") {
    if (!broker.brokerOrigin) {
      return NextResponse.json(
        { ok: false, error: "Service central OAuth ProxmoxCenter indisponible." },
        { status: 503 },
      );
    }
    const origin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
    const authorizeUrl = new URL("/api/cloud-broker/oauth/gdrive/start", broker.brokerOrigin);
    authorizeUrl.searchParams.set("origin", origin);
    return NextResponse.json({
      ok: true,
      authorizeUrl: authorizeUrl.toString(),
    });
  }

  let body: { clientId?: unknown; clientSecret?: unknown };
  try {
    body = (await request.json()) as { clientId?: unknown; clientSecret?: unknown };
  } catch {
    body = {};
  }

  const runtimeConfig = readRuntimeCloudOauthAppConfig();
  const clientId = asNonEmptyString(body.clientId, 200) ?? runtimeConfig.gdrive?.clientId ?? null;
  const clientSecret =
    asNonEmptyString(body.clientSecret, 600) ?? runtimeConfig.gdrive?.clientSecret ?? null;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: "Google Drive OAuth n'est pas encore configuré dans Paramètres -> Proxmox." },
      { status: 400 },
    );
  }

  const origin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
  const redirectUri = `${origin}/api/backups/oauth/gdrive/callback`;
  const oauth = issueGoogleOauthState({
    clientId,
    clientSecret,
    redirectUri,
  });

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authorizeUrl.searchParams.set("state", oauth.id);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent select_account");
  authorizeUrl.searchParams.set("include_granted_scopes", "true");

  return NextResponse.json({
    ok: true,
    authorizeUrl: authorizeUrl.toString(),
  });
}
