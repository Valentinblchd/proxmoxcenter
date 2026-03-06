import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || process.env.PROXMOXCENTER_HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);

const CONSOLE_WS_PREFIX = "/api/console/ws/";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24,200}$/;

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeHost(value) {
  if (!value || typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim();
  if (!first) return null;
  if (first.includes("/") || first.includes("?") || first.includes("#") || first.includes("://")) return null;
  return first;
}

function normalizeProto(value) {
  if (!value || typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim().toLowerCase();
  if (first === "http" || first === "https") return first;
  return null;
}

function buildOriginFromHost(host, proto) {
  const normalizedHost = normalizeHost(host);
  const normalizedProto = normalizeProto(proto);
  if (!normalizedHost || !normalizedProto) return null;
  return normalizeOrigin(`${normalizedProto}://${normalizedHost}`);
}

function normalizePort(protocol, value) {
  if (value) return value;
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
}

function sameHostAndPort(left, right) {
  try {
    const l = new URL(left);
    const r = new URL(right);
    return l.hostname === r.hostname && normalizePort(l.protocol, l.port) === normalizePort(r.protocol, r.port);
  } catch {
    return false;
  }
}

function isAllowedOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin);
  if (!origin) return true;

  const accepted = new Set();
  const configured =
    normalizeOrigin(process.env.PROXMOXCENTER_PUBLIC_ORIGIN) ||
    normalizeOrigin(process.env.PROXCENTER_PUBLIC_ORIGIN);
  if (configured) accepted.add(configured);

  const forwardedOrigin = buildOriginFromHost(req.headers["x-forwarded-host"], req.headers["x-forwarded-proto"]);
  if (forwardedOrigin) accepted.add(forwardedOrigin);

  const guessedProto = req.socket.encrypted ? "https" : "http";
  const hostOrigin = buildOriginFromHost(req.headers.host, guessedProto);
  if (hostOrigin) accepted.add(hostOrigin);

  for (const candidate of accepted) {
    if (candidate === origin || sameHostAndPort(candidate, origin)) {
      return true;
    }
  }

  return false;
}

function writeUpgradeError(socket, statusCode, message) {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
  socket.destroy();
}

function getConsoleWsSessionDir() {
  const custom = process.env.PROXMOXCENTER_CONSOLE_WS_DIR || process.env.PROXCENTER_CONSOLE_WS_DIR;
  if (custom && custom.trim()) return custom.trim();
  return path.join(process.cwd(), "data", "console-ws");
}

function buildSessionFilePath(id) {
  return path.join(getConsoleWsSessionDir(), `${id}.json`);
}

function consumeSession(id) {
  if (!SESSION_ID_PATTERN.test(id)) return null;
  const filePath = buildSessionFilePath(id);
  if (!fs.existsSync(filePath)) return null;

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  } finally {
    fs.rmSync(filePath, { force: true });
  }

  try {
    const parsed = JSON.parse(raw);
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    if (expiresAt <= Date.now()) return null;

    const upstreamWsUrl = typeof parsed.upstreamWsUrl === "string" ? parsed.upstreamWsUrl.trim() : "";
    if (!upstreamWsUrl) return null;

    return {
      upstreamWsUrl,
      ticket: typeof parsed.ticket === "string" ? parsed.ticket : "",
      proxmoxOrigin: typeof parsed.proxmoxOrigin === "string" ? parsed.proxmoxOrigin : "",
      tlsMode: parsed.tlsMode === "custom-ca" ? "custom-ca" : parsed.tlsMode === "insecure" ? "insecure" : "strict",
      allowInsecureTls: Boolean(parsed.allowInsecureTls),
      customCaCertPem: typeof parsed.customCaCertPem === "string" ? parsed.customCaCertPem : "",
    };
  } catch {
    return null;
  }
}

function buildUpstreamSocket(session) {
  const headers = {};
  if (session.proxmoxOrigin) headers.Origin = session.proxmoxOrigin;
  if (session.ticket) {
    const safeTicket = session.ticket.replace(/[\r\n]/g, "");
    headers.Cookie = `PVEAuthCookie=${safeTicket}`;
  }

  const options = {
    headers,
    perMessageDeflate: false,
    rejectUnauthorized: true,
  };

  if (session.tlsMode === "insecure" || session.allowInsecureTls) {
    options.rejectUnauthorized = false;
  } else if (session.tlsMode === "custom-ca" && session.customCaCertPem) {
    options.rejectUnauthorized = true;
    options.ca = session.customCaCertPem;
  }

  return new WebSocket(session.upstreamWsUrl, options);
}

function bridgeSockets(downstream, upstream) {
  const pending = [];
  let pendingBytes = 0;
  const MAX_PENDING_BYTES = 256 * 1024;

  const flushPending = () => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    while (pending.length > 0) {
      const item = pending.shift();
      upstream.send(item.data, { binary: item.binary });
    }
    pendingBytes = 0;
  };

  downstream.on("message", (data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary });
      return;
    }

    if (upstream.readyState === WebSocket.CONNECTING) {
      const chunkSize = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
      if (pendingBytes + chunkSize > MAX_PENDING_BYTES) {
        downstream.close(1013, "Console busy");
        return;
      }
      pending.push({ data, binary });
      pendingBytes += chunkSize;
      return;
    }

    downstream.close(1011, "Upstream disconnected");
  });

  upstream.on("open", () => {
    flushPending();
  });

  upstream.on("message", (data, binary) => {
    if (downstream.readyState === WebSocket.OPEN) {
      downstream.send(data, { binary });
    }
  });

  downstream.on("close", (code, reason) => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(code || 1000, reason?.toString() || "client closed");
    }
  });

  upstream.on("close", (code, reason) => {
    if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) {
      downstream.close(code || 1000, reason?.toString() || "upstream closed");
    }
  });

  downstream.on("error", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(1011, "client websocket error");
    }
  });

  upstream.on("error", (error) => {
    if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) {
      downstream.close(1011, "upstream websocket error");
    }
    console.error("[console-ws] upstream error", error instanceof Error ? error.message : error);
  });
}

async function bootstrap() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const handleUpgrade = app.getUpgradeHandler();

  const proxyWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    try {
      const base = `http://${req.headers.host || "127.0.0.1"}`;
      const parsed = new URL(req.url || "/", base);

      if (!parsed.pathname.startsWith(CONSOLE_WS_PREFIX)) {
        handleUpgrade(req, socket, head);
        return;
      }

      if (!isAllowedOrigin(req)) {
        writeUpgradeError(socket, 403, "Forbidden");
        return;
      }

      const sessionId = decodeURIComponent(parsed.pathname.slice(CONSOLE_WS_PREFIX.length));
      const session = consumeSession(sessionId);
      if (!session) {
        writeUpgradeError(socket, 404, "Session not found");
        return;
      }

      proxyWss.handleUpgrade(req, socket, head, (downstream) => {
        const upstream = buildUpstreamSocket(session);
        bridgeSockets(downstream, upstream);
      });
      return;
    } catch (error) {
      console.error("[console-ws] upgrade error", error instanceof Error ? error.message : error);
      writeUpgradeError(socket, 500, "Upgrade failed");
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> ProxmoxCenter ready on http://${hostname}:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] startup failed", error);
  process.exit(1);
});
