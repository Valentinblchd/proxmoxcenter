import "server-only";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { proxmoxRawRequest, proxmoxRawRequestWithConfig, proxmoxRequest, proxmoxRequestWithConfig } from "@/lib/proxmox/client";

type TaskStatus = {
  status?: string;
  exitstatus?: string;
};

type StorageContentEntry = {
  volid?: string;
  ctime?: number;
  size?: number;
  content?: string;
};

type NodeStorageEntry = {
  storage?: string;
  content?: string;
  enabled?: number;
  active?: number;
};

type DownloadUrlPayload = {
  url?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asNonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function storageHasBackupContent(value: string | undefined) {
  if (typeof value !== "string") return false;
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .some((item) => item === "backup");
}

export async function startVzdumpJob(options: {
  node: string;
  vmid: number;
  mode?: "snapshot" | "suspend" | "stop";
  storage?: string | null;
}): Promise<string> {
  const params = new URLSearchParams();
  params.set("vmid", String(options.vmid));
  params.set("mode", options.mode ?? "snapshot");
  params.set("compress", "zstd");
  params.set("notes-template", "{{guestname}}-{{node}}");
  if (options.storage) {
    params.set("storage", options.storage);
  }

  return proxmoxRequest<string>(`nodes/${encodeURIComponent(options.node)}/vzdump`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: params.toString(),
  });
}

export async function waitForTaskResult(options: {
  node: string;
  upid: string;
  timeoutMs?: number;
  intervalMs?: number;
  shouldCancel?: () => boolean;
}) {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const start = Date.now();
  let cancellationSent = false;

  while (Date.now() - start < timeoutMs) {
    if (options.shouldCancel?.() && !cancellationSent) {
      cancellationSent = true;
      await cancelProxmoxTask({
        node: options.node,
        upid: options.upid,
      }).catch(() => undefined);
    }
    const task = await proxmoxRequest<TaskStatus>(
      `nodes/${encodeURIComponent(options.node)}/tasks/${encodeURIComponent(options.upid)}/status`,
    );
    if (task?.status === "stopped") {
      return {
        done: true,
        success: !cancellationSent && task.exitstatus === "OK",
        cancelled: cancellationSent,
        exitStatus: task.exitstatus ?? "unknown",
      };
    }
    await sleep(intervalMs);
  }

  return {
    done: false,
    success: false,
    cancelled: false,
    exitStatus: "timeout",
  };
}

export async function cancelProxmoxTask(options: { node: string; upid: string }) {
  const response = await proxmoxRawRequest(
    `nodes/${encodeURIComponent(options.node)}/tasks/${encodeURIComponent(options.upid)}`,
    {
      method: "DELETE",
    },
  );
  if (response.ok) {
    return true;
  }
  const text = await response.text().catch(() => "");
  throw new Error(text || `Impossible d’annuler la tâche ${options.upid}.`);
}

async function listBackupContent(node: string, storage: string) {
  try {
    const items = await proxmoxRequest<StorageContentEntry[]>(
      `nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=backup`,
    );
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function extractVolidFilename(volid: string) {
  const [, rest] = volid.split(":", 2);
  if (!rest) return null;
  const parts = rest.split("/");
  return parts.at(-1) ?? null;
}

export async function findLatestBackupVolume(options: {
  node: string;
  vmid: number;
  kind: "qemu" | "lxc";
  preferredStorage?: string | null;
}) {
  let detectedStorages: string[] = [];
  try {
    const storages = await proxmoxRequest<NodeStorageEntry[]>(
      `nodes/${encodeURIComponent(options.node)}/storage`,
    );
    detectedStorages = (Array.isArray(storages) ? storages : [])
      .filter((item) => item.enabled !== 0)
      .filter((item) => item.active !== 0)
      .filter((item) => storageHasBackupContent(item.content))
      .map((item) => asNonEmpty(item.storage))
      .filter((item): item is string => Boolean(item));
  } catch {
    detectedStorages = [];
  }

  const storageCandidates = Array.from(
    new Set(
      [
        options.preferredStorage ?? null,
        ...detectedStorages,
        "local",
        "local-zfs",
        "local-lvm",
        "pbs",
      ].filter((item): item is string => Boolean(item)),
    ),
  );
  const pattern = new RegExp(`^vzdump-${options.kind}-${options.vmid}-`, "i");

  let winner:
    | {
        storage: string;
        volid: string;
        filename: string;
        ctime: number;
        size: number;
      }
    | null = null;

  for (const storage of storageCandidates) {
    const entries = await listBackupContent(options.node, storage);
    for (const entry of entries) {
      const volid = asNonEmpty(entry.volid);
      if (!volid) continue;
      const filename = extractVolidFilename(volid);
      if (!filename || !pattern.test(filename)) continue;

      const ctime = typeof entry.ctime === "number" ? entry.ctime : 0;
      const size = typeof entry.size === "number" ? entry.size : 0;
      if (!winner || ctime > winner.ctime) {
        winner = {
          storage,
          volid,
          filename,
          ctime,
          size,
        };
      }
    }
  }

  return winner;
}

async function tryDownloadByDirectContent(options: {
  node: string;
  storage: string;
  volid: string;
}) {
  const config = getProxmoxConfig();
  if (!config) return null;

  const response = await proxmoxRawRequestWithConfig(
    config,
    `nodes/${encodeURIComponent(options.node)}/storage/${encodeURIComponent(options.storage)}/content/${encodeURIComponent(options.volid)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return null;
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) return null;
  return {
    bytes: buffer,
    contentType: contentType || "application/octet-stream",
  };
}

async function tryDownloadByDownloadUrl(options: {
  node: string;
  storage: string;
  filename: string;
}) {
  const config = getProxmoxConfig();
  if (!config) return null;

  const data = await proxmoxRequestWithConfig<DownloadUrlPayload>(
    config,
    `nodes/${encodeURIComponent(options.node)}/storage/${encodeURIComponent(options.storage)}/download-url?content=backup&filename=${encodeURIComponent(options.filename)}`,
    {
      method: "GET",
    },
  ).catch(() => null);

  if (!data?.url || typeof data.url !== "string") return null;

  const response = await fetch(data.url, {
    method: "GET",
    headers: {
      Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`,
      Accept: "application/octet-stream",
    },
  });

  if (!response.ok) return null;

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function downloadBackupVolume(options: {
  node: string;
  storage: string;
  volid: string;
  filename: string;
}) {
  const direct = await tryDownloadByDirectContent({
    node: options.node,
    storage: options.storage,
    volid: options.volid,
  });
  if (direct) return direct;

  const downloadUrl = await tryDownloadByDownloadUrl({
    node: options.node,
    storage: options.storage,
    filename: options.filename,
  });
  if (downloadUrl) return downloadUrl;

  throw new Error(
    "Impossible de récupérer le fichier backup via API Proxmox (endpoint de download indisponible ou refusé).",
  );
}
