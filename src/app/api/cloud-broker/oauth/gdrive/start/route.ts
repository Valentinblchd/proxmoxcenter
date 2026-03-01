import { NextRequest, NextResponse } from "next/server";
import {
  getBrokerClientConfig,
  issueBrokerGoogleOauthState,
  parseBrokerTargetOrigin,
} from "@/lib/backups/cloud-oauth-broker";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getClientIp, getTrustedOriginForRequest } from "@/lib/security/request-guards";

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

export async function GET(request: NextRequest) {
  const gate = consumeRateLimit(`broker:gdrive:start:${getClientIp(request)}`, OAUTH_START_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives OAuth Google Drive. Réessaie plus tard." },
      { status: 429 },
    );
  }

  const targetOrigin = parseBrokerTargetOrigin(request.nextUrl.searchParams.get("origin"));
  if (!targetOrigin) {
    return NextResponse.json(
      { ok: false, error: "Origine cible invalide pour le broker OAuth." },
      { status: 400 },
    );
  }

  const broker = getBrokerClientConfig("gdrive");
  if (!broker.ready || !broker.clientId || !broker.clientSecret) {
    return NextResponse.json(
      { ok: false, error: "Broker Google Drive non configuré." },
      { status: 503 },
    );
  }

  const brokerOrigin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
  const redirectUri = `${brokerOrigin}/api/cloud-broker/oauth/gdrive/callback`;
  const oauth = issueBrokerGoogleOauthState({
    clientId: broker.clientId,
    clientSecret: broker.clientSecret,
    redirectUri,
    targetOrigin,
  });

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", broker.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authorizeUrl.searchParams.set("state", oauth.id);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent select_account");
  authorizeUrl.searchParams.set("include_granted_scopes", "true");

  return NextResponse.redirect(authorizeUrl);
}
