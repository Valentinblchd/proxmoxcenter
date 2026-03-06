"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatRelativeTime } from "@/lib/ui/format";

type SyncAlert = {
  key: string;
  workloadId: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  href: string;
  staleSinceAt: string;
  lastSuccessAt: string;
  lastErrorAt: string | null;
  lastError: string | null;
};

type SyncStatusResponse = {
  ok?: boolean;
  alerts?: SyncAlert[];
};

const DISMISS_STORAGE_KEY = "proxcenter.sync.dismissed";

function readDismissedKeys() {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set<string>();
  }
}

function writeDismissedKeys(keys: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(Array.from(keys)));
}

export default function LiveSyncAlerts() {
  const pathname = usePathname();
  const router = useRouter();
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);

  useEffect(() => {
    if (pathname === "/login") {
      setAlerts([]);
      return;
    }

    let disposed = false;

    async function refreshStatus() {
      if (document.visibilityState !== "visible") return;

      try {
        const response = await fetch("/api/live-sync", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as SyncStatusResponse;
        if (!response.ok || payload.ok === false || !Array.isArray(payload.alerts)) {
          if (!disposed) setAlerts([]);
          return;
        }

        const dismissed = readDismissedKeys();
        const activeKeys = new Set(payload.alerts.map((alert) => alert.key));
        const nextDismissed = new Set(Array.from(dismissed).filter((key) => activeKeys.has(key)));
        if (nextDismissed.size !== dismissed.size) {
          writeDismissedKeys(nextDismissed);
        }

        if (!disposed) {
          setAlerts(payload.alerts.filter((alert) => !nextDismissed.has(alert.key)));
        }
      } catch {
        if (!disposed) setAlerts([]);
      }
    }

    void refreshStatus();

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 15_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshStatus();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname]);

  const visibleAlerts = useMemo(() => alerts.slice(0, 4), [alerts]);

  function dismissAlert(key: string) {
    const dismissed = readDismissedKeys();
    dismissed.add(key);
    writeDismissedKeys(dismissed);
    setAlerts((current) => current.filter((alert) => alert.key !== key));
  }

  if (pathname === "/login" || visibleAlerts.length === 0) {
    return null;
  }

  return (
    <aside className="sync-alert-tray" aria-live="assertive" aria-label="Alertes de synchronisation">
      {visibleAlerts.map((alert) => (
        <article key={alert.key} className="sync-alert-card">
          <button
            type="button"
            className="sync-alert-main"
            onClick={() => {
              dismissAlert(alert.key);
              router.push(alert.href);
            }}
          >
            <strong>Problème synchro VMID {alert.vmid}</strong>
            <p>
              {alert.name} • {alert.node}
            </p>
            <p>
              Plus de remontée depuis {formatRelativeTime(alert.lastSuccessAt)}
            </p>
            {alert.lastError ? <p className="sync-alert-error">{alert.lastError}</p> : null}
          </button>
          <button
            type="button"
            className="sync-alert-close"
            aria-label={`Fermer l’alerte VMID ${alert.vmid}`}
            onClick={() => dismissAlert(alert.key)}
          >
            ×
          </button>
        </article>
      ))}
    </aside>
  );
}
