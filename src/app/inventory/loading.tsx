import {
  LoadingMetricCards,
  LoadingPageHero,
  LoadingPanel,
  LoadingSummaryTiles,
  LoadingTabStrip,
  SkeletonBar,
} from "@/components/loading-shells";

export default function InventoryLoading() {
  return (
    <section className="content content-wide inventory-page loading-shell-page">
      <LoadingPageHero eyebrow="Inventaire" pills={2} actionWidth="8.5rem" />

      <section className="panel inventory-toolbar-panel loading-shell-block">
        <div className="loading-shell-toolbar">
          <SkeletonBar width="28rem" height={54} className="loading-shell-search" />
          <div className="loading-shell-row is-between">
            <div className="loading-shell-row">
              <SkeletonBar width="9rem" height={40} />
              <SkeletonBar width="6.5rem" height={40} />
            </div>
            <div className="loading-shell-row">
              <SkeletonBar width="7rem" height={40} />
              <SkeletonBar width="7.5rem" height={40} />
            </div>
          </div>
        </div>
      </section>

      <LoadingSummaryTiles count={4} />
      <LoadingTabStrip count={8} />

      <section className="content-grid">
        <LoadingPanel titleWidth="14rem" subtitleWidth="8rem">
          <div className="loading-shell-stack">
            <div className="loading-shell-list">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`inventory-summary-${index}`} className="loading-shell-list-item">
                  <div className="loading-shell-stack">
                    <SkeletonBar width={index % 2 === 0 ? "9rem" : "7rem"} height={12} />
                    <SkeletonBar width="100%" height={12} />
                  </div>
                  <SkeletonBar width="5rem" height={16} />
                </div>
              ))}
            </div>
            <LoadingMetricCards count={3} />
          </div>
        </LoadingPanel>

        <LoadingPanel titleWidth="11rem" subtitleWidth="7rem" rows={4} />
      </section>
    </section>
  );
}
