import { NextRequest, NextResponse } from "next/server";
import { issueOneDriveOauthState } from "@/lib/backups/onedrive-oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  ensureTrustedNavigationRequest,
  getClientIp,
  getTrustedOriginForRequest,
} from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_START_LIMIT = {
  windowMs: 5 * 60_000,
  max: 30,
  blockMs: 10 * 60_000,
} as const;

const ONEDRIVE_SCOPES = "offline_access Files.ReadWrite User.Read";

function asNonEmptyString(value: string | null, maxLength = 300) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeAuthority(value: string | null) {
  const trimmed = asNonEmptyString(value, 80);
  if (!trimmed) return "consumers";
  if (!/^[a-z0-9._-]+$/i.test(trimmed)) return "consumers";
  return trimmed;
}

export async function GET(request: NextRequest) {
  const originCheck = ensureTrustedNavigationRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Forbidden: origine de requête invalide." },
      { status: 403 },
    );
  }

  const gate = consumeRateLimit(`backup:onedrive:start:${getClientIp(request)}`, OAUTH_START_LIMIT);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives OAuth OneDrive. Réessaie plus tard." },
      { status: 429 },
    );
  }

  const clientId = asNonEmptyString(request.nextUrl.searchParams.get("clientId"), 180);
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Client ID OneDrive requis." },
      { status: 400 },
    );
  }
  const authority = normalizeAuthority(request.nextUrl.searchParams.get("authority"));
  const origin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
  const redirectUri = `${origin}/api/backups/oauth/onedrive/callback`;
  const oauth = issueOneDriveOauthState({
    clientId,
    authority,
    redirectUri,
  });

  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/authorize`,
  );
  authorizeUrl.searchParams.set("client_id", clientId);
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
