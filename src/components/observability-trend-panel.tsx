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

function buildLinePath(points: TrendPoint[], width: number, height: number) {
  if (points.length === 0) return "";
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  const effectiveMax = maxValue > 0 ? maxValue : 1;

  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - (point.value / effectiveMax) * height;
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
  const maxValue = points.reduce((max, point) => Math.max(max, point.value), 0);
  const average = points.length > 0 ? points.reduce((sum, point) => sum + point.value, 0) / points.length : 0;
  const latest = points.at(-1)?.value ?? 0;
  const linePath = buildLinePath(points, 240, 74);
  const scaleValues = buildScaleValues(mode, maxValue);

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
              <svg viewBox="0 0 240 74" role="img" aria-label={title}>
                <path className="observability-trend-gridline" d="M 0 18 H 240" />
                <path className="observability-trend-gridline" d="M 0 37 H 240" />
                <path className="observability-trend-gridline" d="M 0 56 H 240" />
                <path className={`observability-trend-line ${toneClass}`} d={linePath} />
              </svg>
            </div>
          </div>

          <div className="observability-trend-foot">
            <span>{formatTrendLabel(points[0].timestamp, points.length)}</span>
            <span>
              {mode === "percent" ? "Unite: %" : "Unite: octets/s"} •{" "}
              {formatTrendLabel(points.at(-1)?.timestamp ?? points[0].timestamp, points.length)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
