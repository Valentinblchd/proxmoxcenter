import { NextRequest, NextResponse } from "next/server";
import {
  getBrokerClientConfig,
  getCloudOauthBrokerAllowlistStatus,
  isAllowedBrokerTargetOrigin,
  issueBrokerOneDriveOauthState,
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

const ONEDRIVE_SCOPES = "offline_access Files.ReadWrite User.Read";

export async function GET(request: NextRequest) {
  const gate = consumeRateLimit(`broker:onedrive:start:${getClientIp(request)}`, OAUTH_START_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives OAuth OneDrive. Réessaie plus tard." },
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

  const allowlist = getCloudOauthBrokerAllowlistStatus();
  if (!allowlist.configured) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Broker OAuth non prêt: configure PROXMOXCENTER_CLOUD_OAUTH_BROKER_ALLOWED_ORIGINS avec les origins clientes autorisées.",
      },
      { status: 503 },
    );
  }

  if (!isAllowedBrokerTargetOrigin(targetOrigin)) {
    return NextResponse.json(
      { ok: false, error: "Origine cible refusée par le broker OAuth." },
      { status: 403 },
    );
  }

  const broker = getBrokerClientConfig("onedrive");
  if (!broker.ready || !broker.clientId) {
    return NextResponse.json(
      { ok: false, error: "Broker OneDrive non configuré." },
      { status: 503 },
    );
  }

  const brokerOrigin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
  const redirectUri = `${brokerOrigin}/api/cloud-broker/oauth/onedrive/callback`;
  const oauth = issueBrokerOneDriveOauthState({
    clientId: broker.clientId,
    clientSecret: broker.clientSecret,
    authority: broker.authority ?? "consumers",
    redirectUri,
    targetOrigin,
  });

  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(broker.authority ?? "consumers")}/oauth2/v2.0/authorize`,
  );
  authorizeUrl.searchParams.set("client_id", broker.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", ONEDRIVE_SCOPES);
  authorizeUrl.searchParams.set("state", oauth.id);
  authorizeUrl.searchParams.set("prompt", "select_account");
  authorizeUrl.searchParams.set("code_challenge", oauth.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(authorizeUrl);
}
