import "server-only";
import {
  applyProxmoxTlsMode,
  getProxmoxFetchDispatcher,
  getProxmoxAuthHeaderValue,
  getProxmoxConfig,
  type ProxmoxConfig,
} from "@/lib/proxmox/config";

export class ProxmoxConfigError extends Error {
  constructor(message = "Proxmox environment variables are missing or invalid.") {
    super(message);
    this.name = "ProxmoxConfigError";
  }
}

type ProxmoxEnvelope<T> = {
  data: T;
};

function buildApiUrl(baseUrl: string, path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(`/api2/json/${normalizedPath}`, `${baseUrl.replace(/\/+$/, "")}/`);
}

function buildRequestHeaders(init: RequestInit, authHeader: string) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function proxmoxRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const config = getProxmoxConfig();
  if (!config) {
    throw new ProxmoxConfigError();
  }

  return proxmoxRequestWithConfig<T>(config, path, init);
}

export async function proxmoxRequestWithConfig<T>(
  config: ProxmoxConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await proxmoxRawRequestWithConfig(config, path, init);

  const text = await response.text();
  let parsed: unknown = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from Proxmox (${response.status}).`);
    }
  }

  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && parsed !== null && "errors" in parsed
        ? JSON.stringify(parsed)
        : text || `HTTP ${response.status}`;
    throw new Error(`Proxmox API error: ${message}`);
  }

  if (parsed && typeof parsed === "object" && "data" in (parsed as object)) {
    return (parsed as ProxmoxEnvelope<T>).data;
  }

  return parsed as T;
}

export async function proxmoxRawRequestWithConfig(
  config: ProxmoxConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  applyProxmoxTlsMode(config);
  const headers = buildRequestHeaders(init, getProxmoxAuthHeaderValue(config));
  const dispatcher = getProxmoxFetchDispatcher(config);
  return fetch(buildApiUrl(config.baseUrl, path), {
    ...init,
    headers,
    cache: "no-store",
    ...(dispatcher ? ({ dispatcher } as RequestInit) : {}),
  });
}

export async function proxmoxRawRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const config = getProxmoxConfig();
  if (!config) {
    throw new ProxmoxConfigError();
  }

  return proxmoxRawRequestWithConfig(config, path, init);
}
