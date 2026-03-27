import { LoadingMetricCards, LoadingPageHero, LoadingPanel, SkeletonBar } from "@/components/loading-shells";

export default function ProvisionLoading() {
  return (
    <section className="content content-wide provision-page loading-shell-page">
      <LoadingPageHero eyebrow="Création" pills={2} actionWidth="9rem" />

      <section className="panel provision-stage-hero loading-shell-block">
        <div className="loading-shell-stack">
          <div className="loading-shell-stepper" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBar key={`step-${index}`} width={`${7 + index * 0.8}rem`} height={42} />
            ))}
          </div>
          <div className="loading-shell-grid is-provision">
            <LoadingPanel titleWidth="13rem" subtitleWidth="9rem">
              <div className="loading-shell-form-grid">
                <div className="loading-shell-stack">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={`field-${index}`} className="loading-shell-stack">
                      <SkeletonBar width="7rem" height={12} />
                      <SkeletonBar width="100%" height={48} />
                    </div>
                  ))}
                </div>
                <div className="loading-shell-stack">
                  <LoadingMetricCards count={3} withBars={false} />
                  <div className="hint-box loading-shell-block">
                    <div className="loading-shell-stack">
                      <SkeletonBar width="8rem" height={18} className="is-title" />
                      <SkeletonBar width="100%" height={12} />
                      <SkeletonBar width="88%" height={12} />
                    </div>
                  </div>
                </div>
              </div>
            </LoadingPanel>
          </div>
        </div>
      </section>
    </section>
  );
}
