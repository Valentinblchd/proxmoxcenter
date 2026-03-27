import type { CSSProperties, ReactNode } from "react";

type SkeletonBarProps = {
  width?: string;
  height?: number;
  className?: string;
};

type LoadingPageHeroProps = {
  eyebrow: string;
  titleWidth?: string;
  descriptionWidths?: string[];
  pills?: number;
  actionWidth?: string | null;
  className?: string;
};

type LoadingSummaryTilesProps = {
  count?: number;
};

type LoadingTabStripProps = {
  count?: number;
};

type LoadingPanelProps = {
  titleWidth?: string;
  subtitleWidth?: string;
  rows?: number;
  actions?: number;
  className?: string;
  children?: ReactNode;
};

type LoadingMetricCardsProps = {
  count?: number;
  withBars?: boolean;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SkeletonBar({ width = "100%", height = 14, className }: SkeletonBarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx("skeleton-bar", className)}
      style={{ width, height } as CSSProperties}
    />
  );
}

export function LoadingPageHero({
  eyebrow,
  titleWidth = "16rem",
  descriptionWidths = ["34rem", "26rem"],
  pills = 2,
  actionWidth = null,
  className,
}: LoadingPageHeroProps) {
  return (
    <header className={cx("topbar loading-shell-block", className)}>
      <div className="loading-shell-stack">
        <p className="eyebrow">{eyebrow}</p>
        <SkeletonBar width={titleWidth} height={26} className="is-title" />
        <div className="loading-shell-stack">
          {descriptionWidths.map((width, index) => (
            <SkeletonBar key={`${width}-${index}`} width={width} height={14} />
          ))}
        </div>
      </div>
      <div className="topbar-meta loading-shell-pills">
        {Array.from({ length: pills }).map((_, index) => (
          <SkeletonBar key={`pill-${index}`} width={index === pills - 1 && actionWidth ? actionWidth : "7.5rem"} height={36} />
        ))}
        {actionWidth ? <SkeletonBar width={actionWidth} height={40} /> : null}
      </div>
    </header>
  );
}

export function LoadingSummaryTiles({ count = 4 }: LoadingSummaryTilesProps) {
  return (
    <section className="stats-grid loading-shell-summary">
      {Array.from({ length: count }).map((_, index) => (
        <article key={`tile-${index}`} className="stat-tile loading-shell-block loading-shell-stat">
          <div className="loading-shell-stack">
            <SkeletonBar width="6.25rem" height={12} />
            <SkeletonBar width={index % 2 === 0 ? "4.5rem" : "6rem"} height={28} className="is-title" />
            <SkeletonBar width={index % 3 === 0 ? "10rem" : "12rem"} height={12} />
          </div>
        </article>
      ))}
    </section>
  );
}

export function LoadingTabStrip({ count = 5 }: LoadingTabStripProps) {
  return (
    <section className="panel loading-shell-block">
      <div className="hub-tabs loading-shell-tabs" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <SkeletonBar key={`tab-${index}`} width={`${5.5 + index * 0.55}rem`} height={42} />
        ))}
      </div>
    </section>
  );
}

export function LoadingPanel({
  titleWidth = "12rem",
  subtitleWidth = "8rem",
  rows = 4,
  actions = 0,
  className,
  children,
}: LoadingPanelProps) {
  return (
    <section className={cx("panel loading-shell-block", className)}>
      <div className="panel-head">
        <div className="loading-shell-stack">
          <SkeletonBar width={titleWidth} height={22} className="is-title" />
          <SkeletonBar width={subtitleWidth} height={12} />
        </div>
        {actions > 0 ? (
          <div className="loading-shell-row">
            {Array.from({ length: actions }).map((_, index) => (
              <SkeletonBar key={`action-${index}`} width="6.5rem" height={36} />
            ))}
          </div>
        ) : null}
      </div>

      {children ?? (
        <div className="loading-shell-list" aria-hidden="true">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={`row-${index}`} className="loading-shell-list-item">
              <div className="loading-shell-stack">
                <SkeletonBar width={index % 2 === 0 ? "7rem" : "9rem"} height={12} />
                <SkeletonBar width={index % 3 === 0 ? "13rem" : "11rem"} height={18} />
              </div>
              <SkeletonBar width={index % 2 === 0 ? "5rem" : "6rem"} height={16} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function LoadingMetricCards({ count = 4, withBars = true }: LoadingMetricCardsProps) {
  return (
    <div className="loading-shell-metrics">
      {Array.from({ length: count }).map((_, index) => (
        <article key={`metric-${index}`} className="loading-shell-metric">
          <div className="loading-shell-stack">
            <SkeletonBar width="5rem" height={12} />
            <SkeletonBar width={index % 2 === 0 ? "7rem" : "9rem"} height={22} className="is-title" />
            {withBars ? <SkeletonBar width="100%" height={12} /> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
