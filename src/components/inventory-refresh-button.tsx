"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

type InventoryRefreshButtonProps = {
  auto?: boolean;
  intervalMs?: number;
};

export default function InventoryRefreshButton({
  auto = false,
  intervalMs = 10000,
}: InventoryRefreshButtonProps) {
  const router = useRouter();
  const refreshingRef = useRef(false);
  const lastActivityAtRef = useRef(Date.now());

  useEffect(() => {
    if (!auto) return;

    const markActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    const refreshNow = () => {
      if (document.visibilityState !== "visible" || refreshingRef.current) {
        return;
      }
      if (Date.now() - lastActivityAtRef.current < Math.max(4000, intervalMs / 2)) {
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
        markActivity();
        refreshNow();
      }
    };

    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("mousemove", markActivity, { passive: true });
    window.addEventListener("touchstart", markActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("mousemove", markActivity);
      window.removeEventListener("touchstart", markActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [auto, intervalMs, router]);

  return null;
}
