import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Roadmap | ProxmoxCenter",
  description: "Backlog produit structuré de 500 idées pour ProxmoxCenter.",
};

type RoadmapItem = {
  id: number;
  text: string;
};

type RoadmapSection = {
  title: string;
  range: string | null;
  items: RoadmapItem[];
};

async function readRoadmapSections() {
  const backlogPath = path.join(process.cwd(), "docs", "product-backlog-500-ideas.md");
  const source = await readFile(backlogPath, "utf8");
  const lines = source.split(/\r?\n/);
  const sections: RoadmapSection[] = [];
  let current: RoadmapSection | null = null;

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)(?:\s+\(([^)]+)\))?$/.exec(line.trim());
    if (headingMatch) {
      current = {
        title: headingMatch[1] ?? "Section",
        range: headingMatch[2] ?? null,
        items: [],
      };
      sections.push(current);
      continue;
    }

    const itemMatch = /^(\d+)\.\s+(.+)$/.exec(line.trim());
    if (itemMatch && current) {
      current.items.push({
        id: Number.parseInt(itemMatch[1] ?? "0", 10),
        text: itemMatch[2] ?? "",
      });
    }
  }

  return sections;
}

export default async function RoadmapPage() {
  const snapshot = await getDashboardSnapshot();
  const sections = await readRoadmapSections();
  const totalIdeas = sections.reduce((sum, section) => sum + section.items.length, 0);
  const biggestSection = sections.reduce<RoadmapSection | null>(
    (best, section) => (best && best.items.length >= section.items.length ? best : section),
    null,
  );

  return (
    <section className="content content-wide roadmap-page">
      <header className="topbar roadmap-hero">
        <div className="roadmap-hero-copy">
          <p className="eyebrow">Roadmap</p>
          <h1>500 idées produit déjà intégrées au backlog</h1>
          <p className="muted">
            Le backlog complet est maintenant visible dans l’app, classé par thème pour pouvoir prioriser les prochains lots sans repartir de zéro.
          </p>
        </div>
        <div className="topbar-meta roadmap-hero-meta">
          {snapshot.mode === "live" ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="pill">{sections.length} thèmes</span>
          <span className="pill">{totalIdeas} idées</span>
          <Link href="https://github.com/Valentinblchd/proxmoxcenter/blob/main/docs/product-backlog-500-ideas.md" className="action-btn">
            Voir sur GitHub
          </Link>
        </div>
      </header>

      <section className="stats-grid roadmap-summary-strip">
        <article className="stat-tile">
          <div className="stat-label">Idées</div>
          <div className="stat-value">{totalIdeas}</div>
          <div className="stat-subtle">Backlog complet actuellement listé</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Sections</div>
          <div className="stat-value">{sections.length}</div>
          <div className="stat-subtle">Périmètres produit regroupés par thème</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Plus gros bloc</div>
          <div className="stat-value">{biggestSection?.items.length ?? 0}</div>
          <div className="stat-subtle">{biggestSection?.title ?? "—"}</div>
        </article>
      </section>

      <section className="content-grid roadmap-overview-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Navigation rapide</h2>
            <span className="muted">Toutes les sections backlog</span>
          </div>
          <div className="roadmap-chip-grid">
            {sections.map((section) => (
              <a key={section.title} href={`#roadmap-${section.items[0]?.id ?? section.title}`} className="hub-tab roadmap-chip">
                <span>{section.title}</span>
                <span className="inventory-badge">{section.items.length}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Usage recommandé</h2>
            <span className="muted">Comment s’en servir</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>1</span>
              <strong>Choisir un thème prioritaire puis isoler un lot de 5 à 15 idées.</strong>
            </div>
            <div className="row-line">
              <span>2</span>
              <strong>Valider l’impact, l’effort et le risque avant exécution.</strong>
            </div>
            <div className="row-line">
              <span>3</span>
              <strong>Transformer ensuite le lot retenu en roadmap trimestrielle.</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="roadmap-sections">
        {sections.map((section) => (
          <details
            key={section.title}
            className="panel roadmap-section"
            id={`roadmap-${section.items[0]?.id ?? section.title}`}
            open={section.items[0]?.id === 1}
          >
            <summary className="roadmap-section-summary">
              <div>
                <h2>{section.title}</h2>
                <p className="muted">
                  {section.range ? `Idées ${section.range}` : `${section.items.length} idées`} • {section.items.length} éléments
                </p>
              </div>
              <span className="inventory-badge">{section.items.length}</span>
            </summary>

            <div className="mini-list roadmap-idea-list">
              {section.items.map((item) => (
                <article key={item.id} className="mini-list-item">
                  <div className="roadmap-idea-copy">
                    <div className="item-title">
                      <span className="roadmap-idea-id">#{item.id}</span> {item.text}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </details>
        ))}
      </section>
    </section>
  );
}
