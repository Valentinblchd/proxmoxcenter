"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

type InventoryRefreshButtonProps = {
  auto?: boolean;
  intervalMs?: number;
};

export default function InventoryRefreshButton({
  auto = false,
  intervalMs = 5000,
}: InventoryRefreshButtonProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const refreshNow = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    startTransition(() => {
      router.refresh();
      window.setTimeout(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      }, 700);
    });
  }, [intervalMs, router]);

  useEffect(() => {
    if (!auto) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      refreshNow();
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [auto, intervalMs, refreshNow]);

  return (
    <div className="inventory-refresh-cluster">
      {auto ? (
        <span className="inventory-refresh-status" aria-live="polite">
          {refreshing ? "Mise à jour..." : "Auto actif"}
        </span>
      ) : null}
      <button
        type="button"
        className="inventory-ghost-btn"
        disabled={refreshing}
        onClick={refreshNow}
      >
        {refreshing ? "Actualisation..." : "Actualiser"}
      </button>
    </div>
  );
}
