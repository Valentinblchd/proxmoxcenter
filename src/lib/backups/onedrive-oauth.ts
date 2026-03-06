import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  consumePersistedOauthState,
  issuePersistedOauthState,
} from "@/lib/backups/oauth-state-store";

type OneDriveOauthState = {
  id: string;
  clientId: string;
  authority: string;
  redirectUri: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
};

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_KIND = "onedrive-local";

function toBase64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeCodeVerifier() {
  return toBase64Url(randomBytes(48));
}

function makeCodeChallenge(codeVerifier: string) {
  return toBase64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export function issueOneDriveOauthState(input: {
  clientId: string;
  authority: string;
  redirectUri: string;
}) {
  const codeVerifier = makeCodeVerifier();
  const state = issuePersistedOauthState({
    kind: OAUTH_STATE_KIND,
    ttlMs: OAUTH_STATE_TTL_MS,
    payload: {
      clientId: input.clientId,
      authority: input.authority,
      redirectUri: input.redirectUri,
      codeVerifier,
    },
  });
  return {
    id: state.id,
    codeChallenge: makeCodeChallenge(codeVerifier),
  };
}

export function consumeOneDriveOauthState(id: string) {
  return consumePersistedOauthState<
    Pick<OneDriveOauthState, "clientId" | "authority" | "redirectUri" | "codeVerifier">
  >({
    kind: OAUTH_STATE_KIND,
    id,
  });
}
