import { LoadingPageHero, LoadingPanel, LoadingSummaryTiles, LoadingTabStrip } from "@/components/loading-shells";

export default function SettingsLoading() {
  return (
    <section className="content settings-page loading-shell-page">
      <LoadingPageHero eyebrow="Paramètres" pills={2} />
      <LoadingTabStrip count={4} />
      <LoadingSummaryTiles count={5} />

      <section className="loading-shell-stack">
        <LoadingPanel titleWidth="10rem" subtitleWidth="8rem" rows={4} />
        <LoadingPanel titleWidth="12rem" subtitleWidth="8rem" rows={5} />
        <LoadingPanel titleWidth="9rem" subtitleWidth="7rem" rows={4} />
      </section>
    </section>
  );
}
