"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatPercent } from "@/lib/ui/format";

type TrendPoint = {
  timestamp: string;
  value: number;
};

type TrendMode = "percent" | "network";

function formatTrendValue(mode: TrendMode, value: number) {
  if (mode === "percent") {
    return formatPercent(value);
  }
  return `${formatBytes(value)}/s`;
}

function buildScaleValues(mode: TrendMode, maxValue: number) {
  if (mode === "percent") {
    return [1, 0.5, 0];
  }
  const safeMax = maxValue > 0 ? maxValue : 1;
  return [safeMax, safeMax / 2, 0];
}

function formatTrendLabel(timestamp: string, totalPoints: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString("fr-FR", {
    day: totalPoints > 40 ? "2-digit" : undefined,
    month: totalPoints > 40 ? "2-digit" : undefined,
    hour: "2-digit",
    minute: totalPoints > 80 ? undefined : "2-digit",
  });
}

function buildPointPosition(index: number, total: number, width: number) {
  if (total <= 1) return width / 2;
  return (index / (total - 1)) * width;
}

function buildPointY(value: number, maxValue: number, height: number) {
  const effectiveMax = maxValue > 0 ? maxValue : 1;
  return height - (value / effectiveMax) * height;
}

function buildLinePath(points: TrendPoint[], width: number, height: number) {
  if (points.length === 0) return "";
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  return points
    .map((point, index) => {
      const x = buildPointPosition(index, points.length, width);
      const y = buildPointY(point.value, maxValue, height);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function ObservabilityTrendPanel({
  title,
  subtitle,
  points,
  mode,
  toneClass,
}: {
  title: string;
  subtitle: string;
  points: TrendPoint[];
  mode: TrendMode;
  toneClass: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  const average = points.length > 0 ? points.reduce((sum, point) => sum + point.value, 0) / points.length : 0;
  const latest = points.at(-1)?.value ?? 0;
  const linePath = buildLinePath(points, 240, 74);
  const scaleValues = buildScaleValues(mode, maxValue);
  const activeIndex = hoveredIndex !== null ? hoveredIndex : points.length - 1;
  const activePoint = activeIndex >= 0 ? points[activeIndex] ?? null : null;
  const activeX = activePoint ? buildPointPosition(activeIndex, points.length, 240) : 0;
  const activeY = activePoint ? buildPointY(activePoint.value, maxValue, 74) : 0;
  const activeXPercent =
    activePoint && points.length > 1 ? (activeIndex / (points.length - 1)) * 100 : 50;

  const pointMarkers = useMemo(
    () =>
      points.map((point, index) => ({
        key: `${point.timestamp}-${index}`,
        x: buildPointPosition(index, points.length, 240),
        y: buildPointY(point.value, maxValue, 74),
      })),
    [maxValue, points],
  );

  return (
    <section className="panel observability-trend-card">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="muted">{subtitle}</span>
      </div>

      {points.length === 0 ? (
        <p className="muted">Pas assez d’historique sur cette fenêtre.</p>
      ) : (
        <>
          <div className="observability-trend-meta">
            <article className="observability-trend-stat">
              <span>Actuel</span>
              <strong>{formatTrendValue(mode, latest)}</strong>
            </article>
            <article className="observability-trend-stat">
              <span>Moyenne</span>
              <strong>{formatTrendValue(mode, average)}</strong>
            </article>
            <article className="observability-trend-stat">
              <span>Pic</span>
              <strong>{formatTrendValue(mode, maxValue)}</strong>
            </article>
          </div>

          <div className="observability-trend-chart-shell">
            <div className="observability-trend-scale" aria-hidden="true">
              {scaleValues.map((value, index) => (
                <span key={`${title}-scale-${index}`}>{formatTrendValue(mode, value)}</span>
              ))}
            </div>
            <div className="observability-trend-graph">
              <div className="observability-trend-graph-inner">
                {activePoint ? (
                  <div
                    className="observability-trend-tooltip"
                    style={{ left: `${activeXPercent}%` }}
                  >
                    <strong>{formatTrendValue(mode, activePoint.value)}</strong>
                    <span>{formatTrendLabel(activePoint.timestamp, points.length)}</span>
                  </div>
                ) : null}
                <svg
                  viewBox="0 0 240 74"
                  role="img"
                  aria-label={title}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onMouseMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (!bounds.width || points.length === 0) return;
                    const relativeX = Math.min(
                      Math.max(event.clientX - bounds.left, 0),
                      bounds.width,
                    );
                    const ratio = bounds.width > 0 ? relativeX / bounds.width : 0;
                    const nextIndex =
                      points.length <= 1 ? 0 : Math.round(ratio * (points.length - 1));
                    setHoveredIndex(Math.max(0, Math.min(nextIndex, points.length - 1)));
                  }}
                >
                  <path className="observability-trend-gridline" d="M 0 18 H 240" />
                  <path className="observability-trend-gridline" d="M 0 37 H 240" />
                  <path className="observability-trend-gridline" d="M 0 56 H 240" />
                  <path
                    className="observability-trend-gridline observability-trend-cursor"
                    d={`M ${activeX.toFixed(2)} 0 V 74`}
                  />
                  <path className={`observability-trend-line ${toneClass}`} d={linePath} />
                  {pointMarkers.map((point, index) => (
                    <circle
                      key={point.key}
                      cx={point.x}
                      cy={point.y}
                      r={index === activeIndex ? 4.5 : 2.6}
                      className={`observability-trend-dot ${index === activeIndex ? "is-active" : ""} ${toneClass}`}
                    />
                  ))}
                  {activePoint ? (
                    <circle
                      cx={activeX}
                      cy={activeY}
                      r={5}
                      className={`observability-trend-dot is-focus ${toneClass}`}
                    />
                  ) : null}
                </svg>
              </div>
            </div>
          </div>

          <div className="observability-trend-foot">
            <span>{formatTrendLabel(points[0].timestamp, points.length)}</span>
            <span>
              {mode === "percent" ? "Unité: %" : "Unité: octets/s"} •{" "}
              {formatTrendLabel(points.at(-1)?.timestamp ?? points[0].timestamp, points.length)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
