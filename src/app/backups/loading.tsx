import { LoadingPageHero, LoadingPanel, LoadingSummaryTiles, LoadingTabStrip, SkeletonBar } from "@/components/loading-shells";

export default function BackupsLoading() {
  return (
    <section className="content content-wide backups-page loading-shell-page">
      <LoadingPageHero eyebrow="Sauvegardes" pills={2} />
      <LoadingSummaryTiles count={3} />

      <LoadingPanel titleWidth="14rem" subtitleWidth="10rem" actions={2}>
        <div className="loading-shell-stack">
          <LoadingTabStrip count={4} />
          <div className="loading-shell-grid">
            <LoadingPanel titleWidth="11rem" subtitleWidth="8rem" rows={4} />
            <LoadingPanel titleWidth="10rem" subtitleWidth="7rem" rows={4} />
          </div>
          <section className="loading-shell-card-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <article key={`backup-card-${index}`} className="hint-box loading-shell-block">
                <div className="loading-shell-stack">
                  <SkeletonBar width="8rem" height={18} className="is-title" />
                  <SkeletonBar width="100%" height={12} />
                  <SkeletonBar width="80%" height={12} />
                </div>
              </article>
            ))}
          </section>
        </div>
      </LoadingPanel>
    </section>
  );
}
