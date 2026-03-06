import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openSecret, sealSecret } from "@/lib/security/secret-box";

type PersistedOauthState = {
  id: string;
  kind: string;
  createdAt: number;
  expiresAt: number;
  payloadCipher: string;
};

type PersistedOauthStateFile = {
  states: PersistedOauthState[];
};

function getDefaultOauthStatePath() {
  return path.join(process.cwd(), "data", "cloud-oauth-state.json");
}

function getOauthStatePath() {
  const custom = process.env.PROXMOXCENTER_CLOUD_OAUTH_STATE_PATH?.trim();
  return custom || getDefaultOauthStatePath();
}

function ensureStoreDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parsePersistedStateFile(raw: string) {
  if (!raw.trim()) return [] as PersistedOauthState[];

  try {
    const parsed = JSON.parse(raw) as PersistedOauthStateFile | PersistedOauthState[];
    if (Array.isArray(parsed)) {
      return parsed.filter(isPersistedOauthState);
    }
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.states)) {
      return parsed.states.filter(isPersistedOauthState);
    }
  } catch {
    // Ignore corrupted state file and fall back to an empty store.
  }

  return [] as PersistedOauthState[];
}

function isPersistedOauthState(value: unknown): value is PersistedOauthState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.expiresAt === "number" &&
    typeof record.payloadCipher === "string"
  );
}

function readStates(nowMs: number) {
  const filePath = getOauthStatePath();
  ensureStoreDirectory(filePath);
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const states = parsePersistedStateFile(raw);
  const activeStates = states.filter((state) => state.expiresAt > nowMs);
  return {
    filePath,
    states: activeStates,
    dirty: activeStates.length !== states.length,
  };
}

function writeStates(filePath: string, states: PersistedOauthState[]) {
  ensureStoreDirectory(filePath);
  const nextFile: PersistedOauthStateFile = { states };
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(nextFile, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort only.
  }
}

export function issuePersistedOauthState<TPayload extends Record<string, unknown>>(input: {
  kind: string;
  ttlMs: number;
  payload: TPayload;
}) {
  const nowMs = Date.now();
  const { filePath, states, dirty } = readStates(nowMs);
  const id = randomUUID();
  const nextState: PersistedOauthState = {
    id,
    kind: input.kind,
    createdAt: nowMs,
    expiresAt: nowMs + input.ttlMs,
    payloadCipher: sealSecret(JSON.stringify(input.payload)),
  };
  states.push(nextState);
  writeStates(filePath, states);
  return {
    id,
    createdAt: nextState.createdAt,
    expiresAt: nextState.expiresAt,
    pruned: dirty,
  };
}

export function consumePersistedOauthState<TPayload extends Record<string, unknown>>(input: {
  kind: string;
  id: string;
}) {
  const nowMs = Date.now();
  const { filePath, states } = readStates(nowMs);
  const stateIndex = states.findIndex(
    (state) => state.id === input.id && state.kind === input.kind,
  );
  if (stateIndex === -1) {
    writeStates(filePath, states);
    return null;
  }

  const [state] = states.splice(stateIndex, 1);
  writeStates(filePath, states);

  const payloadJson = openSecret(state.payloadCipher);
  if (!payloadJson) return null;

  try {
    const payload = JSON.parse(payloadJson) as TPayload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return {
      ...payload,
      id: state.id,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
    };
  } catch {
    return null;
  }
}
