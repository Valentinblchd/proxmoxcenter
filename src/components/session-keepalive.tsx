"use client";

import { useEffect, useRef } from "react";

const SESSION_PING_MS = 45_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

export default function SessionKeepAlive() {
  const lastActivityAtRef = useRef(Date.now());

  useEffect(() => {
    const markActivity = () => {
      lastActivityAtRef.current = Date.now();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "focus",
      "mousemove",
      "touchstart",
    ];

    async function pingSession() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityAtRef.current > ACTIVE_WINDOW_MS) return;

      try {
        await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
      } catch {
        // Best-effort keepalive only.
      }
    }

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", markActivity);

    const timer = window.setInterval(() => {
      void pingSession();
    }, SESSION_PING_MS);

    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      document.removeEventListener("visibilitychange", markActivity);
    };
  }, []);

  return null;
}
