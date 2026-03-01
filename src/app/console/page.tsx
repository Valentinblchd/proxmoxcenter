import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { buildProxmoxNodeShellUrl } from "@/lib/proxmox/console-url";

export const dynamic = "force-dynamic";

type ConsolePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "overview", label: "Vue globale" },
  { id: "nodes", label: "Shell nœuds" },
] as const;

async function readSearchParams(
  value: ConsolePageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ConsolePage({ searchParams }: ConsolePageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const runningWorkloads = snapshot.workloads.filter((item) => item.status === "running").slice(0, 30);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Console</p>
          <h1>Shell nœuds</h1>
        </div>
        <div className="topbar-meta">
          <Link href="/inventory" className="action-btn primary">
            Consoles VM/CT (inventaire)
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/console?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
        <section className="content-grid hub-layout">
          <section className="panel">
            <div className="panel-head">
              <h2>État console</h2>
              <span className="muted">Connexion</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Connexion Proxmox</span>
                <strong className={hasLiveData ? "status-good" : undefined}>
                  {hasLiveData ? "Active" : "Indisponible"}
                </strong>
              </div>
              <div className="row-line">
                <span>Nœuds disponibles</span>
                <strong>{snapshot.summary.nodes}</strong>
              </div>
              <div className="row-line">
                <span>Workloads en marche</span>
                <strong>{runningWorkloads.length}</strong>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Accès workload</h2>
              <span className="muted">Depuis l’inventaire</span>
            </div>
            <div className="quick-actions">
              <Link href="/inventory" className="action-btn primary">
                Ouvrir l’inventaire
              </Link>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "nodes" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Shell nœuds</h2>
            <span className="muted">{snapshot.summary.nodes} nœud(x)</span>
          </div>
          {snapshot.nodes.length === 0 ? (
            <p className="muted">Aucun nœud disponible.</p>
          ) : (
            <div className="mini-list">
              {snapshot.nodes.map((node) => (
                <article key={node.name} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      <Link href={`/inventory/node/${encodeURIComponent(node.name)}`} className="mini-list-link">
                        {node.name}
                      </Link>
                    </div>
                    <div className="item-subtitle">Shell xtermjs Proxmox</div>
                  </div>
                  <div className="quick-actions">
                    <Link href={`/inventory/node/${encodeURIComponent(node.name)}`} className="action-btn">
                      Détails
                    </Link>
                    {hasLiveData ? (
                      <Link
                        className="action-btn"
                        href={buildProxmoxNodeShellUrl({ baseUrl: "", node: node.name })}
                      >
                        Ouvrir shell
                      </Link>
                    ) : (
                      <span className="muted">Connexion requise</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
