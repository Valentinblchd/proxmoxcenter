import { NextRequest } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import {
  getProxmoxFetchDispatcher,
  getProxmoxAuthHeaderValue,
  getProxmoxConfig,
} from "@/lib/proxmox/config";
import { ensureSameOriginRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "host",
]);

const BLOCKED_UPSTREAM_PATHS = [
  /^access\/ticket(?:\/|$)/i,
  /^access\/password(?:\/|$)/i,
] as const;

async function getParams(context: RouteContext): Promise<{ path: string[] }> {
  return await context.params;
}

function buildUpstreamUrl(pathParts: string[], requestUrl: URL, baseUrl: string) {
  const upstream = new URL(
    `/api2/json/${pathParts.map(encodeURIComponent).join("/")}`,
    `${baseUrl.replace(/\/+$/, "")}/`,
  );
  upstream.search = requestUrl.search;
  return upstream;
}

function buildSecurityHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  } as const;
}

function makeUpstreamHeaders(request: NextRequest, authHeader: string) {
  const headers = new Headers();
  headers.set("Authorization", authHeader);

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }

  const csrfToken = request.headers.get("CSRFPreventionToken");
  if (csrfToken) {
    headers.set("CSRFPreventionToken", csrfToken);
  }

  return headers;
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const capability = await requireRequestCapability(request, "admin");
  if (!capability.ok) {
    return capability.response;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const originCheck = ensureSameOriginRequest(request);
    if (!originCheck.ok) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          details: originCheck.reason,
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json; charset=utf-8",
            ...buildSecurityHeaders(),
          },
        },
      );
    }
  }

  const config = getProxmoxConfig();
  if (!config) {
    return new Response(
      JSON.stringify({
        error: "Proxmox credentials are not configured on the server.",
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...buildSecurityHeaders(),
        },
      },
    );
  }

  const { path } = await getParams(context);
  if (!path || path.length === 0) {
    return new Response(
      JSON.stringify({ error: "Missing Proxmox API path." }),
      {
        status: 400,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...buildSecurityHeaders(),
        },
      },
    );
  }

  const joinedPath = path.join("/");
  if (BLOCKED_UPSTREAM_PATHS.some((pattern) => pattern.test(joinedPath))) {
    return new Response(
      JSON.stringify({
        error: "Forbidden",
        details: "Cette route Proxmox n’est pas exposée via ProxmoxCenter.",
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...buildSecurityHeaders(),
        },
      },
    );
  }

  const upstreamUrl = buildUpstreamUrl(path, request.nextUrl, config.baseUrl);
  const headers = makeUpstreamHeaders(request, getProxmoxAuthHeaderValue(config));

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    body = text.length > 0 ? text : undefined;
  }

  let upstreamResponse: Response;
  try {
    const dispatcher = getProxmoxFetchDispatcher(config);
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      ...(dispatcher ? ({ dispatcher } as RequestInit) : {}),
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to reach Proxmox API.",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...buildSecurityHeaders(),
        },
      },
    );
  }

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  Object.entries(buildSecurityHeaders()).forEach(([key, value]) => {
    responseHeaders.set(key, value);
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}
