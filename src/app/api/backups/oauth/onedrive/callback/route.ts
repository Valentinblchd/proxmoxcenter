import { NextRequest, NextResponse } from "next/server";
import { consumeOneDriveOauthState } from "@/lib/backups/onedrive-oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_CALLBACK_LIMIT = {
  windowMs: 5 * 60_000,
  max: 60,
  blockMs: 10 * 60_000,
} as const;

const ONEDRIVE_SCOPES = "offline_access Files.ReadWrite User.Read";

type PopupPayload =
  | {
      type: "proxcenter:onedrive-oauth";
      ok: true;
      refreshToken: string;
    }
  | {
      type: "proxcenter:onedrive-oauth";
      ok: false;
      error: string;
    };

function asNonEmptyString(value: string | null, maxLength = 2000) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function renderPopup(payload: PopupPayload, status = 200) {
  const payloadLiteral = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connexion OneDrive</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        place-items: center;
        background: radial-gradient(42rem 24rem at 15% 0%, rgba(65,199,255,.12), transparent 68%), #070b20;
        color: #eaf0ff;
        font-family: "Avenir Next", "Inter", system-ui, sans-serif;
      }
      .card {
        width: min(92vw, 420px);
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(13,18,42,.92);
        padding: 1rem;
      }
      h1 { margin: 0; font-size: 1rem; }
      p { margin: .65rem 0 0; color: #b8c4ea; line-height: 1.45; }
    </style>
  </head>
  <body>
    <section class="card">
      <h1>${payload.ok ? "Connexion OneDrive réussie" : "Connexion OneDrive"}</h1>
      <p id="status">${payload.ok ? "Transmission du refresh token..." : "Le flow OAuth a renvoyé une erreur."}</p>
    </section>
    <script>
      (() => {
        const payload = ${payloadLiteral};
        const statusEl = document.getElementById("status");
        if (statusEl) {
          statusEl.textContent = payload.ok
            ? "Refresh token transmis à ProxCenter. Cette fenêtre va se fermer."
            : (payload.error || "Connexion refusée.");
        }
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
          }
        } catch {}
        setTimeout(() => {
          window.close();
        }, payload.ok ? 900 : 1800);
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  const gate = consumeRateLimit(`backup:onedrive:callback:${getClientIp(request)}`, OAUTH_CALLBACK_LIMIT);
  if (!gate.ok) {
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: "Trop de tentatives OAuth OneDrive. Réessaie plus tard.",
      },
      429,
    );
  }

  const error = asNonEmptyString(request.nextUrl.searchParams.get("error"), 120);
  if (error) {
    const description = asNonEmptyString(request.nextUrl.searchParams.get("error_description"), 300);
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: description ?? `Erreur OAuth: ${error}`,
      },
      400,
    );
  }

  const stateId = asNonEmptyString(request.nextUrl.searchParams.get("state"), 180);
  const authCode = asNonEmptyString(request.nextUrl.searchParams.get("code"), 4000);
  if (!stateId || !authCode) {
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: "Paramètres OAuth incomplets (state/code).",
      },
      400,
    );
  }

  const state = consumeOneDriveOauthState(stateId);
  if (!state) {
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: "Session OAuth expirée. Relance “Connecter OneDrive”.",
      },
      400,
    );
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(state.authority)}/oauth2/v2.0/token`;
  const tokenParams = new URLSearchParams({
    client_id: state.clientId,
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: state.redirectUri,
    code_verifier: state.codeVerifier,
    scope: ONEDRIVE_SCOPES,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/json",
      },
      body: tokenParams.toString(),
      cache: "no-store",
    });
  } catch {
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: "Impossible de contacter Microsoft OAuth.",
      },
      502,
    );
  }

  const json = await parseJsonSafe(tokenResponse);
  if (!tokenResponse.ok) {
    const providerError = asNonEmptyString(
      typeof json?.error_description === "string" ? json.error_description : null,
      320,
    );
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: providerError ?? `Échange du code OAuth refusé (${tokenResponse.status}).`,
      },
      502,
    );
  }

  const refreshToken = asNonEmptyString(
    typeof json?.refresh_token === "string" ? json.refresh_token : null,
    9000,
  );
  if (!refreshToken) {
    return renderPopup(
      {
        type: "proxcenter:onedrive-oauth",
        ok: false,
        error: "Microsoft n'a pas renvoyé de refresh token.",
      },
      502,
    );
  }

  return renderPopup({
    type: "proxcenter:onedrive-oauth",
    ok: true,
    refreshToken,
  });
}
