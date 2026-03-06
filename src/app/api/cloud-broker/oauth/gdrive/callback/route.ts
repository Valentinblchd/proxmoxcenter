import { NextRequest, NextResponse } from "next/server";
import { consumeBrokerOauthState } from "@/lib/backups/cloud-oauth-broker";
import { CSP_NONCE_HEADER, createCspNonce, readCspNonce } from "@/lib/security/csp";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_CALLBACK_LIMIT = {
  windowMs: 5 * 60_000,
  max: 60,
  blockMs: 10 * 60_000,
} as const;

type PopupPayload =
  | {
      type: "proxcenter:gdrive-oauth";
      ok: true;
      refreshToken: string;
    }
  | {
      type: "proxcenter:gdrive-oauth";
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

function renderPopup(targetOrigin: string | null, payload: PopupPayload, nonce: string, status = 200) {
  const payloadLiteral = JSON.stringify(payload).replace(/</g, "\\u003c");
  const allowedOrigin = JSON.stringify(targetOrigin ?? "").replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connexion Google Drive</title>
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
      <h1>${payload.ok ? "Connexion Google Drive réussie" : "Connexion Google Drive"}</h1>
      <p id="status">${payload.ok ? "Transmission du refresh token..." : "Le flow OAuth a renvoyé une erreur."}</p>
    </section>
    <script nonce="${nonce}">
      (() => {
        const payload = ${payloadLiteral};
        const allowedOrigin = ${allowedOrigin};
        const statusEl = document.getElementById("status");
        if (statusEl) {
          statusEl.textContent = payload.ok
            ? "Refresh token transmis à ProxmoxCenter. Cette fenêtre va se fermer."
            : (payload.error || "Connexion refusée.");
        }
        try {
          if (allowedOrigin && window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, allowedOrigin);
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
  const nonce = readCspNonce(request.headers.get(CSP_NONCE_HEADER)) ?? createCspNonce();
  const gate = consumeRateLimit(`broker:gdrive:callback:${getClientIp(request)}`, OAUTH_CALLBACK_LIMIT);
  if (!gate.ok) {
    return renderPopup(
      null,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: "Trop de tentatives OAuth Google Drive. Réessaie plus tard.",
      },
      nonce,
      429,
    );
  }

  const error = asNonEmptyString(request.nextUrl.searchParams.get("error"), 120);
  if (error) {
    const description = asNonEmptyString(request.nextUrl.searchParams.get("error_description"), 320);
    return renderPopup(
      null,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: description ?? `Erreur OAuth: ${error}`,
      },
      nonce,
      400,
    );
  }

  const stateId = asNonEmptyString(request.nextUrl.searchParams.get("state"), 180);
  const authCode = asNonEmptyString(request.nextUrl.searchParams.get("code"), 4000);
  if (!stateId || !authCode) {
    return renderPopup(
      null,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: "Paramètres OAuth incomplets (state/code).",
      },
      nonce,
      400,
    );
  }

  const state = consumeBrokerOauthState(stateId);
  if (!state || state.provider !== "gdrive") {
    return renderPopup(
      null,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: "Session OAuth expirée. Relance “Connecter Google Drive”.",
      },
      nonce,
      400,
    );
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: state.clientId,
        client_secret: state.clientSecret,
        code: authCode,
        grant_type: "authorization_code",
        redirect_uri: state.redirectUri,
      }).toString(),
      cache: "no-store",
    });
  } catch {
    return renderPopup(
      state.targetOrigin,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: "Impossible de contacter Google OAuth.",
      },
      nonce,
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
      state.targetOrigin,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: providerError ?? `Échange du code OAuth refusé (${tokenResponse.status}).`,
      },
      nonce,
      502,
    );
  }

  const refreshToken = asNonEmptyString(
    typeof json?.refresh_token === "string" ? json.refresh_token : null,
    9000,
  );
  if (!refreshToken) {
    return renderPopup(
      state.targetOrigin,
      {
        type: "proxcenter:gdrive-oauth",
        ok: false,
        error: "Google n'a pas renvoyé de refresh token. Réessaie après avoir révoqué l'accès.",
      },
      nonce,
      502,
    );
  }

  return renderPopup(state.targetOrigin, {
    type: "proxcenter:gdrive-oauth",
    ok: true,
    refreshToken,
  }, nonce);
}
