"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatPercent } from "@/lib/ui/format";

type ObservabilityPoint = {
  timestamp: string;
  cpuRatio: number;
  memoryRatio: number;
  networkBytesPerSecond: number;
  diskRatio: number;
  ioWaitRatio: number;
};

type MetricId = "cpuRatio" | "memoryRatio" | "networkBytesPerSecond" | "diskRatio" | "ioWaitRatio";

const METRICS: Array<{ id: MetricId; label: string }> = [
  { id: "cpuRatio", label: "CPU" },
  { id: "memoryRatio", label: "RAM" },
  { id: "networkBytesPerSecond", label: "Réseau" },
  { id: "diskRatio", label: "Disque" },
  { id: "ioWaitRatio", label: "IO wait" },
];

function formatMetricValue(metric: MetricId, value: number) {
  if (metric === "networkBytesPerSecond") {
    return `${formatBytes(value)}/s`;
  }
  return formatPercent(value);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR");
}

function toCsvValue(value: string | number) {
  const text = typeof value === "number" ? String(value) : value;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

export default function ObservabilityHistoryExplorer({
  points,
  rangeLabel,
}: {
  points: ObservabilityPoint[];
  rangeLabel: string;
}) {
  const [metric, setMetric] = useState<MetricId>("cpuRatio");

  const summary = useMemo(() => {
    const values = points.map((point) => point[metric]).filter((value) => Number.isFinite(value));
    const latest = values.at(-1) ?? 0;
    const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const peak = values.reduce((max, value) => Math.max(max, value), 0);
    return { latest, average, peak };
  }, [metric, points]);

  function exportCsv() {
    const header = ["timestamp", "cpu_ratio", "memory_ratio", "network_bytes_per_second", "disk_ratio", "iowait_ratio"];
    const rows = points.map((point) => [
      point.timestamp,
      point.cpuRatio.toFixed(6),
      point.memoryRatio.toFixed(6),
      point.networkBytesPerSecond.toFixed(2),
      point.diskRatio.toFixed(6),
      point.ioWaitRatio.toFixed(6),
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `observability-${rangeLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdfView() {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1100,height=760");
    if (!popup) return;
    const rows = points
      .map(
        (point) => `
          <tr>
            <td>${formatTimestamp(point.timestamp)}</td>
            <td>${formatPercent(point.cpuRatio)}</td>
            <td>${formatPercent(point.memoryRatio)}</td>
            <td>${formatBytes(point.networkBytesPerSecond)}/s</td>
            <td>${formatPercent(point.diskRatio)}</td>
            <td>${formatPercent(point.ioWaitRatio)}</td>
          </tr>`,
      )
      .join("");
    popup.document.write(`<!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Archives supervision ProxCenter</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 16px; color: #4b5563; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0 0 20px; }
            .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; }
            .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
            .value { font-size: 22px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 8px; text-align: left; font-size: 13px; }
            th { color: #6b7280; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>Archives supervision</h1>
          <p>Fenetre ${rangeLabel} • metrique active ${METRICS.find((entry) => entry.id === metric)?.label ?? metric}</p>
          <section class="summary">
            <div class="card"><div class="label">Actuel</div><div class="value">${formatMetricValue(metric, summary.latest)}</div></div>
            <div class="card"><div class="label">Moyenne</div><div class="value">${formatMetricValue(metric, summary.average)}</div></div>
            <div class="card"><div class="label">Pic</div><div class="value">${formatMetricValue(metric, summary.peak)}</div></div>
          </section>
          <table>
            <thead>
              <tr>
                <th>Horodatage</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>Réseau</th>
                <th>Disque</th>
                <th>IO wait</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.print();</script>
        </body>
      </html>`);
    popup.document.close();
  }

  return (
    <section className="panel observability-history-explorer">
      <div className="panel-head">
        <h2>Archives supervision</h2>
        <span className="muted">{rangeLabel} • {points.length} point(s)</span>
      </div>

      <div className="observability-history-toolbar">
        <div className="provision-segment" role="group" aria-label="Métrique supervision">
          {METRICS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`provision-seg-btn${metric === entry.id ? " is-active" : ""}`}
              onClick={() => setMetric(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="observability-history-actions">
          <button type="button" className="action-btn" onClick={exportCsv} disabled={points.length === 0}>
            Export CSV
          </button>
          <button type="button" className="action-btn" onClick={exportPdfView} disabled={points.length === 0}>
            Export PDF
          </button>
        </div>
      </div>

      <section className="stats-grid observability-history-kpis">
        <article className="stat-tile">
          <div className="stat-label">Actuel</div>
          <div className="stat-value">{formatMetricValue(metric, summary.latest)}</div>
          <div className="stat-subtle">Dernier point</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Moyenne</div>
          <div className="stat-value">{formatMetricValue(metric, summary.average)}</div>
          <div className="stat-subtle">Fenêtre {rangeLabel}</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Pic</div>
          <div className="stat-value">{formatMetricValue(metric, summary.peak)}</div>
          <div className="stat-subtle">Valeur max</div>
        </article>
      </section>

      {points.length === 0 ? (
        <p className="muted">Aucune archive disponible sur cette fenêtre.</p>
      ) : (
        <div className="mini-list observability-history-list">
          {[...points].reverse().slice(0, 80).map((point) => (
            <article key={`${metric}-${point.timestamp}`} className="mini-list-item">
              <div>
                <div className="item-title">{formatTimestamp(point.timestamp)}</div>
                <div className="item-subtitle">
                  {METRICS.find((entry) => entry.id === metric)?.label}: {formatMetricValue(metric, point[metric])}
                </div>
              </div>
              <div className="item-metric">
                <div>CPU {formatPercent(point.cpuRatio)}</div>
                <div className="item-subtitle">
                  RAM {formatPercent(point.memoryRatio)} • Réseau {formatBytes(point.networkBytesPerSecond)}/s
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
