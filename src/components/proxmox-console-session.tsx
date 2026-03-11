"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type ConsoleTarget =
  | {
      type: "node-shell";
      node: string;
    }
  | {
      type: "lxc-shell";
      node: string;
      vmid: number;
    }
  | {
      type: "qemu-vnc";
      node: string;
      vmid: number;
      mode: "console" | "novnc" | "spice";
    };

type ConsoleSessionPayload = {
  ok?: boolean;
  error?: string;
  backend?: "terminal" | "novnc";
  wsPath?: string;
  ticket?: string;
  title?: string;
  warning?: string | null;
};

type Props = {
  title: string;
  subtitle: string;
  target: ConsoleTarget;
};

type SessionState = "idle" | "loading" | "ready" | "error";

declare const ResizeObserver: {
  prototype: ResizeObserver;
  new (callback: ResizeObserverCallback): ResizeObserver;
};

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function wsHostLabel(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function toAbsoluteWsUrl(wsPath: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${wsPath.startsWith("/") ? wsPath : `/${wsPath}`}`;
}

export default function ProxmoxConsoleSession({ title, subtitle, target }: Props) {
  const [state, setState] = useState<SessionState>("idle");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [wsTarget, setWsTarget] = useState("");
  const [activeBackend, setActiveBackend] = useState<"terminal" | "novnc">(
    target.type === "qemu-vnc" && target.mode !== "console" ? "novnc" : "terminal",
  );
  const sessionRef = useRef<ConsoleSessionPayload | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const noVncHostRef = useRef<HTMLDivElement | null>(null);

  const titleSuffix = useMemo(() => {
    if (target.type === "node-shell") return target.node;
    return `${target.node} • #${target.vmid}`;
  }, [target]);

  useEffect(() => {
    let disposed = false;
    let websocket: WebSocket | null = null;
    let keepAliveTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let initialResizeTimer: number | null = null;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let rfbInstance: { disconnect?: () => void; resizeSession?: boolean; scaleViewport?: boolean } | null = null;
    let lastResizeSignature = "";

    async function bootstrap() {
      setState("loading");
      setMessage("Initialisation de la console…");
      setWarning("");
      setWsTarget("");

      const response = await fetch("/api/console/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(target),
      });
      const payload = (await response.json().catch(() => ({}))) as ConsoleSessionPayload;
      if (!response.ok || !payload.ok || !payload.backend || !payload.wsPath) {
        throw new Error(payload.error || "Impossible d’ouvrir la console interne.");
      }
      if (disposed) return;
      sessionRef.current = payload;
      setActiveBackend(payload.backend);
      setWarning(asText(payload.warning));
      setWsTarget(asText(payload.wsPath));
      const browserWsUrl = toAbsoluteWsUrl(payload.wsPath);
      const connectionHint =
        asText(payload.warning) ||
        "Vérifie la connectivité Proxmox côté serveur et relance la session.";

      if (payload.backend === "novnc") {
        if (!noVncHostRef.current) {
          throw new Error("Surface noVNC indisponible.");
        }
        const mod = (await import("@novnc/novnc/lib/rfb")) as { default?: unknown };
        if (disposed) return;
        const RfbClass = (mod.default ?? mod) as new (
          target: Element,
          url: string,
          options?: Record<string, unknown>,
        ) => {
          addEventListener: (name: string, handler: EventListener) => void;
          removeEventListener?: (name: string, handler: EventListener) => void;
          disconnect?: () => void;
          resizeSession?: boolean;
          scaleViewport?: boolean;
          background?: string;
        };
        const rfb = new RfbClass(noVncHostRef.current, browserWsUrl, {
          credentials: payload.ticket ? { password: payload.ticket } : undefined,
        });
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.background = "#050b2b";
        const onConnect = () => {
          if (disposed) return;
          setState("ready");
          setMessage("Console connectée.");
        };
        const onDisconnect = () => {
          if (disposed) return;
          setState("error");
          setMessage(`${connectionHint} (session fermée)`);
        };
        rfb.addEventListener("connect", onConnect);
        rfb.addEventListener("disconnect", onDisconnect);
        rfbInstance = rfb;
        return;
      }

      if (!terminalHostRef.current) {
        throw new Error("Surface terminal indisponible.");
      }

      term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace',
        theme: {
          background: "#050b2b",
          foreground: "#e8ecff",
          cursor: "#ffb23f",
          selectionBackground: "rgba(69, 112, 255, 0.28)",
        },
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalHostRef.current);
      fitAddon.fit();
      term.focus();

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const socket = new WebSocket(browserWsUrl);
      websocket = socket;
      socket.binaryType = "arraybuffer";

      const sendResize = (cols: number, rows: number) => {
        if (socket.readyState !== WebSocket.OPEN || cols < 1 || rows < 1) return;
        const nextSignature = `${cols}x${rows}`;
        if (lastResizeSignature === nextSignature) return;
        lastResizeSignature = nextSignature;
        socket.send(`1:${cols}:${rows}:`);
      };

      const fitAndSyncResize = () => {
        if (!fitAddon || !term) return;
        fitAddon.fit();
        sendResize(term.cols, term.rows);
      };

      socket.onopen = () => {
        if (disposed || !term) return;
        initialResizeTimer = window.setTimeout(() => {
          fitAndSyncResize();
        }, 80);
        keepAliveTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("2");
          }
        }, 15_000);
        setState("ready");
        setMessage("Console connectée.");
      };

      socket.onmessage = async (event) => {
        if (!term) return;
        if (typeof event.data === "string") {
          term.write(event.data);
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          term.write(decoder.decode(new Uint8Array(event.data)));
          return;
        }
        if (event.data instanceof Blob) {
          const content = await event.data.arrayBuffer();
          term.write(decoder.decode(new Uint8Array(content)));
        }
      };

      socket.onerror = () => {
        if (disposed) return;
        setState("error");
        const host = wsHostLabel(browserWsUrl);
        setMessage(
          `Erreur WebSocket console. ${connectionHint}${
            host ? ` • ${host}` : ""
          }`,
        );
      };

      socket.onclose = () => {
        if (disposed) return;
        setState("error");
        const host = wsHostLabel(browserWsUrl);
        setMessage(
          `${connectionHint} (session fermée)${
            host ? ` • ${host}` : ""
          }`,
        );
      };

      const dataDisposable = term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(`0:${encoder.encode(data).byteLength}:${data}`);
        }
      });

      const resizeDisposable = term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
      });

      resizeObserver = new ResizeObserver(() => {
        fitAndSyncResize();
      });
      resizeObserver.observe(terminalHostRef.current);

      const cleanupTerminal = () => {
        dataDisposable.dispose();
        resizeDisposable.dispose();
      };

      (term as Terminal & { __cleanup__?: () => void }).__cleanup__ = cleanupTerminal;
    }

    bootstrap().catch((error) => {
      if (disposed) return;
      setState("error");
      setMessage(error instanceof Error ? error.message : "Console indisponible.");
    });

    return () => {
      disposed = true;
      if (keepAliveTimer !== null) {
        window.clearInterval(keepAliveTimer);
      }
      if (initialResizeTimer !== null) {
        window.clearTimeout(initialResizeTimer);
      }
      resizeObserver?.disconnect();
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
      if (term) {
        (term as Terminal & { __cleanup__?: () => void }).__cleanup__?.();
        term.dispose();
      }
      rfbInstance?.disconnect?.();
    };
  }, [target]);

  return (
    <section className="content content-wide console-session-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Console interne</p>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="topbar-meta">
          <span className={`inventory-badge ${state === "ready" ? "status-running" : state === "error" ? "status-stopped" : "status-template"}`}>
            {state === "loading" ? "Connexion" : state === "ready" ? "Connecté" : state === "error" ? "Erreur" : "Prêt"}
          </span>
          <span className="pill">{titleSuffix}</span>
        </div>
      </header>

      {warning || state === "error" ? (
        <section className="panel">
          <p className="warning">{warning || message}</p>
          {wsTarget ? <p className="muted">WebSocket cible: {wsTarget}</p> : null}
          {state === "error" ? (
            <div className="quick-actions">
              <button type="button" className="action-btn" onClick={() => window.location.reload()}>
                Réessayer
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel console-session-panel">
        <div className="panel-head">
          <h2>Session</h2>
          <span className="muted">{message || "En attente"}</span>
        </div>

        <div className="console-surface">
          <div
            ref={noVncHostRef}
            className={`console-surface-inner console-surface-vnc${activeBackend === "novnc" ? " is-active" : " is-hidden"}`}
          />
          <div
            ref={terminalHostRef}
            className={`console-surface-inner console-surface-terminal${activeBackend === "terminal" ? " is-active" : " is-hidden"}`}
          />
        </div>
      </section>
    </section>
  );
}
