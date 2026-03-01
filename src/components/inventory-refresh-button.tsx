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
  const [remainingMs, setRemainingMs] = useState(intervalMs);
  const refreshingRef = useRef(false);

  const refreshNow = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRemainingMs(intervalMs);
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

    let nextRefreshAt = Date.now() + intervalMs;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        nextRefreshAt = Date.now() + intervalMs;
        setRemainingMs(intervalMs);
        return;
      }

      const delta = nextRefreshAt - Date.now();
      if (delta <= 0) {
        refreshNow();
        nextRefreshAt = Date.now() + intervalMs;
        setRemainingMs(intervalMs);
        return;
      }

      setRemainingMs(delta);
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [auto, intervalMs, refreshNow]);

  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div className="inventory-refresh-cluster">
      {auto ? (
        <span className="inventory-refresh-status" aria-live="polite">
          {refreshing ? "Sync..." : `Auto ${remainingSeconds}s`}
        </span>
      ) : null}
      <button
        type="button"
        className="inventory-ghost-btn"
        disabled={refreshing}
        onClick={refreshNow}
      >
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}
