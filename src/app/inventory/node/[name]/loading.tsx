import { LoadingMetricCards, LoadingPageHero, LoadingPanel, SkeletonBar } from "@/components/loading-shells";

export default function NodeDetailLoading() {
  return (
    <section className="content content-wide workload-page loading-shell-page">
      <LoadingPageHero eyebrow="Inventaire" pills={3} actionWidth="7rem" />

      <section className="panel workload-hero loading-shell-block">
        <div className="loading-shell-grid is-detail-hero">
          <div className="loading-shell-stack">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`node-hero-row-${index}`} className="loading-shell-list-item">
                <SkeletonBar width={index % 2 === 0 ? "8rem" : "7rem"} height={12} />
                <SkeletonBar width={index % 2 === 0 ? "11rem" : "13rem"} height={16} />
              </div>
            ))}
          </div>
          <LoadingMetricCards count={4} />
        </div>
      </section>

      <section className="workload-grid">
        <LoadingPanel titleWidth="14rem" subtitleWidth="9rem" rows={5} />
        <LoadingPanel titleWidth="12rem" subtitleWidth="8rem" rows={5} />
      </section>

      <section className="workload-support-grid">
        <LoadingPanel titleWidth="10rem" subtitleWidth="7rem" rows={4} />
        <LoadingPanel titleWidth="10rem" subtitleWidth="7rem" rows={4} />
      </section>
    </section>
  );
}
