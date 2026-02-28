"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistantMemory } from "@/lib/assistant/memory";

export default function AssistantMemorySettings({
  memory,
}: {
  memory: AssistantMemory;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const hasMemory =
    Boolean(memory.firstName) ||
    memory.lastQuestions.length > 0 ||
    Boolean(memory.lastProvisionDraft) ||
    Boolean(memory.lastWorkloadAction);

  async function handleReset() {
    if (busy) return;

    const confirmed = window.confirm("Réinitialiser toute la mémoire IA ?");
    if (!confirmed) return;

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/assistant/memory", {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible de réinitialiser la mémoire IA.");
      }

      setMessage(payload.message || "Mémoire IA réinitialisée.");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erreur mémoire IA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm">
      <div className="row-line">
        <span>Prénom mémorisé</span>
        <strong>{memory.firstName ?? "—"}</strong>
      </div>
      <div className="row-line">
        <span>Questions mémorisées</span>
        <strong>{memory.lastQuestions.length}</strong>
      </div>
      <div className="row-line">
        <span>Dernière action</span>
        <strong>
          {memory.lastWorkloadAction
            ? `${memory.lastWorkloadAction.action} ${memory.lastWorkloadAction.kind.toUpperCase()} #${memory.lastWorkloadAction.vmid}`
            : "—"}
        </strong>
      </div>
      <div className="quick-actions">
        <button
          type="button"
          className="action-btn"
          onClick={handleReset}
          disabled={busy || !hasMemory}
        >
          {busy ? "Réinitialisation..." : "Reset mémoire IA"}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
