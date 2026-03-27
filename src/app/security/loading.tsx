import { LoadingPageHero, LoadingPanel, LoadingSummaryTiles, LoadingTabStrip } from "@/components/loading-shells";

export default function SecurityLoading() {
  return (
    <section className="content security-page loading-shell-page">
      <LoadingPageHero eyebrow="Sécurité" pills={1} />
      <LoadingTabStrip count={4} />
      <LoadingSummaryTiles count={4} />

      <section className="content-grid security-overview-grid">
        <LoadingPanel titleWidth="12rem" subtitleWidth="8rem" rows={5} />
        <LoadingPanel titleWidth="11rem" subtitleWidth="7rem" rows={5} />
      </section>
    </section>
  );
}
