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

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Création</p>
          <h1>Provisioning VM / LXC</h1>
        </div>
        <div className="topbar-meta">
          <Link href="/inventory" className="action-btn primary">
            Retour inventaire
          </Link>
        </div>
      </header>

      <ProvisioningStudio initialKind={kind} initialPreset={preset} mode="wizard" />
    </section>
  );
}
