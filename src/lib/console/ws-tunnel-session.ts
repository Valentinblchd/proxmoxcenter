import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type ConsoleWsTunnelSession = {
  id: string;
  upstreamWsUrl: string;
  ticket: string | null;
  proxmoxOrigin: string;
  proxmoxAuthHeader: string | null;
  tlsMode: "strict" | "insecure" | "custom-ca";
  allowInsecureTls: boolean;
  customCaCertPem: string | null;
  createdAt: number;
  expiresAt: number;
};

const SESSION_TTL_MS = 2 * 60 * 1000;

function getDefaultSessionDir() {
  return path.join(process.cwd(), "data", "console-ws");
}

export function getConsoleWsSessionDir() {
  const custom =
    process.env.PROXMOXCENTER_CONSOLE_WS_DIR?.trim() ||
    process.env.PROXCENTER_CONSOLE_WS_DIR?.trim() ||
    "";
  return custom || getDefaultSessionDir();
}

function ensureSessionDir() {
  const dir = getConsoleWsSessionDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function buildSessionFilePath(id: string) {
  return path.join(getConsoleWsSessionDir(), `${id}.json`);
}

function createSessionId() {
  return randomBytes(24).toString("base64url");
}

export function buildConsoleWsPath(id: string) {
  return `/api/console/ws/${encodeURIComponent(id)}`;
}

export function cleanupExpiredConsoleWsSessions(now = Date.now()) {
  const dir = ensureSessionDir();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as { expiresAt?: unknown };
      const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
      if (expiresAt <= now) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      fs.rmSync(filePath, { force: true });
    }
  }
}

export function createConsoleWsTunnelSession(input: {
  upstreamWsUrl: string;
  ticket?: string | null;
  proxmoxOrigin: string;
  proxmoxAuthHeader?: string | null;
  tlsMode: "strict" | "insecure" | "custom-ca";
  allowInsecureTls?: boolean;
  customCaCertPem?: string | null;
}) {
  cleanupExpiredConsoleWsSessions();
  ensureSessionDir();

  const id = createSessionId();
  const now = Date.now();
  const session: ConsoleWsTunnelSession = {
    id,
    upstreamWsUrl: input.upstreamWsUrl,
    ticket: input.ticket ?? null,
    proxmoxOrigin: input.proxmoxOrigin,
    proxmoxAuthHeader: input.proxmoxAuthHeader ?? null,
    tlsMode: input.tlsMode,
    allowInsecureTls: Boolean(input.allowInsecureTls),
    customCaCertPem: input.customCaCertPem ?? null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  const filePath = buildSessionFilePath(id);
  fs.writeFileSync(filePath, `${JSON.stringify(session)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    id,
    wsPath: buildConsoleWsPath(id),
    expiresAt: session.expiresAt,
  };
}
