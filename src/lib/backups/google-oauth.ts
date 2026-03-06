import "server-only";
import {
  consumePersistedOauthState,
  issuePersistedOauthState,
} from "@/lib/backups/oauth-state-store";

type GoogleOauthState = {
  id: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
};

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const OAUTH_STATE_KIND = "google-local";

export function issueGoogleOauthState(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  return issuePersistedOauthState({
    kind: OAUTH_STATE_KIND,
    ttlMs: OAUTH_STATE_TTL_MS,
    payload: {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      redirectUri: input.redirectUri,
    },
  });
}

export function consumeGoogleOauthState(id: string) {
  return consumePersistedOauthState<Pick<GoogleOauthState, "clientId" | "clientSecret" | "redirectUri">>({
    kind: OAUTH_STATE_KIND,
    id,
  });
}
