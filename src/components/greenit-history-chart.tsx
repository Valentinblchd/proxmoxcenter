type GreenItHistoryChartDay = {
  date: string;
  kwh: number;
  costEur: number;
  averageEffectivePowerWatts: number;
};

export default function GreenItHistoryChart({
  title,
  subtitle,
  days,
  metric,
  suffix,
  colorClass,
}: {
  title: string;
  subtitle: string;
  days: GreenItHistoryChartDay[];
  metric: (day: GreenItHistoryChartDay) => number;
  suffix: string;
  colorClass: string;
}) {
  const maxValue = days.reduce((max, day) => Math.max(max, metric(day)), 0);

  return (
    <section className="panel greenit-chart-panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className="muted">{subtitle}</span>
      </div>
      {days.length === 0 ? (
        <p className="muted">Pas encore assez d’historique pour afficher ce graphe.</p>
      ) : (
        <div className="greenit-chart">
          {days.map((day) => {
            const value = metric(day);
            const ratio = maxValue > 0 ? Math.max(8, Math.round((value / maxValue) * 100)) : 8;
            return (
              <article key={`${title}-${day.date}`} className="greenit-chart-bar">
                <div className="greenit-chart-value">
                  {value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} {suffix}
                </div>
                <div className="greenit-chart-rail">
                  <span className={colorClass} style={{ height: `${ratio}%` }} />
                </div>
                <div className="greenit-chart-label">{day.date.slice(5)}</div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
