"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

type InventoryRefreshButtonProps = {
  auto?: boolean;
  intervalMs?: number;
};

export default function InventoryRefreshButton({
  auto = false,
  intervalMs = 2000,
}: InventoryRefreshButtonProps) {
  const router = useRouter();
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!auto) return;

    const refreshNow = () => {
      if (document.visibilityState !== "visible" || refreshingRef.current) {
        return;
      }

      refreshingRef.current = true;
      startTransition(() => {
        router.refresh();
      });
      window.setTimeout(() => {
        refreshingRef.current = false;
      }, 700);
    };

    const timer = window.setInterval(() => {
      refreshNow();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshNow();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [auto, intervalMs, router]);

  return null;
}
