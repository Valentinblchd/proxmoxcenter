"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/ui/format";

type NodeUpdateStatusProps = {
  live: boolean;
  node: string;
};

type NodeUpdateItem = {
  packageName: string;
  oldVersion: string | null;
  newVersion: string | null;
  origin: string | null;
  priority: string | null;
  title: string | null;
  description: string | null;
  changelog: string | null;
  security: boolean;
  urgent: boolean;
  rebootRequired: boolean;
  explanation: string;
  group: string;
  autoHotSafe: boolean;
};

type NodeUpdatesResponse = {
  ok?: boolean;
  node?: string;
  checkedAt?: string;
  counts?: {
    total: number;
    security: number;
    urgent: number;
    rebootRisk: number;
    autoHotSafe: number;
  };
  recommendation?: string;
  updates?: NodeUpdateItem[];
  error?: string;
};

export default function NodeUpdateStatus({ live, node }: NodeUpdateStatusProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<NodeUpdatesResponse | null>(null);
  const [error, setError] = useState("");
  const loadedRef = useRef("");

  const scan = useCallback(async (refresh = false) => {
    if (!live || !node) return;

    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const response = await fetch("/api/nodes/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, refresh }),
      });
      const payload = (await response.json().catch(() => ({}))) as NodeUpdatesResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Scan impossible (${response.status}).`);
      }
      setResult(payload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Erreur de scan.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [live, node]);

  useEffect(() => {
    setResult(null);
    setError("");
    if (!live || !node) {
      loadedRef.current = "";
      return;
    }
    const scope = `${node}:${live ? "1" : "0"}`;
    if (loadedRef.current === scope) return;
    loadedRef.current = scope;
    void scan(false);
  }, [live, node, scan]);

  const checkedAt =
    result?.checkedAt && !Number.isNaN(new Date(result.checkedAt).getTime())
      ? formatRelativeTime(result.checkedAt)
      : "";

  return (
    <section className="inventory-update-panel" aria-live="polite">
      <div className="inventory-update-head">
        <div className="inventory-update-title">
          <span className="muted">Mises à jour hôte</span>
          <strong>Proxmox {node}</strong>
        </div>
        <button
          type="button"
          className="inventory-ghost-btn"
          onClick={() => {
            void scan(true);
          }}
          disabled={!live || refreshing}
        >
          {refreshing ? "Refresh..." : "Rafraîchir APT"}
        </button>
      </div>

      <div className={`inventory-update-card tone-${error ? "error" : result?.counts?.urgent ? "warn" : "neutral"}`}>
        <div className="inventory-update-card-head">
          <strong>
            {!live
              ? "Connexion Proxmox requise"
              : loading
                ? "Scan en cours"
                : error
                  ? "Scan en erreur"
                  : result?.counts?.total
                    ? `${result.counts.total} paquet(s) à mettre à jour`
                    : "Hôte à jour"}
          </strong>
          {result?.counts ? (
            <span className={`inventory-update-count ${result.counts.urgent > 0 ? "warn" : "ok"}`}>
              {result.counts.urgent > 0 ? `${result.counts.urgent} urgent` : `${result.counts.total} MAJ`}
            </span>
          ) : null}
        </div>
        <p className="muted">
          {!live
            ? "Configure la connexion Proxmox pour lire les mises à jour du nœud."
            : loading
              ? "Lecture de l’état APT du nœud…"
              : error || result?.recommendation || "Aucune donnée."}
        </p>

        {result?.counts ? (
          <div className="inventory-update-meta">
            <span>Sécurité: {result.counts.security}</span>
            <span>Sans coupure estimée: {result.counts.autoHotSafe}</span>
            <span>Risque reboot: {result.counts.rebootRisk}</span>
            {checkedAt ? <span>Dernier scan: {checkedAt}</span> : null}
          </div>
        ) : null}
      </div>

      {result?.updates?.length ? (
        <div className="mini-list">
          {result.updates.slice(0, 6).map((item) => (
            <article key={`${item.packageName}-${item.newVersion ?? "new"}`} className="mini-list-item">
              <div>
                <div className="item-title">
                  {item.packageName}
                  {item.security ? (
                    <span className={`inventory-badge ${item.urgent ? "status-stopped" : "status-pending"}`}>
                      {item.urgent ? "Sécurité urgente" : "Sécurité"}
                    </span>
                  ) : null}
                  {item.rebootRequired ? (
                    <span className="inventory-badge status-template">reboot probable</span>
                  ) : null}
                </div>
                <div className="item-subtitle">
                  {[item.oldVersion ?? "?", item.newVersion ?? "?"].join(" → ")}
                  {item.origin ? ` • ${item.origin}` : ""}
                </div>
                <div className="item-subtitle">{item.explanation}</div>
                {item.title || item.changelog ? (
                  <div className="item-subtitle">{item.title ?? item.changelog}</div>
                ) : null}
              </div>
              <div className="item-metric">{item.group}</div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
