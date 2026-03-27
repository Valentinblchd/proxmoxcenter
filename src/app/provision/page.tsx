import Link from "next/link";
import ProvisioningStudio from "@/components/provisioning-studio";

export const dynamic = "force-dynamic";

type ProvisionPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function readSearchParams(
  value: ProvisionPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export default async function ProvisionPage({ searchParams }: ProvisionPageProps) {
  const params = await readSearchParams(searchParams);
  const kind = readString(params.kind);
  const preset = readString(params.preset);
  const kindLabel = kind === "qemu" ? "VM" : kind === "lxc" ? "LXC" : "Libre";

  return (
    <section className="content content-wide provision-page">
      <header className="topbar provision-page-hero provision-page-hero-compact">
        <div className="provision-page-hero-copy">
          <p className="eyebrow">Création</p>
          <h1>Créer une VM ou un LXC</h1>
          <p className="muted">
            Un wizard simple et large pour définir la machine, vérifier le résumé puis lancer la création sans quitter la page.
          </p>
          <div className="provision-page-hero-chips" aria-label="Points clés création">
            <span className="inventory-tag">5 étapes</span>
            <span className="inventory-tag">VM et LXC</span>
            <span className="inventory-tag">ISO local, URL ou template</span>
          </div>
        </div>
        <div className="topbar-meta provision-page-topbar-meta">
          <span className="pill">Départ {kindLabel}</span>
          {preset ? <span className="pill">Preset {preset}</span> : null}
          <Link href="/inventory" className="action-btn">
            Retour inventaire
          </Link>
        </div>
      </header>

      <section className="stats-grid provision-page-summary-strip">
        <article className="stat-tile">
          <div className="stat-label">Départ</div>
          <div className="stat-value">{kindLabel}</div>
          <div className="stat-subtle">Type modifiable à tout moment</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Parcours</div>
          <div className="stat-value">5 étapes</div>
          <div className="stat-subtle">Identité, capacité, système, options, résumé</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Supports</div>
          <div className="stat-value">ISO + CT</div>
          <div className="stat-subtle">ISO local, URL ISO et template LXC</div>
        </article>
      </section>

      <ProvisioningStudio initialKind={kind} initialPreset={preset} mode="wizard" />
    </section>
  );
}
