import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { getProxmoxAuthHeaderValue, getProxmoxConfig } from "@/lib/proxmox/config";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { ensureSameOriginRequest } from "@/lib/security/request-guards";
import { createConsoleWsTunnelSession } from "@/lib/console/ws-tunnel-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsoleSessionRequest =
  | {
      target?: "node-shell";
      type?: "node-shell";
      node?: unknown;
    }
  | {
      target?: "lxc-shell";
      type?: "lxc-shell";
      node?: unknown;
      vmid?: unknown;
    }
  | {
      target?: "qemu-vnc";
      type?: "qemu-vnc";
      node?: unknown;
      vmid?: unknown;
      mode?: unknown;
    };

type ProxmoxConsoleTicket = {
  user?: string;
  ticket?: string;
  port?: number;
  upid?: string;
  cert?: string;
};

function asText(value: unknown, max = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function asPositiveInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function toWsBase(baseUrl: string) {
  return baseUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:").replace(/\/+$/, "");
}

function buildTlsWarning(config: NonNullable<ReturnType<typeof getProxmoxConfig>>) {
  if (config.protocol !== "https") return null;
  if (config.tlsMode === "insecure" || config.allowInsecureTls) {
    return "Console via tunnel interne: TLS Proxmox est en mode permissif côté serveur.";
  }
  if (config.tlsMode === "custom-ca") {
    return "Console via tunnel interne: CA personnalisée utilisée côté serveur.";
  }
  return null;
}

function ticketPayloadToResponse(payload: ProxmoxConsoleTicket) {
  const ticket = asText(payload.ticket, 2000);
  const port = asPositiveInt(payload.port);
  if (!ticket || !port) {
    throw new Error("Réponse console Proxmox incomplète.");
  }
  return { ticket, port };
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: originCheck.reason }, { status: 403 });
  }

  const proxmox = getProxmoxConfig();
  if (!proxmox) {
    return NextResponse.json({ ok: false, error: "Connexion Proxmox absente." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as ConsoleSessionRequest;
  const target = asText(body.target ?? body.type, 24);
  const node = asText(body.node, 120);
  const vmid = "vmid" in body ? asPositiveInt(body.vmid) : null;

  if (!target || !node) {
    return NextResponse.json({ ok: false, error: "Cible console invalide." }, { status: 400 });
  }

  try {
    if (target === "node-shell") {
      const ticketData = await proxmoxRequest<ProxmoxConsoleTicket>(`nodes/${encodeURIComponent(node)}/termproxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ cmd: "shell" }).toString(),
      });
      const { ticket, port } = ticketPayloadToResponse(ticketData);
      const wsUrl = `${toWsBase(proxmox.baseUrl)}/api2/json/nodes/${encodeURIComponent(node)}/vncwebsocket?port=${encodeURIComponent(String(port))}&vncticket=${encodeURIComponent(ticket)}`;
      const session = createConsoleWsTunnelSession({
        upstreamWsUrl: wsUrl,
        ticket,
        proxmoxOrigin: proxmox.baseUrl,
        proxmoxAuthHeader: getProxmoxAuthHeaderValue(proxmox),
        tlsMode: proxmox.tlsMode,
        allowInsecureTls: proxmox.allowInsecureTls,
        customCaCertPem: proxmox.customCaCertPem,
      });
      return NextResponse.json({
        ok: true,
        backend: "terminal",
        wsPath: session.wsPath,
        ticket,
        port,
        title: `Console ${node}`,
        warning: buildTlsWarning(proxmox),
      });
    }

    if (target === "lxc-shell" && vmid) {
      const ticketData = await proxmoxRequest<ProxmoxConsoleTicket>(`nodes/${encodeURIComponent(node)}/lxc/${vmid}/termproxy`, {
        method: "POST",
      });
      const { ticket, port } = ticketPayloadToResponse(ticketData);
      const wsUrl = `${toWsBase(proxmox.baseUrl)}/api2/json/nodes/${encodeURIComponent(node)}/lxc/${vmid}/vncwebsocket?port=${encodeURIComponent(String(port))}&vncticket=${encodeURIComponent(ticket)}`;
      const session = createConsoleWsTunnelSession({
        upstreamWsUrl: wsUrl,
        ticket,
        proxmoxOrigin: proxmox.baseUrl,
        proxmoxAuthHeader: getProxmoxAuthHeaderValue(proxmox),
        tlsMode: proxmox.tlsMode,
        allowInsecureTls: proxmox.allowInsecureTls,
        customCaCertPem: proxmox.customCaCertPem,
      });
      return NextResponse.json({
        ok: true,
        backend: "terminal",
        wsPath: session.wsPath,
        ticket,
        port,
        title: `Console CT #${vmid}`,
        warning: buildTlsWarning(proxmox),
      });
    }

    if (target === "qemu-vnc" && vmid) {
      const mode = asText("mode" in body ? body.mode : null, 24) ?? "novnc";
      if (mode === "console") {
        const ticketData = await proxmoxRequest<ProxmoxConsoleTicket>(
          `nodes/${encodeURIComponent(node)}/qemu/${vmid}/termproxy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: new URLSearchParams({ serial: "0" }).toString(),
          },
        );
        const { ticket, port } = ticketPayloadToResponse(ticketData);
        const wsUrl = `${toWsBase(proxmox.baseUrl)}/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncwebsocket?port=${encodeURIComponent(String(port))}&vncticket=${encodeURIComponent(ticket)}`;
        const session = createConsoleWsTunnelSession({
          upstreamWsUrl: wsUrl,
          ticket,
          proxmoxOrigin: proxmox.baseUrl,
          proxmoxAuthHeader: getProxmoxAuthHeaderValue(proxmox),
          tlsMode: proxmox.tlsMode,
          allowInsecureTls: proxmox.allowInsecureTls,
          customCaCertPem: proxmox.customCaCertPem,
        });
        return NextResponse.json({
          ok: true,
          backend: "terminal",
          wsPath: session.wsPath,
          ticket,
          port,
          title: `Console série VM #${vmid}`,
          warning: buildTlsWarning(proxmox),
        });
      }

      const ticketData = await proxmoxRequest<ProxmoxConsoleTicket>(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncproxy`, {
        method: "POST",
      });
      const { ticket, port } = ticketPayloadToResponse(ticketData);
      const wsUrl = `${toWsBase(proxmox.baseUrl)}/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/vncwebsocket?port=${encodeURIComponent(String(port))}&vncticket=${encodeURIComponent(ticket)}`;
      const session = createConsoleWsTunnelSession({
        upstreamWsUrl: wsUrl,
        ticket,
        proxmoxOrigin: proxmox.baseUrl,
        proxmoxAuthHeader: getProxmoxAuthHeaderValue(proxmox),
        tlsMode: proxmox.tlsMode,
        allowInsecureTls: proxmox.allowInsecureTls,
        customCaCertPem: proxmox.customCaCertPem,
      });
      return NextResponse.json({
        ok: true,
        backend: "novnc",
        wsPath: session.wsPath,
        ticket,
        port,
        title: mode === "spice" ? `SPICE #${vmid}` : `Console VM #${vmid}`,
        warning:
          mode === "spice"
            ? "SPICE passe provisoirement par la session noVNC intégrée. Le téléchargement .vv viendra après."
            : buildTlsWarning(proxmox),
      });
    }

    return NextResponse.json({ ok: false, error: "Cible console non supportée." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible d’ouvrir la console.",
      },
      { status: 500 },
    );
  }
}
