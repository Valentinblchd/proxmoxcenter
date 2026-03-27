import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import InventoryViewTools from "@/components/inventory-view-tools";
import InventoryWorkloadActions from "@/components/inventory-workload-actions";
import PlatformStateAlerts from "@/components/platform-state-alerts";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { hasRuntimeCapability } from "@/lib/auth/rbac";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { formatBytes, formatPercent, formatRelativeTime, formatUptime } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "Inventaire | ProxmoxCenter",
  description: "Inventaire Proxmox (nœuds, VM/CT, HA, backups, snapshots, stockage).",
};

export const dynamic = "force-dynamic";

type InventorySearchParams = Promise<Record<string, string | string[] | undefined>>;

type InventoryPageProps = {
  searchParams?: InventorySearchParams;
};

type InventoryTabId = "summary" | "nodes" | "workloads" | "ha" | "backups" | "snapshots" | "notes" | "storage";

type InventoryTab = {
  id: InventoryTabId;
  label: string;
};

type InventoryRow = {
  id: string;
  vmid: number;
  name: string;
  kind: "qemu" | "lxc";
  status: "running" | "stopped";
  node: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptimeSeconds: number;
};

type NodeRuntime = {
  node: string;
  cpuLoad: number;
  memoryUsed: number;
  memoryTotal: number;
  rootfsUsed: number;
  rootfsTotal: number;
  netIn: number;
  netOut: number;
  uptimeSeconds: number;
};

type NodeStatusPayload = {
  cpu?: unknown;
  uptime?: unknown;
  memory?: {
    used?: unknown;
    total?: unknown;
  };
  rootfs?: {
    used?: unknown;
    total?: unknown;
  };
};

type NodeHistoryPoint = {
  netin?: unknown;
  netout?: unknown;
};

type HaResource = {
  sid: string;
  state: string;
  group: string | null;
  node: string | null;
  serviceType: string | null;
  service: string | null;
  comment: string | null;
};

type BackupJob = {
  id: string;
  enabled: boolean;
  node: string | null;
  storage: string | null;
  schedule: string | null;
  mode: string | null;
  vmid: string | null;
  exclude: string | null;
};

type SnapshotHint = {
  workloadId: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  count: number;
  lastAt: string | null;
};

type WorkloadNote = {
  workloadId: string;
  kind: "qemu" | "lxc";
  vmid: number;
  node: string;
  name: string;
  note: string;
};

type StorageView = {
  id: string;
  node: string;
  storage: string;
  type: string | null;
  content: string | null;
  used: number;
  total: number;
  shared: boolean;
  active: boolean | null;
};

const INVENTORY_TABS: InventoryTab[] = [
  { id: "summary", label: "Résumé" },
  { id: "nodes", label: "Nœuds" },
  { id: "workloads", label: "VM / CT" },
  { id: "ha", label: "HA" },
  { id: "backups", label: "Sauvegardes" },
  { id: "snapshots", label: "Snapshots" },
  { id: "notes", label: "Notes" },
  { id: "storage", label: "Stockages" },
];

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function readSearchParams(searchParams: InventorySearchParams | undefined) {
  if (!searchParams) return {};
  return await searchParams;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function formatCapacityPair(used: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) {
    if (!Number.isFinite(used) || used <= 0) return "—";
    return `${formatBytes(used)} / —`;
  }
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatRatePair(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B/s";
  return `${formatBytes(value)}/s`;
}

function toInventoryRows(snapshot: Awaited<ReturnType<typeof getDashboardSnapshot>>): InventoryRow[] {
  return snapshot.workloads
    .map((item) => ({
      id: item.id,
      vmid: item.vmid,
      name: item.name,
      kind: item.kind,
      status: (item.status === "running" ? "running" : "stopped") as "running" | "stopped",
      node: item.node,
      cpuLoad: clamp01(item.cpuLoad),
      memoryUsed: item.memoryUsed,
      memoryTotal: item.memoryTotal,
      diskUsed: item.diskUsed,
      diskTotal: item.diskTotal,
      uptimeSeconds: item.uptimeSeconds,
    }))
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "running" ? -1 : 1;
      return left.vmid - right.vmid;
    });
}

function buildWorkloadHref(kind: "qemu" | "lxc", vmid: number) {
  return `/inventory/${kind}/${vmid}`;
}

function buildWorkloadConsoleHref(kind: "qemu" | "lxc", vmid: number) {
  if (kind === "qemu") {
    return `/console/workload/qemu/${vmid}?mode=novnc`;
  }
  return `/console/workload/lxc/${vmid}`;
}

function buildNodeHref(node: string) {
  return `/inventory/node/${encodeURIComponent(node)}`;
}

async function fetchNodeRuntime(node: string): Promise<NodeRuntime | null> {
  try {
    const encodedNode = encodeURIComponent(node);
    const [statusResult, historyResult] = await Promise.allSettled([
      proxmoxRequest<NodeStatusPayload>(`nodes/${encodedNode}/status`),
      proxmoxRequest<NodeHistoryPoint[]>(`nodes/${encodedNode}/rrddata?timeframe=hour&cf=AVERAGE`),
    ]);
    if (statusResult.status !== "fulfilled") {
      return null;
    }
    const payload = statusResult.value;
    const historyPoints = historyResult.status === "fulfilled" ? historyResult.value : [];
    const lastPoint = [...historyPoints]
      .reverse()
      .find((point) => typeof point.netin === "number" || typeof point.netout === "number");
    return {
      node,
      cpuLoad: clamp01(asNumber(payload.cpu)),
      memoryUsed: asNumber(payload.memory?.used),
      memoryTotal: asNumber(payload.memory?.total),
      rootfsUsed: asNumber(payload.rootfs?.used),
      rootfsTotal: asNumber(payload.rootfs?.total),
      netIn: asNumber(lastPoint?.netin),
      netOut: asNumber(lastPoint?.netout),
      uptimeSeconds: asNumber(payload.uptime),
    };
  } catch {
    return null;
  }
}

async function fetchHaResources() {
  try {
    const payload = await proxmoxRequest<Array<Record<string, unknown>>>("cluster/ha/resources");
    return payload.map((entry) => ({
      sid: asString(entry.sid) ?? "unknown",
      state: asString(entry.state) ?? "unknown",
      group: asString(entry.group),
      node: asString(entry.node),
      serviceType: asString(entry.type),
      service: asString(entry.service),
      comment: asString(entry.comment),
    })) as HaResource[];
  } catch {
    return [] as HaResource[];
  }
}

async function fetchBackupJobs() {
  try {
    const payload = await proxmoxRequest<Array<Record<string, unknown>>>("cluster/backup");
    return payload.map((entry, index) => ({
      id: asString(entry.id) ?? `job-${index + 1}`,
      enabled: asBoolean(entry.enabled) ?? true,
      node: asString(entry.node),
      storage: asString(entry.storage),
      schedule: asString(entry.schedule),
      mode: asString(entry.mode),
      vmid: asString(entry.vmid),
      exclude: asString(entry.exclude),
    })) as BackupJob[];
  } catch {
    return [] as BackupJob[];
  }
}

async function fetchSnapshotHints(rows: InventoryRow[]) {
  const subset = rows.slice(0, 14);
  const snapshots = await Promise.all(
    subset.map(async (row) => {
      try {
        const payload = await proxmoxRequest<Array<Record<string, unknown>>>(
          `nodes/${encodeURIComponent(row.node)}/${row.kind}/${row.vmid}/snapshot`,
        );
        const valid = payload.filter((item) => asString(item.name) !== "current");
        const lastEpoch = valid.reduce((max, item) => {
          const raw = asNumber(item.snaptime);
          return raw > max ? raw : max;
        }, 0);
        return {
          workloadId: row.id,
          kind: row.kind,
          vmid: row.vmid,
          node: row.node,
          name: row.name,
          count: valid.length,
          lastAt: lastEpoch > 0 ? new Date(lastEpoch * 1000).toISOString() : null,
        } satisfies SnapshotHint;
      } catch {
        return {
          workloadId: row.id,
          kind: row.kind,
          vmid: row.vmid,
          node: row.node,
          name: row.name,
          count: 0,
          lastAt: null,
        } satisfies SnapshotHint;
      }
    }),
  );

  return snapshots.sort((left, right) => right.count - left.count);
}

async function fetchWorkloadNotes(rows: InventoryRow[]) {
  const subset = rows.slice(0, 20);
  const notes = await Promise.all(
    subset.map(async (row) => {
      try {
        const payload = await proxmoxRequest<Record<string, unknown>>(
          `nodes/${encodeURIComponent(row.node)}/${row.kind}/${row.vmid}/config`,
        );
        const text = asString(payload.description) ?? asString(payload.notes) ?? asString(payload.comment) ?? "";
        return {
          workloadId: row.id,
          kind: row.kind,
          vmid: row.vmid,
          node: row.node,
          name: row.name,
          note: text.trim(),
        } satisfies WorkloadNote;
      } catch {
        return null;
      }
    }),
  );
  return notes.filter((item): item is WorkloadNote => Boolean(item && item.note.length > 0));
}

async function fetchStorages(nodes: string[]) {
  const perNode = await Promise.all(
    nodes.map(async (node) => {
      try {
        const payload = await proxmoxRequest<Array<Record<string, unknown>>>(
          `nodes/${encodeURIComponent(node)}/storage`,
        );
        return payload.map((entry) => ({
          id: `${node}:${asString(entry.storage) ?? "unknown"}`,
          node,
          storage: asString(entry.storage) ?? "unknown",
          type: asString(entry.type),
          content: asString(entry.content),
          used: asNumber(entry.used),
          total: asNumber(entry.total),
          shared: asBoolean(entry.shared) ?? false,
          active: asBoolean(entry.active),
        })) as StorageView[];
      } catch {
        return [] as StorageView[];
      }
    }),
  );
  return perNode.flat().sort((left, right) => left.storage.localeCompare(right.storage));
}

function UsageBar({ value, tone }: { value: number; tone: "orange" | "green" }) {
  return (
    <div className="inventory-progress inventory-progress-wide">
      <span className={tone === "orange" ? "tone-orange" : "tone-green"} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await readSearchParams(searchParams);
  const snapshot = await getDashboardSnapshot();
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canOperate = hasRuntimeCapability(session?.role, "operate");
  const hasLiveData = snapshot.mode === "live";

  const requestedTab = firstParam(params.tab).trim().toLowerCase() as InventoryTabId;
  const activeTab = INVENTORY_TABS.some((tab) => tab.id === requestedTab) ? requestedTab : "summary";
  const query = firstParam(params.q).trim();
  const nodeFilter = firstParam(params.node).trim();

  const allRows = toInventoryRows(snapshot);
  const filteredRows = allRows.filter((row) => {
    if (nodeFilter && row.node !== nodeFilter) return false;
    if (!query) return true;
    const haystack = `${row.name} ${row.node} ${row.vmid} ${row.kind}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const nodeNames = Array.from(new Set(snapshot.nodes.map((item) => item.name))).sort((a, b) =>
    a.localeCompare(b),
  );
  const selectedNode = nodeFilter || nodeNames[0] || "";

  const shouldLoadNodeRuntime = hasLiveData && (activeTab === "summary" || activeTab === "nodes");
  const nodeRuntimeList = shouldLoadNodeRuntime
    ? (
        await Promise.all(
          nodeNames.map((node) => fetchNodeRuntime(node)),
        )
      ).filter((item): item is NodeRuntime => Boolean(item))
    : [];
  const selectedNodeRuntime = nodeRuntimeList.find((item) => item.node === selectedNode) ?? null;

  const haResources = hasLiveData && activeTab === "ha" ? await fetchHaResources() : [];
  const backupJobs =
    hasLiveData && (activeTab === "backups" || activeTab === "summary") ? await fetchBackupJobs() : [];
  const snapshotHints = hasLiveData && activeTab === "snapshots" ? await fetchSnapshotHints(filteredRows) : [];
  const workloadNotes = hasLiveData && activeTab === "notes" ? await fetchWorkloadNotes(filteredRows) : [];
  const storageViews = hasLiveData && activeTab === "storage" ? await fetchStorages(nodeNames) : [];
  const runningWorkloads = filteredRows.filter((row) => row.status === "running").length;
  const activeBackupJobs = backupJobs.filter((job) => job.enabled).length;

  function buildInventoryHref(overrides: { tab?: InventoryTabId; node?: string | null; q?: string | null }) {
    const next = new URLSearchParams();
    const tab = overrides.tab ?? activeTab;
    const node = overrides.node === undefined ? nodeFilter : overrides.node ?? "";
    const q = overrides.q === undefined ? query : overrides.q ?? "";

    if (tab !== "summary") next.set("tab", tab);
    if (node) next.set("node", node);
    if (q) next.set("q", q);
    const search = next.toString();
    return search ? `/inventory?${search}` : "/inventory";
  }

  return (
    <section className="content content-wide inventory-page inventory-page-clean">
      <header className="topbar">
        <div>
          <p className="eyebrow">Inventaire</p>
          <h1>Nœuds, VM et CT</h1>
          <p className="muted">
            Recherche, pilotage rapide et accès aux fiches VM, CT, nœuds, sauvegardes et stockages.
          </p>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Proxmox connecté</span> : <span className="pill">Hors ligne</span>}
          <span className="pill">{canOperate ? "Mode opérateur" : "Lecture seule"}</span>
        </div>
      </header>

      <PlatformStateAlerts live={hasLiveData} warnings={snapshot.warnings} />

      <section className="panel inventory-toolbar-panel">
        <div className="inventory-toolbar">
          <form method="get" action="/inventory" className="inventory-search-shell compact">
            {activeTab !== "summary" ? <input type="hidden" name="tab" value={activeTab} /> : null}
            {nodeFilter ? <input type="hidden" name="node" value={nodeFilter} /> : null}
            <input
              type="search"
              className="inventory-search"
              name="q"
              defaultValue={query}
              placeholder="Rechercher VM/CT, VMID, nœud"
              aria-label="Recherche inventaire"
            />
          </form>

          <div className="inventory-toolbar-actions">
            <form method="get" action="/inventory" className="inventory-toolbar-filter">
              {activeTab !== "summary" ? <input type="hidden" name="tab" value={activeTab} /> : null}
              {query ? <input type="hidden" name="q" value={query} /> : null}
              <select className="field-input inventory-node-filter" name="node" defaultValue={nodeFilter}>
                <option value="">Tous les nœuds</option>
                {nodeNames.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>
              <button type="submit" className="action-btn">
                Filtrer
              </button>
            </form>

            <InventoryRefreshButton auto={hasLiveData} intervalMs={5000} />

            <div className="inventory-toolbar-cta">
              <Link href="/provision?kind=qemu" className="action-btn primary">
                Créer VM
              </Link>
              <Link href="/provision?kind=lxc" className="action-btn">
                Créer LXC
              </Link>
            </div>
          </div>
        </div>
        <InventoryViewTools
          currentHref={buildInventoryHref({})}
          activeTab={activeTab}
          query={query}
          nodeFilter={nodeFilter}
        />
      </section>

      {activeTab === "summary" ? (
        <section className="stats-grid inventory-kpi-grid">
          <article className="stat-tile">
            <div className="stat-label">Workloads</div>
            <div className="stat-value">{filteredRows.length}</div>
            <div className="stat-subtle">{query ? `Recherche: ${query}` : "VM et CT visibles"}</div>
          </article>
          <article className="stat-tile">
            <div className="stat-label">En ligne</div>
            <div className="stat-value">{runningWorkloads}</div>
            <div className="stat-subtle">{filteredRows.length - runningWorkloads} arrêtés</div>
          </article>
          <article className="stat-tile">
            <div className="stat-label">Nœuds</div>
            <div className="stat-value">{snapshot.summary.nodes}</div>
            <div className="stat-subtle">{selectedNode || "Vue cluster"}</div>
          </article>
          <article className="stat-tile">
            <div className="stat-label">Backups</div>
            <div className="stat-value">{activeBackupJobs}</div>
            <div className="stat-subtle">{backupJobs.length} job(s) Proxmox détecté(s)</div>
          </article>
        </section>
      ) : null}

      <section className="panel inventory-tabs-panel">
        <div className="inventory-tabs">
          {INVENTORY_TABS.map((tab) => (
            <Link
              key={tab.id}
              href={buildInventoryHref({ tab: tab.id })}
              className={`inventory-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
              {tab.id === "nodes" ? <span className="inventory-tab-count">{snapshot.summary.nodes}</span> : null}
              {tab.id === "workloads" ? <span className="inventory-tab-count">{filteredRows.length}</span> : null}
            </Link>
          ))}
        </div>
      </section>

      {activeTab === "summary" ? (
        <section className="content-grid inventory-summary-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Résumé nœud Proxmox</h2>
              <span className="muted">{selectedNode || "—"}</span>
            </div>
            {selectedNodeRuntime ? (
              <div className="stack-sm">
                <div className="mini-summary">
                  <span className="mini-label">CPU</span>
                  <strong>{formatPercent(selectedNodeRuntime.cpuLoad)}</strong>
                </div>
                <UsageBar value={selectedNodeRuntime.cpuLoad} tone="green" />
                <div className="mini-summary">
                  <span className="mini-label">RAM</span>
                  <strong>{formatCapacityPair(selectedNodeRuntime.memoryUsed, selectedNodeRuntime.memoryTotal)}</strong>
                </div>
                <UsageBar
                  value={selectedNodeRuntime.memoryTotal > 0 ? selectedNodeRuntime.memoryUsed / selectedNodeRuntime.memoryTotal : 0}
                  tone="orange"
                />
                <div className="mini-summary">
                  <span className="mini-label">Stockage nœud</span>
                  <strong>{formatCapacityPair(selectedNodeRuntime.rootfsUsed, selectedNodeRuntime.rootfsTotal)}</strong>
                </div>
                <UsageBar
                  value={selectedNodeRuntime.rootfsTotal > 0 ? selectedNodeRuntime.rootfsUsed / selectedNodeRuntime.rootfsTotal : 0}
                  tone="orange"
                />
                <div className="mini-summary">
                  <span className="mini-label">Réseau instantané</span>
                  <strong>
                    In {formatRatePair(selectedNodeRuntime.netIn)} • Out {formatRatePair(selectedNodeRuntime.netOut)}
                  </strong>
                </div>
                <div className="mini-summary">
                  <span className="mini-label">Uptime</span>
                  <strong>{selectedNodeRuntime.uptimeSeconds > 0 ? formatUptime(selectedNodeRuntime.uptimeSeconds) : "—"}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">Aucune donnée nœud détaillée disponible.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Nœuds du cluster</h2>
              <span className="muted">{nodeRuntimeList.length}</span>
            </div>
            {nodeRuntimeList.length === 0 ? (
              <p className="muted">Aucune donnée nœud disponible.</p>
            ) : (
              <div className="mini-list">
                {nodeRuntimeList.map((node) => {
                  const memRatio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
                  return (
                    <Link
                      key={`summary-node-${node.node}`}
                      href={buildNodeHref(node.node)}
                      className="mini-list-item mini-list-link"
                    >
                      <div>
                        <div className="item-title">{node.node}</div>
                        <div className="item-subtitle">
                          CPU {formatPercent(node.cpuLoad)} • RAM {formatCapacityPair(node.memoryUsed, node.memoryTotal)}
                        </div>
                      </div>
                      <div className="item-metric">
                        <div className="inventory-progress inventory-progress-wide">
                          <span className="tone-green" style={{ width: `${Math.round(node.cpuLoad * 100)}%` }} />
                        </div>
                        <div className="inventory-progress inventory-progress-wide">
                          <span className="tone-orange" style={{ width: `${Math.round(clamp01(memRatio) * 100)}%` }} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      ) : null}

      {activeTab === "nodes" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Nœuds</h2>
            <span className="muted">{nodeRuntimeList.length}</span>
          </div>
          {nodeRuntimeList.length === 0 ? (
            <p className="muted">Aucune métrique nœud disponible.</p>
          ) : (
            <div className="mini-list">
              {nodeRuntimeList.map((node) => (
                <Link key={node.node} href={buildNodeHref(node.node)} className="mini-list-item mini-list-link">
                  <div>
                    <div className="item-title">{node.node}</div>
                    <div className="item-subtitle">
                      CPU {formatPercent(node.cpuLoad)} • RAM {formatCapacityPair(node.memoryUsed, node.memoryTotal)}
                    </div>
                  </div>
                  <div className="item-metric">{node.uptimeSeconds > 0 ? formatUptime(node.uptimeSeconds) : "—"}</div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "workloads" ? (
        <section className="panel inventory-table-panel">
          <div className="inventory-table-header">
            <div>
              <h2>Workloads ({filteredRows.length})</h2>
            </div>
          </div>
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Nœud</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Disque</th>
                  <th>Uptime</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="hint-box">
                        <p className="muted">Aucun workload avec ces filtres.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const rowHref = buildWorkloadHref(row.kind, row.vmid);
                    const memoryRatio = row.memoryTotal > 0 ? row.memoryUsed / row.memoryTotal : 0;
                    const diskRatio = row.diskTotal > 0 ? row.diskUsed / row.diskTotal : 0;
                    return (
                      <tr key={row.id} className="inventory-row-clickable inventory-row-full-click">
                        <td className="inventory-cell-main">
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <div className="inventory-name-cell">
                            <span className="inventory-instance-icon">{row.kind === "qemu" ? "VM" : "CT"}</span>
                            <div>
                              <Link href={rowHref} prefetch={false} className="inventory-name-line inventory-row-link">
                                {row.name} <span className="muted">#{row.vmid}</span>
                              </Link>
                              <div className="inventory-subline muted">{row.node}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <span className={`inventory-badge ${row.kind === "qemu" ? "type-vm" : "type-ct"}`}>
                            {row.kind === "qemu" ? "VM" : "CT"}
                          </span>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <span className={`inventory-badge status-${row.status}`}>
                            {row.status === "running" ? "RUN" : "STOP"}
                          </span>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <Link href={buildNodeHref(row.node)} className="inventory-cell-link">
                            {row.node}
                          </Link>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <div className="inventory-meter-cell">
                            <div className="inventory-progress">
                              <span className="tone-green" style={{ width: `${Math.round(row.cpuLoad * 100)}%` }} />
                            </div>
                            <strong>{formatPercent(row.cpuLoad)}</strong>
                          </div>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <div className="inventory-meter-cell">
                            <div className="inventory-progress">
                              <span className="tone-orange" style={{ width: `${Math.round(clamp01(memoryRatio) * 100)}%` }} />
                            </div>
                            <strong>
                              {formatCapacityPair(row.memoryUsed, row.memoryTotal)}
                            </strong>
                          </div>
                        </td>
                        <td>
                          <Link href={rowHref} prefetch={false} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          <div className="inventory-meter-cell">
                            <div className="inventory-progress">
                              <span className="tone-orange" style={{ width: `${Math.round(clamp01(diskRatio) * 100)}%` }} />
                            </div>
                            <strong>
                              {formatCapacityPair(row.diskUsed, row.diskTotal)}
                            </strong>
                          </div>
                        </td>
                        <td>
                          <Link href={rowHref} className="inventory-row-overlay-link" tabIndex={-1} aria-hidden="true" />
                          {row.uptimeSeconds > 0 ? formatUptime(row.uptimeSeconds) : "—"}
                        </td>
                        <td className="inventory-row-actions">
                          <InventoryWorkloadActions
                            node={row.node}
                            vmid={row.vmid}
                            kind={row.kind}
                            status={row.status}
                            actionable={canOperate && hasLiveData}
                            consoleHref={buildWorkloadConsoleHref(row.kind, row.vmid)}
                            compact
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "ha" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>High Availability</h2>
            <span className="muted">{haResources.length}</span>
          </div>
          {haResources.length === 0 ? (
            <p className="muted">Aucune ressource HA remontée.</p>
          ) : (
            <div className="mini-list">
              {haResources.map((item) => (
                <article key={item.sid} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {item.sid}
                      <span className={`inventory-badge status-${item.state === "started" ? "running" : "pending"}`}>
                        {item.state}
                      </span>
                    </div>
                    <div className="item-subtitle">
                      {[item.node, item.group, item.serviceType, item.service].filter(Boolean).join(" • ") || "—"}
                    </div>
                    {item.comment ? <div className="item-subtitle">{item.comment}</div> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "backups" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Backups Proxmox</h2>
            <span className="muted">{backupJobs.length}</span>
          </div>
          {backupJobs.length === 0 ? (
            <div className="hint-box">
              <p className="muted">Aucun job backup Proxmox détecté.</p>
              <Link href="/backups" className="action-btn primary">
                Ouvrir la page Sauvegardes
              </Link>
            </div>
          ) : (
            <div className="mini-list">
              {backupJobs.map((job) => (
                <article key={job.id} className="mini-list-item">
                  <div>
                    <div className="item-title">
                      {job.id}
                      <span className={`inventory-badge ${job.enabled ? "status-running" : "status-stopped"}`}>
                        {job.enabled ? "actif" : "désactivé"}
                      </span>
                    </div>
                    <div className="item-subtitle">
                      {[job.node, job.storage, job.schedule].filter(Boolean).join(" • ") || "—"}
                    </div>
                    <div className="item-subtitle">
                      {[job.mode, job.vmid ? `vmid ${job.vmid}` : null, job.exclude].filter(Boolean).join(" • ") || "—"}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "snapshots" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Snapshots</h2>
            <span className="muted">{snapshotHints.length}</span>
          </div>
          {snapshotHints.length === 0 ? (
            <p className="muted">Aucun snapshot détecté sur la sélection courante.</p>
          ) : (
            <div className="mini-list">
              {snapshotHints.map((item) => (
                <Link key={item.workloadId} href={buildWorkloadHref(item.kind, item.vmid)} className="mini-list-item mini-list-link">
                  <div>
                    <div className="item-title">
                      {item.name} <span className="muted">#{item.vmid}</span>
                    </div>
                    <div className="item-subtitle">
                      {item.node} • {item.kind.toUpperCase()}
                    </div>
                  </div>
                  <div className="item-metric">
                    {item.count} {item.count > 1 ? "snapshots" : "snapshot"}
                    <div className="item-subtitle">{item.lastAt ? formatRelativeTime(item.lastAt) : "—"}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Notes workloads</h2>
            <span className="muted">{workloadNotes.length}</span>
          </div>
          {workloadNotes.length === 0 ? (
            <p className="muted">Aucune note/description détectée.</p>
          ) : (
            <div className="mini-list">
              {workloadNotes.map((item) => (
                <Link key={item.workloadId} href={buildWorkloadHref(item.kind, item.vmid)} className="mini-list-item mini-list-link">
                  <div>
                    <div className="item-title">
                      {item.name} <span className="muted">#{item.vmid}</span>
                    </div>
                    <div className="item-subtitle">{item.node}</div>
                    <div className="item-subtitle">{item.note}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "storage" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Stockages</h2>
            <span className="muted">{storageViews.length}</span>
          </div>
          {storageViews.length === 0 ? (
            <p className="muted">Aucun stockage remonté.</p>
          ) : (
            <div className="mini-list">
              {storageViews.map((storage) => (
                <Link
                  key={storage.id}
                  href={`/inventory/storage/${encodeURIComponent(storage.node)}/${encodeURIComponent(storage.storage)}`}
                  className="mini-list-item mini-list-link"
                >
                  <div>
                    <div className="item-title">
                      {storage.storage}
                      <span className={`inventory-badge ${storage.active === false ? "status-stopped" : "status-running"}`}>
                        {storage.active === false ? "down" : "up"}
                      </span>
                    </div>
                    <div className="item-subtitle">
                      {[storage.node, storage.type, storage.content].filter(Boolean).join(" • ")}
                    </div>
                  </div>
                  <div className="item-metric">
                    {formatCapacityPair(storage.used, storage.total)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
