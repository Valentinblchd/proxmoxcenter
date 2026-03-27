import {
  LoadingMetricCards,
  LoadingPageHero,
  LoadingPanel,
  LoadingSummaryTiles,
  LoadingTabStrip,
  SkeletonBar,
} from "@/components/loading-shells";

export default function ObservabilityLoading() {
  return (
    <section className="content content-wide observability-page loading-shell-page">
      <LoadingPageHero eyebrow="Observabilité" pills={2} actionWidth="8rem" />
      <LoadingTabStrip count={3} />
      <LoadingSummaryTiles count={4} />

      <section className="loading-shell-grid is-aside">
        <LoadingPanel titleWidth="15rem" subtitleWidth="10rem">
          <div className="loading-shell-stack">
            <LoadingMetricCards count={4} withBars={false} />
            <div className="loading-shell-graph">
              <SkeletonBar width="100%" height={220} className="loading-shell-graph-surface" />
            </div>
          </div>
        </LoadingPanel>

        <div className="loading-shell-stack">
          <LoadingPanel titleWidth="10rem" subtitleWidth="7rem" rows={4} />
          <LoadingPanel titleWidth="11rem" subtitleWidth="8rem" rows={4} />
        </div>
      </section>

      <LoadingPanel titleWidth="12rem" subtitleWidth="9rem">
        <div className="loading-shell-list">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={`obs-archive-${index}`} className="loading-shell-list-item">
              <div className="loading-shell-stack">
                <SkeletonBar width="10rem" height={16} />
                <SkeletonBar width={index % 2 === 0 ? "16rem" : "12rem"} height={12} />
              </div>
              <div className="loading-shell-row">
                <SkeletonBar width="5rem" height={32} />
                <SkeletonBar width="5rem" height={32} />
              </div>
            </div>
          ))}
        </div>
      </LoadingPanel>
    </section>
  );
}
