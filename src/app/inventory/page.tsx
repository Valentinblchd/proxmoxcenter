import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import InventoryWorkloadActions from "@/components/inventory-workload-actions";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { getProxmoxConfig } from "@/lib/proxmox/config";
import { buildProxmoxWorkloadConsoleUrl } from "@/lib/proxmox/console-url";
import { formatBytes, formatPercent, formatRelativeTime, formatUptime } from "@/lib/ui/format";

type InventoryRow = {
  id: string;
  vmid: number;
  name: string;
  type: "vm" | "ct" | "template";
  status: "running" | "stopped" | "template";
  node: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptimeSeconds: number;
  tags: string[];
  actionable: boolean;
};

type InventorySearchParams =
  Promise<Record<string, string | string[] | undefined>>;

type InventoryPageProps = {
  searchParams?: InventorySearchParams;
};

type InventoryTab = {
  id: string;
  label: string;
  href?: string;
};

const INVENTORY_TABS: InventoryTab[] = [
  { id: "summary", label: "Summary" },
  { id: "nodes", label: "Nodes" },
  { id: "virtual-machines", label: "Virtual machines" },
  { id: "high-availability", label: "High Availability" },
  { id: "backups", label: "Backups" },
  { id: "snapshots", label: "Snapshots" },
  { id: "notes", label: "Notes" },
  { id: "ceph", label: "Ceph" },
  { id: "storage", label: "Storage" },
  { id: "firewall", label: "Firewall" },
  { id: "rolling-update", label: "Rolling Update" },
  { id: "cve", label: "CVE" },
  { id: "cluster", label: "Cluster" },
];

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function readSearchParams(searchParams: InventorySearchParams | undefined) {
  if (!searchParams) return {};
  return await searchParams;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function buildWorkloadPageHref(type: InventoryRow["type"], vmid: number) {
  const kind = type === "vm" ? "qemu" : "lxc";
  return `/inventory/${kind}/${vmid}`;
}

function buildNodePageHref(node: string) {
  return `/inventory/node/${encodeURIComponent(node)}`;
}

function buildInventoryRows(
  snapshot: Awaited<ReturnType<typeof getDashboardSnapshot>>,
): InventoryRow[] {
  const baseRows = snapshot.workloads.map((workload) => {
    const type = workload.kind === "qemu" ? "vm" : "ct";

    return {
      id: workload.id,
      vmid: workload.vmid,
      name: workload.name,
      type,
      status: workload.status === "running" ? "running" : "stopped",
      node: workload.node,
      cpuLoad: clamp01(workload.cpuLoad),
      memoryUsed: workload.memoryUsed,
      memoryTotal: workload.memoryTotal,
      diskUsed: workload.diskUsed,
      diskTotal: workload.diskTotal,
      uptimeSeconds: workload.uptimeSeconds,
      tags: [workload.kind === "qemu" ? "qemu" : "lxc"],
      actionable: snapshot.mode === "live",
    } satisfies InventoryRow;
  });

  return baseRows
    .sort((a, b) => {
      const rank = (row: InventoryRow) =>
        row.status === "running" ? 0 : row.status === "stopped" ? 1 : 2;
      const delta = rank(a) - rank(b);
      if (delta !== 0) return delta;
      return a.vmid - b.vmid;
    })
    .slice(0, 300);
}

function getClusterLabel(node: string) {
  const parts = node.split(/[-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`.toUpperCase();
  }
  return node.toUpperCase();
}

function UsageBar({
  label,
  used,
  total,
  tone = "orange",
}: {
  label: string;
  used: number;
  total: number;
  tone?: "orange" | "green";
}) {
  const ratio = total > 0 ? clamp01(used / total) : 0;

  return (
    <div className="inventory-capacity-row">
      <div className="inventory-capacity-row-head">
        <span>{label}</span>
        <span className="muted">
          Used: {formatBytes(used)} • Capacity: {formatBytes(total)}
        </span>
      </div>
      <div className="inventory-progress inventory-progress-wide">
        <span className={`tone-${tone}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="inventory-capacity-row-foot">
        <span className="muted">
          Free: {formatBytes(Math.max(0, total - used))}
        </span>
        <strong>{Math.round(ratio * 100)}%</strong>
      </div>
    </div>
  );
}

export const metadata: Metadata = {
  title: "Inventaire | ProxCenter",
  description: "Inventaire VM/CT, nœuds et ressources Proxmox",
};

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await readSearchParams(searchParams);
  const snapshot = await getDashboardSnapshot();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const proxmox = getProxmoxConfig();
  const hasLiveData = snapshot.mode === "live";
  const allRows = buildInventoryRows(snapshot);

  const query = firstParam(params.q).trim();
  const nodeFilter = firstParam(params.node).trim();
  const requestedView = firstParam(params.view).trim().toLowerCase();
  const viewMode = requestedView === "compact" ? "compact" : "table";
  const requestedTab = firstParam(params.tab).trim().toLowerCase();
  const activeTab = INVENTORY_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "virtual-machines";

  const rows = allRows.filter((row) => {
    if (nodeFilter && row.node !== nodeFilter) return false;
    if (!query) return true;
    const haystack = `${row.name} ${row.node} ${row.vmid} ${row.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const clusters = snapshot.nodes.reduce<Record<string, string[]>>((acc, node) => {
    const cluster = getClusterLabel(node.name);
    acc[cluster] ??= [];
    acc[cluster].push(node.name);
    return acc;
  }, {});

  const totalMemory = rows.reduce((sum, row) => sum + row.memoryTotal, 0);
  const usedMemory = rows.reduce((sum, row) => sum + row.memoryUsed, 0);
  const totalStorage = rows.reduce((sum, row) => sum + row.diskTotal, 0);
  const usedStorage = rows.reduce((sum, row) => sum + row.diskUsed, 0);

  function buildInventoryHref(overrides: {
    tab?: string;
    view?: "table" | "compact";
    node?: string | null;
    q?: string | null;
  }) {
    const next = new URLSearchParams();
    const nextTab = overrides.tab ?? activeTab;
    const nextView = overrides.view ?? viewMode;
    const nextNode = overrides.node === undefined ? nodeFilter : overrides.node ?? "";
    const nextQuery = overrides.q === undefined ? query : overrides.q ?? "";

    if (nextTab && nextTab !== "virtual-machines") next.set("tab", nextTab);
    if (nextView === "compact") next.set("view", "compact");
    if (nextNode) next.set("node", nextNode);
    if (nextQuery) next.set("q", nextQuery);

    const search = next.toString();
    return search ? `/inventory?${search}` : "/inventory";
  }

  return (
    <section className="content content-wide inventory-page">
      <header className="inventory-page-header">
        <div className="inventory-title-wrap">
          <p className="eyebrow">Inventaire</p>
          <h1>Machines virtuelles & conteneurs</h1>
        </div>

        <div className="inventory-header-actions">
          <form method="get" action="/inventory" className="inventory-search-shell">
            <input type="hidden" name="tab" value={activeTab} />
            <input type="hidden" name="view" value={viewMode} />
            {nodeFilter ? <input type="hidden" name="node" value={nodeFilter} /> : null}
            <input
              type="search"
              className="inventory-search"
              name="q"
              defaultValue={query}
              placeholder="Search VM, CT, node..."
              aria-label="Recherche"
            />
          </form>
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          {nodeFilter ? (
            <Link href={buildInventoryHref({ node: null })} className="pill">
              Filtre nœud: {nodeFilter} ✕
            </Link>
          ) : null}
          {query ? (
            <Link href={buildInventoryHref({ q: null })} className="pill">
              Recherche: {query} ✕
            </Link>
          ) : null}
          <span className="muted inventory-time">
            Sync {formatRelativeTime(snapshot.lastUpdatedAt)}
          </span>
        </div>
      </header>

      <section className="inventory-workspace">
        <aside className="panel inventory-explorer">
          <div className="inventory-explorer-toolbar">
            <form method="get" action="/inventory" className="inventory-explorer-search-form">
              <input type="hidden" name="tab" value={activeTab} />
              <input type="hidden" name="view" value={viewMode} />
              {nodeFilter ? <input type="hidden" name="node" value={nodeFilter} /> : null}
              <input
                type="search"
                className="inventory-explorer-search"
                name="q"
                defaultValue={query}
                placeholder="Search"
                aria-label="Search inventory"
              />
            </form>
            <div className="inventory-icon-row" aria-label="Explorer tools">
              {["RG", "VM", "CT", "FD", "TG", "ST", "CP"].map((icon) => (
                <button key={icon} type="button" className="inventory-icon-btn" title={icon}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="inventory-explorer-scroll">
            <div className="inventory-tree-section">
              <div className="inventory-tree-root">
                <Link href="/inventory" className="tree-node-label tree-root-link">
                  Inventory
                </Link>
                <span className="tree-node-meta">
                  {Object.keys(clusters).length} clusters, {rows.length} items
                </span>
              </div>
              <div className="tree-node-children">
                {Object.keys(clusters).length === 0 ? (
                  <p className="muted">Aucune donnée nœud.</p>
                ) : (
                  Object.entries(clusters).map(([cluster, nodes]) => (
                    <div key={cluster} className="tree-branch">
                      <div className="tree-node cluster">
                        <span className="tree-bullet" />
                        <span className="tree-node-name">{cluster}</span>
                        <span className="tree-count">{nodes.length}</span>
                      </div>
                      <div className="tree-node-children">
                        {nodes.map((nodeName) => {
                          const nodeRows = rows.filter((row) => row.node === nodeName);

                          return (
                            <div key={nodeName} className="tree-branch">
                              <Link
                                href={buildNodePageHref(nodeName)}
                                className="tree-node node"
                                title={`Ouvrir ${nodeName}`}
                              >
                                <span className="tree-bullet" />
                                <span className="tree-node-name">{nodeName}</span>
                                <span className="tree-count">{nodeRows.length}</span>
                              </Link>
                              <div className="tree-node-children">
                                {nodeRows.slice(0, 6).map((row, index) => (
                                  <Link
                                    key={`${nodeName}-${row.id}-${index}`}
                                    href={buildWorkloadPageHref(row.type, row.vmid)}
                                    className="tree-node leaf"
                                    title={`${row.name} #${row.vmid}`}
                                  >
                                    <span className="tree-status-dot" data-status={row.status} />
                                    <span className="tree-node-name">
                                      {row.name}
                                      <span className="tree-node-inline-meta">#{row.vmid}</span>
                                    </span>
                                    <span className="tree-kind-badge">
                                      {row.type === "template" ? "TPL" : row.type.toUpperCase()}
                                    </span>
                                  </Link>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>

        <div className="inventory-main">
          <section className="panel inventory-capacity">
            <UsageBar label="Memory" used={usedMemory} total={Math.max(totalMemory, 1)} />
            <UsageBar
              label="Storage"
              used={usedStorage}
              total={Math.max(totalStorage, 1)}
              tone="green"
            />
          </section>

          <section className="panel inventory-tabs-panel">
            <div className="inventory-tabs">
              {INVENTORY_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const href = tab.href ?? buildInventoryHref({ tab: tab.id });

                return (
                  <Link key={tab.id} href={href} className={`inventory-tab${isActive ? " is-active" : ""}`}>
                    {tab.label}
                    {tab.label === "Nodes" ? (
                    <span className="inventory-tab-count">{snapshot.summary.nodes}</span>
                  ) : null}
                    {tab.label === "Virtual machines" ? (
                    <span className="inventory-tab-count">{rows.filter((r) => r.type === "vm").length}</span>
                  ) : null}
                  </Link>
                );
              })}
            </div>

            <div className="inventory-tabs-right">
              <Link
                href={buildInventoryHref({ view: "table" })}
                className={`inventory-mini-toggle${viewMode === "table" ? " is-active" : ""}`}
              >
                table
              </Link>
              <Link
                href={buildInventoryHref({ view: "compact" })}
                className={`inventory-mini-toggle${viewMode === "compact" ? " is-active" : ""}`}
              >
                compact
              </Link>
            </div>
          </section>

          <section className="panel inventory-table-panel">
            <div className="inventory-table-header">
              <div>
                <h2>
                  {activeTab === "virtual-machines" ? "Workloads" : INVENTORY_TABS.find((t) => t.id === activeTab)?.label ?? "Inventory"}{" "}
                  ({rows.length})
                </h2>
              </div>
              <div className="inventory-table-actions">
                <InventoryRefreshButton auto={hasLiveData} intervalMs={5000} />
                <Link href="/provision?kind=qemu" className="inventory-primary-btn">
                  + Create VM
                </Link>
                <Link href="/provision?kind=lxc" className="inventory-primary-btn alt">
                  + Create LXC
                </Link>
              </div>
            </div>

            <div className="inventory-table-wrap">
              <table className={`inventory-table${viewMode === "compact" ? " is-compact" : ""}`}>
                <thead>
                  <tr>
                    <th>Fav</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Node</th>
                    <th>CPU</th>
                    <th>RAM</th>
                    <th>Disk</th>
                    <th>Tags</th>
                    <th>Uptime</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={11}>
                        <div className="hint-box">
                          <p className="muted">
                            Aucun résultat pour ce filtre. Essaie un autre nœud ou vide la recherche.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : rows.map((row) => {
                    const ramRatio = row.memoryTotal > 0 ? row.memoryUsed / row.memoryTotal : 0;

                    return (
                      <tr id={`inv-row-${row.id.replaceAll("/", "-")}`} key={row.id} className="inventory-row-clickable">
                        <td>
                          <Link
                            href={buildWorkloadPageHref(row.type, row.vmid)}
                            className="inventory-row-overlay-link"
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                          <button type="button" className="inventory-inline-icon" aria-label="Favorite">
                            ☆
                          </button>
                        </td>
                        <td>
                          <div className="inventory-name-cell">
                            <span className="inventory-instance-icon">
                              {row.type === "vm" ? "VM" : row.type === "ct" ? "CT" : "TP"}
                            </span>
                            <div>
                              <Link
                                href={buildWorkloadPageHref(row.type, row.vmid)}
                                className="inventory-name-line inventory-row-link"
                                title={`Ouvrir ${row.name} #${row.vmid}`}
                              >
                                {row.name} <span className="muted">#{row.vmid}</span>
                              </Link>
                              <div className="inventory-subline muted">{row.node}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`inventory-badge type-${row.type}`}>
                            {row.type === "template" ? "template" : row.type}
                          </span>
                        </td>
                        <td>
                          <span className={`inventory-badge status-${row.status}`}>
                            {row.status === "running"
                              ? "Run"
                              : row.status === "stopped"
                                ? "Stop"
                                : "Tpl"}
                          </span>
                        </td>
                        <td>
                          <Link href={buildNodePageHref(row.node)} className="inventory-cell-link">
                            {row.node}
                          </Link>
                        </td>
                        <td>
                          <div className="inventory-meter-cell">
                            <div className="inventory-progress">
                              <span className="tone-green" style={{ width: `${Math.round(row.cpuLoad * 100)}%` }} />
                            </div>
                            <strong>{formatPercent(row.cpuLoad)}</strong>
                          </div>
                        </td>
                        <td>
                          <div className="inventory-meter-cell">
                            <div className="inventory-progress">
                              <span className="tone-orange" style={{ width: `${Math.round(clamp01(ramRatio) * 100)}%` }} />
                            </div>
                            <strong>{formatPercent(ramRatio)}</strong>
                          </div>
                        </td>
                        <td>
                          {row.diskTotal > 0
                            ? `${formatBytes(row.diskUsed)} / ${formatBytes(row.diskTotal)}`
                            : "—"}
                        </td>
                        <td>
                          <div className="inventory-tag-list">
                            {row.tags.slice(0, 2).map((tag) => (
                              <span key={`${row.id}-${tag}`} className="inventory-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {row.uptimeSeconds > 0 ? formatUptime(row.uptimeSeconds) : "-"}
                        </td>
                        <td>
                          {row.type === "template" ? (
                            <div className="inventory-action-cluster">
                              <button
                                type="button"
                                className="inventory-inline-icon"
                                title="Template (actions désactivées)"
                                disabled
                              >
                                TP
                              </button>
                            </div>
                          ) : (
                            <InventoryWorkloadActions
                              node={row.node}
                              vmid={row.vmid}
                              kind={row.type === "vm" ? "qemu" : "lxc"}
                              status={row.status}
                              actionable={row.actionable && canOperate}
                              consoleHref={proxmox
                                ? buildProxmoxWorkloadConsoleUrl({
                                    baseUrl: proxmox.baseUrl,
                                    node: row.node,
                                    vmid: row.vmid,
                                    kind: row.type === "vm" ? "qemu" : "lxc",
                                  })
                                : null}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="inventory-table-footer">
              <span className="muted">
                {rows.filter((row) => row.status === "running").length} running / {rows.length} total
              </span>
              <span className="muted">{rows.length} workloads listés</span>
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}
