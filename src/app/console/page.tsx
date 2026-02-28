import Link from "next/link";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import {
  buildProxmoxNodeShellUrl,
  buildProxmoxWorkloadConsoleUrl,
} from "@/lib/proxmox/console-url";

export const dynamic = "force-dynamic";

type ConsolePageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

const TABS = [
  { id: "overview", label: "Vue globale" },
  { id: "nodes", label: "Shell nœuds" },
  { id: "workloads", label: "Console VM/CT" },
  { id: "rdp", label: "RDP / prise en main" },
] as const;

async function readSearchParams(
  value: ConsolePageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  if (typeof (value as Promise<Record<string, string | string[] | undefined>>).then === "function") {
    return (await value) ?? {};
  }
  return value ?? {};
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
  const proxmox = getProxmoxConfig();
  const runningWorkloads = snapshot.workloads.filter((item) => item.status === "running").slice(0, 30);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Console</p>
          <h1>Console / Shell / Prise en main</h1>
        </div>
        <div className="topbar-meta">
          {proxmox ? (
            <a href={proxmox.baseUrl} target="_blank" rel="noreferrer" className="action-btn">
              Ouvrir Proxmox
            </a>
          ) : null}
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
              <h2>Accès rapide</h2>
              <span className="muted">Actions</span>
            </div>
            <div className="quick-actions">
              <Link href="/console?tab=nodes" className="action-btn">
                Shell nœuds
              </Link>
              <Link href="/console?tab=workloads" className="action-btn">
                Console VM/CT
              </Link>
              <Link href="/console?tab=rdp" className="action-btn primary">
                Prise en main RDP
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
                    <div className="item-title">{node.name}</div>
                    <div className="item-subtitle">Shell xtermjs Proxmox</div>
                  </div>
                  {proxmox ? (
                    <a
                      className="action-btn"
                      href={buildProxmoxNodeShellUrl({ baseUrl: proxmox.baseUrl, node: node.name })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvrir shell
                    </a>
                  ) : (
                    <span className="muted">Connexion requise</span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "workloads" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Console VM / CT</h2>
            <span className="muted">{runningWorkloads.length} workload(s) en marche</span>
          </div>
          {runningWorkloads.length === 0 ? (
            <p className="muted">Aucun workload running détecté.</p>
          ) : (
            <div className="mini-list">
              {runningWorkloads.map((workload) => (
                <article key={workload.id} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {workload.name}
                      <span className="inventory-badge status-running">{workload.kind.toUpperCase()}</span>
                    </div>
                    <div className="item-subtitle">
                      {workload.node} • VMID {workload.vmid}
                    </div>
                  </div>
                  {proxmox ? (
                    <a
                      className="action-btn"
                      href={buildProxmoxWorkloadConsoleUrl({
                        baseUrl: proxmox.baseUrl,
                        node: workload.node,
                        vmid: workload.vmid,
                        kind: workload.kind,
                      })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvrir console
                    </a>
                  ) : (
                    <span className="muted">Connexion requise</span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "rdp" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>RDP / prise en main</h2>
            <span className="muted">Prochaine étape</span>
          </div>
          <div className="stack-sm">
            <div className="row-line">
              <span>Étape 1</span>
              <strong>Consoles Proxmox noVNC/xtermjs</strong>
            </div>
            <div className="row-line">
              <span>Étape 2</span>
              <strong>Passerelle RDP web centralisée</strong>
            </div>
            <div className="row-line">
              <span>Étape 3</span>
              <strong>RBAC + traçabilité des sessions</strong>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
