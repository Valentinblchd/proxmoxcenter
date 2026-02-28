import "server-only";

import { proxmoxRequest } from "@/lib/proxmox/client";

type ProxmoxTaskStatus = {
  status?: string;
  exitstatus?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForNodeTask(
  node: string,
  upid: string,
  options: {
    attempts?: number;
    intervalMs?: number;
    timeoutMessage?: string;
  } = {},
) {
  const attempts = options.attempts ?? 40;
  const intervalMs = options.intervalMs ?? 1_200;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await proxmoxRequest<ProxmoxTaskStatus>(
      `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    );
    if (status?.status === "stopped") {
      if (status.exitstatus && status.exitstatus !== "OK") {
        throw new Error(status.exitstatus);
      }
      return status;
    }
    await sleep(intervalMs);
  }

  throw new Error(options.timeoutMessage ?? "Timeout lors du suivi de la tâche Proxmox.");
}
