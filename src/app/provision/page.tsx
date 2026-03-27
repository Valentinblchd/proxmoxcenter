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
        </div>
        <div className="topbar-meta provision-page-topbar-meta">
          <span className="pill">Départ {kindLabel}</span>
          {preset ? <span className="pill">Preset {preset}</span> : null}
          <Link href="/inventory" className="action-btn">
            Retour inventaire
          </Link>
        </div>
      </header>

      <ProvisioningStudio initialKind={kind} initialPreset={preset} mode="wizard" />
    </section>
  );
}
