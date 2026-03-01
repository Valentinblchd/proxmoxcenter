import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import {
  getSectionPage,
  getSectionSlugs,
} from "@/lib/navigation/menu";
import { formatRelativeTime } from "@/lib/ui/format";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

async function readParams(params: SectionPageProps["params"]): Promise<{ section: string }> {
  return await params;
}

export async function generateStaticParams() {
  return getSectionSlugs().map((section) => ({ section }));
}

export async function generateMetadata({
  params,
}: SectionPageProps): Promise<Metadata> {
  const { section } = await readParams(params);
  const config = getSectionPage(section);

  if (!config) {
    return {
      title: "Page introuvable | ProxCenter",
    };
  }

  return {
    title: `${config.label} | ProxCenter`,
    description: config.description,
  };
}

export const dynamic = "force-dynamic";

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await readParams(params);
  const config = getSectionPage(section);

  if (!config) {
    notFound();
  }

  const snapshot = await getDashboardSnapshot();

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h1>{config.title}</h1>
        </div>
        <div className="topbar-meta">
          {snapshot.mode === "live" ? (
            <span className="pill live">Proxmox connecté</span>
          ) : (
            <span className="pill">Hors ligne</span>
          )}
          <span className="muted">
            Mis à jour {formatRelativeTime(snapshot.lastUpdatedAt)}
          </span>
        </div>
      </header>

      <section className="panel welcome-panel">
        <div>
          <h2>Page active: {config.label}</h2>
        </div>
        <div className="quick-actions">
          <Link href="/" className="action-btn">
            Retour accueil
          </Link>
          <Link href="/inventory" className="action-btn primary">
            Ouvrir inventaire
          </Link>
        </div>
      </section>

      <section className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Résumé cluster</h2>
            <span className="muted">{snapshot.mode === "live" ? "Données live" : "Aucune donnée live"}</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Nœuds</span>
              <strong>{snapshot.summary.nodes}</strong>
            </div>
            <div className="row-line">
              <span>VM</span>
              <strong>{snapshot.summary.vms}</strong>
            </div>
            <div className="row-line">
              <span>CT</span>
              <strong>{snapshot.summary.cts}</strong>
            </div>
            <div className="row-line">
              <span>Workloads actifs</span>
              <strong className={snapshot.summary.running > 0 ? "status-good" : undefined}>
                {snapshot.summary.running}
              </strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Axes de la vue</h2>
            <span className="muted">{config.label}</span>
          </div>
          <div className="mini-list">
            {config.focus.map((item) => (
              <article key={item} className="mini-list-item">
                <div>
                  <div className="item-title">{item}</div>
                </div>
                <div className="item-metric">•</div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>État des données</h2>
          <span className="muted">Connexion API</span>
        </div>
        <div className="row-line">
          <span>Statut</span>
          <strong className={snapshot.mode === "live" ? "status-good" : undefined}>
            {snapshot.mode === "live" ? "Active" : "Indisponible"}
          </strong>
        </div>
      </section>
    </section>
  );
}
