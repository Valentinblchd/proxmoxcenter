"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type WorkloadKind = "qemu" | "lxc";
type WorkloadAction = "start" | "stop" | "shutdown" | "reboot";
type WorkloadStatus = "running" | "stopped" | "template";

type WorkloadActionButtonsProps = {
  node: string;
  vmid: number;
  kind: WorkloadKind;
  status: WorkloadStatus;
  actionable: boolean;
  consoleHref?: string | null;
};

type ActionResponse = {
  ok?: boolean;
  error?: string;
  upid?: string;
  message?: string;
};

type TaskStatusResponse = {
  ok?: boolean;
  error?: string;
  done?: boolean;
  success?: boolean | null;
  data?: {
    status?: string;
    exitstatus?: string;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function InventoryWorkloadActions({
  node,
  vmid,
  kind,
  status,
  actionable,
  consoleHref = null,
}: WorkloadActionButtonsProps) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<WorkloadAction | null>(null);
  const [hint, setHint] = useState<string>("");
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  async function pollTask(nodeName: string, upid: string) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(1200);

      const response = await fetch(
        `/api/workloads/task-status?node=${encodeURIComponent(nodeName)}&upid=${encodeURIComponent(upid)}`,
        { cache: "no-store" },
      );

      const payload = (await response.json().catch(() => ({}))) as TaskStatusResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Task polling failed.");
      }

      if (payload.done) {
        return payload;
      }
    }

    return null;
  }

  async function triggerAction(action: WorkloadAction) {
    if (!actionable || busyAction) return;

    setBusyAction(action);
    setHint("Envoi...");

    try {
      const response = await fetch("/api/workloads/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, vmid, kind, action }),
      });

      const payload = (await response.json().catch(() => ({}))) as ActionResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Action failed.");
      }

      if (!disposedRef.current) {
        setHint(payload.upid ? "Tâche en cours..." : "Action envoyée");
      }

      if (payload.upid) {
        try {
          const task = await pollTask(node, payload.upid);

          if (!disposedRef.current) {
            if (!task) {
              setHint("Action envoyée (suivi timeout)");
            } else if (task.success) {
              setHint("OK");
            } else {
              setHint(task.data?.exitstatus ? `Erreur: ${task.data.exitstatus}` : "Erreur tâche");
            }
          }
        } catch (error) {
          if (!disposedRef.current) {
            setHint(error instanceof Error ? error.message : "Erreur de suivi");
          }
        }
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      if (!disposedRef.current) {
        setHint(error instanceof Error ? error.message : "Erreur inconnue");
      }
    } finally {
      if (!disposedRef.current) {
        setBusyAction(null);
        setTimeout(() => {
          if (!disposedRef.current) {
            setHint("");
          }
        }, 2800);
      }
    }
  }

  const isRunning = status === "running";
  const disableStart = !actionable || isRunning || busyAction !== null;
  const disableStop = !actionable || !isRunning || busyAction !== null;
  const disableReboot = !actionable || !isRunning || busyAction !== null;

  return (
    <div className="inventory-action-cluster">
      {consoleHref ? (
        <a
          href={consoleHref}
          target="_blank"
          rel="noreferrer"
          className="inventory-inline-icon"
          title="Ouvrir console distante"
          aria-label="Console distante"
        >
          ⌨
        </a>
      ) : null}
      <button
        type="button"
        className="inventory-inline-icon"
        title="Start"
        aria-label="Start"
        disabled={disableStart}
        onClick={() => triggerAction("start")}
      >
        {busyAction === "start" ? "…" : "▶"}
      </button>
      <button
        type="button"
        className="inventory-inline-icon"
        title="Stop"
        aria-label="Stop"
        disabled={disableStop}
        onClick={() => triggerAction("stop")}
      >
        {busyAction === "stop" ? "…" : "■"}
      </button>
      <button
        type="button"
        className="inventory-inline-icon"
        title="Reboot"
        aria-label="Reboot"
        disabled={disableReboot}
        onClick={() => triggerAction("reboot")}
      >
        {busyAction === "reboot" ? "…" : "↻"}
      </button>
      <button
        type="button"
        className="inventory-inline-icon"
        title="Shutdown propre"
        aria-label="Shutdown"
        disabled={disableStop}
        onClick={() => triggerAction("shutdown")}
      >
        {busyAction === "shutdown" ? "…" : "⏻"}
      </button>
      {hint ? (
        <span className="inventory-action-hint" title={hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
