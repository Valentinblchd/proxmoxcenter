"use client";

import { useMemo, useState } from "react";

type GreenItHistoryExplorerDay = {
  date: string;
  trackedHours: number;
  kwh: number;
  costEur: number;
  co2Kg: number;
  averageEffectivePowerWatts: number;
  maxEffectivePowerWatts: number;
  lastPowerSource: string;
};

type GreenItHistoryExplorerProps = {
  days: GreenItHistoryExplorerDay[];
  updatedAt: string;
};

function defaultFromDate(days: GreenItHistoryExplorerDay[]) {
  if (days.length === 0) return "";
  return days[Math.max(0, days.length - 30)]?.date ?? days[0]?.date ?? "";
}

function toCsvValue(value: string | number) {
  const text = typeof value === "number" ? String(value) : value;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR");
}

export default function GreenItHistoryExplorer({
  days,
  updatedAt,
}: GreenItHistoryExplorerProps) {
  const [from, setFrom] = useState(() => defaultFromDate(days));
  const [to, setTo] = useState(() => days.at(-1)?.date ?? "");

  const filteredDays = useMemo(() => {
    return days.filter((day) => {
      if (from && day.date < from) return false;
      if (to && day.date > to) return false;
      return true;
    });
  }, [days, from, to]);

  const totals = useMemo(() => {
    return filteredDays.reduce(
      (acc, day) => {
        acc.kwh += day.kwh;
        acc.costEur += day.costEur;
        acc.co2Kg += day.co2Kg;
        acc.trackedHours += day.trackedHours;
        acc.maxEffectivePowerWatts = Math.max(acc.maxEffectivePowerWatts, day.maxEffectivePowerWatts);
        return acc;
      },
      {
        kwh: 0,
        costEur: 0,
        co2Kg: 0,
        trackedHours: 0,
        maxEffectivePowerWatts: 0,
      },
    );
  }, [filteredDays]);

  function exportCsv() {
    const header = [
      "date",
      "tracked_hours",
      "kwh",
      "cost_eur",
      "co2_kg",
      "avg_effective_power_w",
      "max_effective_power_w",
      "power_source",
    ];
    const rows = filteredDays.map((day) => [
      day.date,
      day.trackedHours.toFixed(2),
      day.kwh.toFixed(3),
      day.costEur.toFixed(2),
      day.co2Kg.toFixed(3),
      day.averageEffectivePowerWatts.toFixed(1),
      day.maxEffectivePowerWatts.toFixed(1),
      day.lastPowerSource,
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `greenit-history-${from || "debut"}-${to || "fin"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdfView() {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1080,height=760");
    if (!popup) return;
    const rows = filteredDays
      .map(
        (day) => `
          <tr>
            <td>${day.date}</td>
            <td>${day.kwh.toFixed(2)} kWh</td>
            <td>${day.costEur.toFixed(2)} EUR</td>
            <td>${Math.round(day.averageEffectivePowerWatts)} W</td>
            <td>${Math.round(day.maxEffectivePowerWatts)} W</td>
            <td>${day.trackedHours.toFixed(1)} h</td>
            <td>${day.lastPowerSource}</td>
          </tr>`,
      )
      .join("");
    popup.document.write(`<!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Historique energie ProxCenter</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { margin: 0 0 8px; }
            p { margin: 0 0 16px; color: #4b5563; }
            .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 20px; }
            .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; }
            .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
            .value { font-size: 22px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 8px; text-align: left; font-size: 13px; }
            th { color: #6b7280; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>Historique energie</h1>
          <p>Periode ${from || "debut"} au ${to || "fin"} • maj ${formatUpdatedAt(updatedAt)}</p>
          <section class="summary">
            <div class="card"><div class="label">Conso</div><div class="value">${totals.kwh.toFixed(1)} kWh</div></div>
            <div class="card"><div class="label">Cout</div><div class="value">${totals.costEur.toFixed(2)} EUR</div></div>
            <div class="card"><div class="label">CO2</div><div class="value">${totals.co2Kg.toFixed(2)} kg</div></div>
            <div class="card"><div class="label">Pic</div><div class="value">${Math.round(totals.maxEffectivePowerWatts)} W</div></div>
          </section>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Conso</th>
                <th>Cout</th>
                <th>Moyenne</th>
                <th>Pic</th>
                <th>Suivi</th>
                <th>Source</th>
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
    <section className="panel greenit-history-explorer">
      <div className="panel-head">
        <h2>Archives energie</h2>
        <span className="muted">
          {filteredDays.length} jour(s) • maj {formatUpdatedAt(updatedAt)}
        </span>
      </div>

      <div className="greenit-history-toolbar">
        <label className="provision-field">
          <span className="provision-field-label">Du</span>
          <input className="provision-input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Au</span>
          <input className="provision-input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div className="greenit-history-preset-row">
          <button type="button" className="inventory-ghost-btn" onClick={() => {
            setFrom(days[Math.max(0, days.length - 7)]?.date ?? "");
            setTo(days.at(-1)?.date ?? "");
          }}>
            7 jours
          </button>
          <button type="button" className="inventory-ghost-btn" onClick={() => {
            setFrom(days[Math.max(0, days.length - 30)]?.date ?? "");
            setTo(days.at(-1)?.date ?? "");
          }}>
            30 jours
          </button>
          <button type="button" className="inventory-ghost-btn" onClick={() => {
            setFrom(days[Math.max(0, days.length - 90)]?.date ?? "");
            setTo(days.at(-1)?.date ?? "");
          }}>
            90 jours
          </button>
          <button type="button" className="inventory-ghost-btn" onClick={() => {
            setFrom(days[0]?.date ?? "");
            setTo(days.at(-1)?.date ?? "");
          }}>
            Tout
          </button>
        </div>
        <div className="greenit-history-actions">
          <button type="button" className="action-btn" onClick={exportCsv} disabled={filteredDays.length === 0}>
            Export CSV
          </button>
          <button type="button" className="action-btn" onClick={exportPdfView} disabled={filteredDays.length === 0}>
            Export PDF
          </button>
        </div>
      </div>

      <section className="stats-grid greenit-history-kpis">
        <article className="stat-tile">
          <div className="stat-label">Conso filtre</div>
          <div className="stat-value">{totals.kwh.toFixed(1)} kWh</div>
          <div className="stat-subtle">{totals.trackedHours.toFixed(1)} h suivies</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Cout filtre</div>
          <div className="stat-value">{totals.costEur.toFixed(2)} €</div>
          <div className="stat-subtle">{totals.co2Kg.toFixed(2)} kg CO2</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Jour moyen</div>
          <div className="stat-value">
            {filteredDays.length > 0 ? (totals.kwh / filteredDays.length).toFixed(2) : "0.00"} kWh
          </div>
          <div className="stat-subtle">
            {filteredDays.length > 0 ? (totals.costEur / filteredDays.length).toFixed(2) : "0.00"} €/j
          </div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Pic periode</div>
          <div className="stat-value">{Math.round(totals.maxEffectivePowerWatts)} W</div>
          <div className="stat-subtle">Puissance effective max</div>
        </article>
      </section>

      {filteredDays.length === 0 ? (
        <p className="muted">Aucune archive sur cette plage de dates.</p>
      ) : (
        <div className="mini-list greenit-history-list">
          {[...filteredDays].reverse().map((day) => (
            <article key={day.date} className="mini-list-item">
              <div>
                <div className="item-title">{day.date}</div>
                <div className="item-subtitle">
                  {day.kwh.toFixed(2)} kWh • {day.costEur.toFixed(2)} € • suivi {day.trackedHours.toFixed(1)} h
                </div>
              </div>
              <div className="item-metric">
                <div>{Math.round(day.averageEffectivePowerWatts)} W moy</div>
                <div className="item-subtitle">
                  pic {Math.round(day.maxEffectivePowerWatts)} W • {day.lastPowerSource}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
