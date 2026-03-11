import Link from "next/link";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import GreenItCalibrationPanel from "@/components/greenit-calibration-panel";
import { fetchHardwareSnapshot, type HardwareSnapshot, type HardwareHealthState } from "@/lib/hardware/redfish";
import { readRuntimeHardwareMonitorConfig } from "@/lib/hardware/runtime-config";
import { buildGreenItAdvisor, buildSecurityAdvisor } from "@/lib/insights/advisor";
import { readRuntimeGreenItConfig } from "@/lib/greenit/runtime-config";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { formatBytes, formatPercent } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type ObservabilityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "overview", label: "Vue" },
  { id: "health", label: "Santé" },
  { id: "greenit", label: "GreenIT" },
] as const;

type DiskHealthRow = {
  id: string;
  node: string;
  devpath: string;
  model: string | null;
  serial: string | null;
  sizeBytes: number | null;
  health: string | null;
  wearout: number | null;
  temperatureC: number | null;
  powerOnHours: number | null;
};

type NodeHealthRow = {
  node: string;
  cpuLoad: number;
  memoryRatio: number;
  temperatureC: number | null;
  temperatureSource: string | null;
};

function formatHealthState(value: HardwareHealthState) {
  if (value === "ok") return "OK";
  if (value === "warning") return "warning";
  if (value === "critical") return "critical";
  return "inconnu";
}

function hardwareMatchesNode(snapshot: HardwareSnapshot | null, nodeName: string) {
  if (!snapshot) return false;
  if (!snapshot.nodeName) return true;
  return snapshot.nodeName === nodeName;
}

async function readSearchParams(
  value: ObservabilityPageProps["searchParams"],
): Promise<Record<string, string | string[] | undefined>> {
  if (!value) return {};
  return (await value) ?? {};
}

function readString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeHealthLabel(raw: string | null) {
  if (!raw) return "inconnu";
  const normalized = raw.trim().toLowerCase();
  if (["passed", "ok", "good"].includes(normalized)) return "ok";
  if (["warning", "warn"].includes(normalized)) return "warning";
  if (["failed", "critical", "bad"].includes(normalized)) return "critical";
  return raw;
}

function inferDiskSeverity(entry: DiskHealthRow): "ok" | "warning" | "critical" | "unknown" {
  const health = normalizeHealthLabel(entry.health);
  if (health === "critical") return "critical";
  if (health === "warning") return "warning";
  if (health === "ok") {
    if (entry.wearout !== null && entry.wearout <= 10) return "critical";
    if (entry.wearout !== null && entry.wearout <= 20) return "warning";
    return "ok";
  }
  return "unknown";
}

function estimateRemainingLifeYears(entry: DiskHealthRow) {
  if (entry.powerOnHours === null || entry.wearout === null) return null;
  if (entry.powerOnHours <= 0 || entry.wearout <= 0 || entry.wearout >= 100) return null;
  const yearsInService = entry.powerOnHours / 24 / 365;
  if (!Number.isFinite(yearsInService) || yearsInService <= 0) return null;
  const consumedPercent = 100 - entry.wearout;
  if (consumedPercent <= 0) return null;
  const estimatedTotalYears = (yearsInService * 100) / consumedPercent;
  const remainingYears = estimatedTotalYears - yearsInService;
  if (!Number.isFinite(remainingYears) || remainingYears <= 0) return 0;
  return remainingYears;
}

function findTemperatureCandidate(value: unknown, depth = 0): number | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= -40 && value <= 130) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTemperatureCandidate(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/temp|temperature/i.test(key)) {
        const found = findTemperatureCandidate(nested, depth + 1);
        if (found !== null) return found;
      }
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findTemperatureCandidate(nested, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

async function fetchNodeHealth(
  snapshot: Awaited<ReturnType<typeof getDashboardSnapshot>>,
  hardwareSnapshot: HardwareSnapshot | null,
) {
  const rows = await Promise.all(
    snapshot.nodes.map(async (node) => {
      let temperatureC: number | null = null;
      let temperatureSource: string | null = null;
      const candidates = [
        { path: `nodes/${encodeURIComponent(node.name)}/hardware/sensors`, label: "hardware/sensors" },
        { path: `nodes/${encodeURIComponent(node.name)}/sensors`, label: "sensors" },
        { path: `nodes/${encodeURIComponent(node.name)}/status`, label: "status" },
      ];

      for (const candidate of candidates) {
        try {
          const payload = await proxmoxRequest<unknown>(candidate.path);
          const found = findTemperatureCandidate(payload);
          if (found !== null) {
            temperatureC = found;
            temperatureSource = candidate.label;
            break;
          }
        } catch {
          // Ignore missing endpoints; keep probing.
        }
      }

      const matchedHardwareSnapshot = hardwareMatchesNode(hardwareSnapshot, node.name) ? hardwareSnapshot : null;
      if (matchedHardwareSnapshot && matchedHardwareSnapshot.summary.maxTemperatureC !== null) {
        temperatureC = matchedHardwareSnapshot.summary.maxTemperatureC;
        temperatureSource = `BMC/iLO${matchedHardwareSnapshot.label ? ` • ${matchedHardwareSnapshot.label}` : ""}`;
      }

      return {
        node: node.name,
        cpuLoad: node.cpuLoad,
        memoryRatio: node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0,
        temperatureC,
        temperatureSource,
      } satisfies NodeHealthRow;
    }),
  );

  return rows.sort((left, right) => left.node.localeCompare(right.node));
}

function healthStateFromRatio(value: number) {
  if (value >= 0.95) return "critical";
  if (value >= 0.85) return "warning";
  return "ok";
}

function healthStateFromTemperature(value: number | null) {
  if (value === null) return "unknown";
  if (value >= 85) return "critical";
  if (value >= 75) return "warning";
  return "ok";
}

async function fetchDiskHealth(nodeNames: string[]) {
  const perNode = await Promise.all(
    nodeNames.map(async (node) => {
      try {
        const payload = await proxmoxRequest<Array<Record<string, unknown>>>(
          `nodes/${encodeURIComponent(node)}/disks/list`,
        );
        return payload.map((item) => {
          const model = asString(item.model) ?? asString(item.vendor);
          const devpath = asString(item.devpath) ?? asString(item.name) ?? "disk";
          const serial = asString(item.serial);
          const smartRaw = asString(item.smart_status);
          const health = smartRaw ?? asString(item.health);
          const wearout =
            asNumberOrNull(item.wearout) ??
            asNumberOrNull(item.wear_leveling_count) ??
            asNumberOrNull(item.used_percent);
          const temperatureC =
            asNumberOrNull(item.temperature) ??
            asNumberOrNull(item.smart_temperature) ??
            asNumberOrNull(item.temperature_celsius);
          const powerOnHours =
            asNumberOrNull(item.poweronhours) ??
            asNumberOrNull(item.power_on_hours) ??
            asNumberOrNull(item.hours);
          const sizeBytes = asNumberOrNull(item.size);
          return {
            id: `${node}:${devpath}:${serial ?? "na"}`,
            node,
            devpath,
            model,
            serial,
            sizeBytes,
            health,
            wearout,
            temperatureC,
            powerOnHours,
          } satisfies DiskHealthRow;
        });
      } catch {
        return [] as DiskHealthRow[];
      }
    }),
  );

  return perNode
    .flat()
    .sort((left, right) => left.node.localeCompare(right.node) || left.devpath.localeCompare(right.devpath));
}

function recommendationHref(rec: { id: string; category: "security" | "greenit" }) {
  if (rec.category === "security") {
    if (rec.id.includes("auth")) return "/security?tab=users";
    if (rec.id.includes("tls") || rec.id.includes("proxmox")) return "/settings?tab=proxmox";
    return "/security";
  }
  return "/observability?tab=greenit";
}

export default async function ObservabilityPage({ searchParams }: ObservabilityPageProps) {
  const params = await readSearchParams(searchParams);
  const activeTab = TABS.some((tab) => tab.id === readString(params.tab))
    ? (readString(params.tab) as (typeof TABS)[number]["id"])
    : "overview";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const security = buildSecurityAdvisor(snapshot);
  const greenitSettings = readRuntimeGreenItConfig();
  const greenit = buildGreenItAdvisor(snapshot, greenitSettings);
  const hardwareMonitorConfig = readRuntimeHardwareMonitorConfig();
  const warningCount = snapshot.warnings.length;
  const avgCpu =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => sum + node.cpuLoad, 0) / snapshot.nodes.length
      : 0;
  const avgMem =
    snapshot.nodes.length > 0
      ? snapshot.nodes.reduce((sum, node) => {
          const ratio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
          return sum + ratio;
        }, 0) / snapshot.nodes.length
      : 0;

  const hardwareSnapshot =
    hardwareMonitorConfig?.enabled && (activeTab === "overview" || activeTab === "health" || activeTab === "greenit")
      ? await fetchHardwareSnapshot(hardwareMonitorConfig).catch(() => null)
      : null;
  const diskHealth =
    hasLiveData && (activeTab === "overview" || activeTab === "health")
      ? await fetchDiskHealth(snapshot.nodes.map((node) => node.name))
      : [];
  const nodeHealth =
    hasLiveData && (activeTab === "overview" || activeTab === "health")
      ? await fetchNodeHealth(snapshot, hardwareSnapshot)
      : [];
  const diskCritical = diskHealth.filter((entry) => inferDiskSeverity(entry) === "critical").length;
  const diskWarning = diskHealth.filter((entry) => inferDiskSeverity(entry) === "warning").length;
  const diskUnknown = diskHealth.filter((entry) => inferDiskSeverity(entry) === "unknown").length;
  const cpuCritical = nodeHealth.filter((entry) => healthStateFromRatio(entry.cpuLoad) === "critical").length;
  const cpuWarning = nodeHealth.filter((entry) => healthStateFromRatio(entry.cpuLoad) === "warning").length;
  const ramCritical = nodeHealth.filter((entry) => healthStateFromRatio(entry.memoryRatio) === "critical").length;
  const ramWarning = nodeHealth.filter((entry) => healthStateFromRatio(entry.memoryRatio) === "warning").length;
  const thermalCritical = nodeHealth.filter((entry) => healthStateFromTemperature(entry.temperatureC) === "critical").length;
  const thermalWarning = nodeHealth.filter((entry) => healthStateFromTemperature(entry.temperatureC) === "warning").length;
  const hourlyKwh = Number((greenit.metrics.annualKwh / 8760).toFixed(3));
  const dailyKwh = Number((greenit.metrics.annualKwh / 365).toFixed(2));
  const monthlyKwh = Number((greenit.metrics.annualKwh / 12).toFixed(1));
  const hourlyCost = Number((greenit.metrics.annualCost / 8760).toFixed(3));
  const dailyCost = Number((greenit.metrics.annualCost / 365).toFixed(2));
  const monthlyCost = Number((greenit.metrics.annualCost / 12).toFixed(2));
  const dailyCo2 = Number((greenit.metrics.annualCo2Kg / 365).toFixed(2));
  const representativeServerTemp =
    hardwareSnapshot?.summary.maxTemperatureC ??
    nodeHealth.find((entry) => entry.temperatureC !== null)?.temperatureC ??
    greenitSettings?.serverTemperatureC ??
    null;
  const outsideTemp = greenitSettings?.outsideTemperatureC ?? null;
  const thermalDelta =
    representativeServerTemp !== null && outsideTemp !== null
      ? representativeServerTemp - outsideTemp
      : null;

  const topRecommendations = [...security.recommendations, ...greenit.recommendations].slice(0, 8);
  const priorityRecommendations = topRecommendations.slice(0, 4);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Observabilité</p>
          <h1>Santé, GreenIT et recommandations</h1>
          <p className="muted">Vue globale du cluster, sondes nœuds et impact énergétique, sans noyer la page principale.</p>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Live</span> : <span className="pill">Hors ligne</span>}
          <InventoryRefreshButton auto intervalMs={12000} />
        </div>
      </header>

      <section className="panel">
        <div className="hub-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={`/observability?tab=${encodeURIComponent(tab.id)}`}
              className={`hub-tab${activeTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-tile">
          <div className="stat-label">Nœuds</div>
          <div className="stat-value">{snapshot.summary.nodes}</div>
          <div className="stat-subtle">Cluster</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">CPU moyen</div>
          <div className="stat-value">{hasLiveData ? formatPercent(avgCpu) : "—"}</div>
          <div className="stat-subtle">Tous nœuds</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">RAM moyenne</div>
          <div className="stat-value">{hasLiveData ? formatPercent(avgMem) : "—"}</div>
          <div className="stat-subtle">Tous nœuds</div>
        </article>
        <article className="stat-tile">
          <div className="stat-label">Alertes brutes</div>
          <div className="stat-value">{warningCount}</div>
          <div className="stat-subtle">API/connexion</div>
        </article>
      </section>

      {activeTab === "overview" ? (
        <>
        <section className="content-grid observability-overview-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Résumé santé</h2>
              <span className="muted">Lecture rapide</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>CPU critique / warning</span>
                <strong>{cpuCritical} / {cpuWarning}</strong>
              </div>
              <div className="row-line">
                <span>RAM critique / warning</span>
                <strong>{ramCritical} / {ramWarning}</strong>
              </div>
              <div className="row-line">
                <span>Disques critique / warning / inconnus</span>
                <strong>{diskCritical} / {diskWarning} / {diskUnknown}</strong>
              </div>
              <div className="row-line">
                <span>Sondes thermiques critique / warning</span>
                <strong>{thermalCritical} / {thermalWarning}</strong>
              </div>
              <div className="row-line">
                <span>BMC / iLO</span>
                <strong>
                  {hardwareSnapshot
                    ? `${hardwareSnapshot.model ?? hardwareSnapshot.managerModel ?? hardwareSnapshot.host}`
                    : hardwareMonitorConfig?.enabled
                      ? "Erreur de collecte"
                      : "Non configuré"}
                </strong>
              </div>
            </div>
            <div className="quick-actions">
              <Link href="/observability?tab=health" className="action-btn">
                Ouvrir le détail santé
              </Link>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Contexte GreenIT</h2>
              <span className="muted">{greenitSettings?.outsideCity ?? "Local"}</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Température serveur</span>
                <strong>{representativeServerTemp !== null ? `${representativeServerTemp.toFixed(1)}°C` : "Non remontée"}</strong>
              </div>
              <div className="row-line">
                <span>Température extérieure</span>
                <strong>{outsideTemp !== null ? `${outsideTemp.toFixed(1)}°C` : "Non renseignée"}</strong>
              </div>
              <div className="row-line">
                <span>Delta thermique</span>
                <strong>{thermalDelta !== null ? `${thermalDelta > 0 ? "+" : ""}${thermalDelta.toFixed(1)}°C` : "Indisponible"}</strong>
              </div>
              <div className="row-line">
                <span>Puissance effective</span>
                <strong>{greenit.metrics.effectivePowerWatts} W</strong>
              </div>
            </div>
            <div className="quick-actions">
              <Link href="/observability?tab=greenit" className="action-btn">
                Ouvrir GreenIT
              </Link>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Priorités</h2>
              <span className="muted">{priorityRecommendations.length}</span>
            </div>
            {priorityRecommendations.length === 0 ? (
              <p className="muted">Aucune recommandation active.</p>
            ) : (
              <div className="mini-list">
                {priorityRecommendations.map((rec) => (
                  <Link key={rec.id} href={recommendationHref(rec)} className="mini-list-item mini-list-link">
                    <div>
                      <div className="item-title">{rec.title}</div>
                      <div className="item-subtitle">{rec.action}</div>
                    </div>
                    <div className="item-metric">{rec.severity}</div>
                  </Link>
                ))}
              </div>
            )}
            <div className="stack-sm">
              <div className="row-line">
                <span>Score sécurité</span>
                <strong>{security.score}/100</strong>
              </div>
              <div className="row-line">
                <span>Score GreenIT</span>
                <strong>{greenit.score}/100</strong>
              </div>
            </div>
            <div className="quick-actions">
              <Link href="/settings?tab=greenit" className="action-btn">
                Ouvrir les réglages
              </Link>
            </div>
          </section>
        </section>
        </>
      ) : null}

      {activeTab === "health" ? (
        <>
        <section className="content-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Santé nœuds</h2>
              <span className="muted">{snapshot.nodes.length}</span>
            </div>
            {snapshot.nodes.length === 0 ? (
              <p className="muted">Aucun nœud remonté.</p>
            ) : (
              <div className="mini-list">
                {snapshot.nodes.map((node) => {
                  const memRatio = node.memoryTotal > 0 ? node.memoryUsed / node.memoryTotal : 0;
                  return (
                    <article key={node.name} className="mini-list-item">
                      <div>
                        <div className="item-title">{node.name}</div>
                        <div className="item-subtitle">
                          CPU {formatPercent(node.cpuLoad)} • RAM {formatBytes(node.memoryUsed)} / {formatBytes(node.memoryTotal)}
                        </div>
                      </div>
                      <span className={`inventory-badge status-${node.status === "online" ? "running" : "stopped"}`}>
                        {node.status}
                      </span>
                      <div className="inventory-progress inventory-progress-wide">
                        <span className="tone-green" style={{ width: `${Math.round(node.cpuLoad * 100)}%` }} />
                      </div>
                      <div className="inventory-progress inventory-progress-wide">
                        <span className="tone-orange" style={{ width: `${Math.round(memRatio * 100)}%` }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>État disques</h2>
              <span className="muted">{diskHealth.length}</span>
            </div>
            <div className="row-line">
              <span>Critiques / Warning / Inconnus</span>
              <strong>
                {diskCritical} / {diskWarning} / {diskUnknown}
              </strong>
            </div>
            {diskHealth.length === 0 ? (
              <p className="muted">Aucune métrique disque SMART remontée.</p>
            ) : (
              <div className="mini-list">
                {diskHealth.slice(0, 14).map((disk) => {
                  const severity = inferDiskSeverity(disk);
                  const remainingYears = estimateRemainingLifeYears(disk);
                  return (
                    <article key={disk.id} className="mini-list-item">
                      <div>
                        <div className="item-title">
                          {disk.node} • {disk.devpath}
                        </div>
                        <div className="item-subtitle">
                          {[disk.model, disk.serial, disk.sizeBytes ? formatBytes(disk.sizeBytes) : null]
                            .filter(Boolean)
                            .join(" • ")}
                        </div>
                      </div>
                      <div className="item-metric">
                        <span className={`inventory-badge ${severity === "critical" ? "status-stopped" : severity === "warning" ? "status-pending" : "status-running"}`}>
                          {normalizeHealthLabel(disk.health)}
                        </span>
                        <div className="item-subtitle">
                          {disk.wearout !== null ? `Wearout ${disk.wearout}%` : "Wearout —"}
                          {disk.temperatureC !== null ? ` • ${Math.round(disk.temperatureC)}°C` : ""}
                        </div>
                        <div className="item-subtitle">
                          {disk.powerOnHours !== null ? `${Math.round(disk.powerOnHours)}h` : "Heures —"}
                          {remainingYears !== null ? ` • fin de vie estimée ${remainingYears.toFixed(1)} an(s)` : ""}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>CPU, RAM et sondes</h2>
            <span className="muted">{nodeHealth.length} nœud(x)</span>
          </div>
          <div className="row-line">
            <span>CPU critique / warning</span>
            <strong>{cpuCritical} / {cpuWarning}</strong>
          </div>
          <div className="row-line">
            <span>RAM critique / warning</span>
            <strong>{ramCritical} / {ramWarning}</strong>
          </div>
          <div className="row-line">
            <span>Sondes thermiques critique / warning</span>
            <strong>{thermalCritical} / {thermalWarning}</strong>
          </div>
          {nodeHealth.length === 0 ? (
            <p className="muted">Aucune télémétrie nœud disponible.</p>
          ) : (
            <div className="mini-list">
              {nodeHealth.map((entry) => {
                const cpuState = healthStateFromRatio(entry.cpuLoad);
                const ramState = healthStateFromRatio(entry.memoryRatio);
                const thermalState = healthStateFromTemperature(entry.temperatureC);
                return (
                  <article key={entry.node} className="mini-list-item">
                    <div>
                      <div className="item-title">{entry.node}</div>
                      <div className="item-subtitle">
                        CPU {formatPercent(entry.cpuLoad)} • RAM {formatPercent(entry.memoryRatio)}
                        {entry.temperatureC !== null ? ` • ${Math.round(entry.temperatureC)}°C` : " • Température non remontée"}
                      </div>
                      {entry.temperatureSource ? (
                        <div className="item-subtitle">Sonde: {entry.temperatureSource}</div>
                      ) : null}
                    </div>
                    <div className="backup-target-meta">
                      <span className={`inventory-tag ${cpuState === "critical" ? "status-bad" : ""}`}>CPU {cpuState}</span>
                      <span className={`inventory-tag ${ramState === "critical" ? "status-bad" : ""}`}>RAM {ramState}</span>
                      <span className={`inventory-tag ${thermalState === "critical" ? "status-bad" : ""}`}>
                        Temp {thermalState}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Matériel serveur</h2>
            <span className="muted">
              {hardwareSnapshot
                ? hardwareSnapshot.label ?? hardwareSnapshot.host
                : hardwareMonitorConfig?.enabled
                  ? "BMC/iLO configuré"
                  : "BMC/iLO non configuré"}
            </span>
          </div>
          {hardwareSnapshot ? (
            <>
              <div className="stack-sm">
                <div className="row-line">
                  <span>Plateforme</span>
                  <strong>
                    {[hardwareSnapshot.manufacturer, hardwareSnapshot.model].filter(Boolean).join(" ") || "—"}
                  </strong>
                </div>
                <div className="row-line">
                  <span>Série / puissance</span>
                  <strong>
                    {[hardwareSnapshot.serial, hardwareSnapshot.powerState].filter(Boolean).join(" • ") || "—"}
                  </strong>
                </div>
                <div className="row-line">
                  <span>Santé globale</span>
                  <strong>{formatHealthState(hardwareSnapshot.systemHealth)}</strong>
                </div>
                <div className="row-line">
                  <span>Température max / moyenne</span>
                  <strong>
                    {hardwareSnapshot.summary.maxTemperatureC !== null
                      ? `${hardwareSnapshot.summary.maxTemperatureC.toFixed(1)}°C`
                      : "—"}
                    {hardwareSnapshot.summary.averageTemperatureC !== null
                      ? ` • ${hardwareSnapshot.summary.averageTemperatureC.toFixed(1)}°C`
                      : ""}
                  </strong>
                </div>
                <div className="row-line">
                  <span>CPU warning / critiques</span>
                  <strong>
                    {hardwareSnapshot.summary.processorWarning} / {hardwareSnapshot.summary.processorCritical}
                  </strong>
                </div>
                <div className="row-line">
                  <span>RAM warning / critiques</span>
                  <strong>
                    {hardwareSnapshot.summary.memoryWarning} / {hardwareSnapshot.summary.memoryCritical}
                  </strong>
                </div>
                <div className="row-line">
                  <span>Disques warning / critiques</span>
                  <strong>
                    {hardwareSnapshot.summary.driveWarning} / {hardwareSnapshot.summary.driveCritical}
                  </strong>
                </div>
              </div>

              <div className="mini-list">
                {hardwareSnapshot.processors.slice(0, 8).map((processor) => (
                  <article key={processor.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{processor.name}</div>
                      <div className="item-subtitle">
                        {[processor.model, processor.totalCores !== null ? `${processor.totalCores} cœurs` : null]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <div className="item-metric">
                      <span className={`inventory-badge ${processor.health === "critical" ? "status-stopped" : processor.health === "warning" ? "status-pending" : "status-running"}`}>
                        {formatHealthState(processor.health)}
                      </span>
                      {processor.temperatureC !== null ? (
                        <div className="item-subtitle">{processor.temperatureC.toFixed(1)}°C</div>
                      ) : null}
                    </div>
                  </article>
                ))}

                {hardwareSnapshot.memoryModules.slice(0, 8).map((module) => (
                  <article key={module.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{module.name}</div>
                      <div className="item-subtitle">
                        {[module.manufacturer, module.partNumber, module.capacityBytes ? formatBytes(module.capacityBytes) : null]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <div className="item-metric">
                      <span className={`inventory-badge ${module.health === "critical" ? "status-stopped" : module.health === "warning" ? "status-pending" : "status-running"}`}>
                        {formatHealthState(module.health)}
                      </span>
                    </div>
                  </article>
                ))}

                {hardwareSnapshot.drives.slice(0, 10).map((drive) => (
                  <article key={drive.id} className="mini-list-item">
                    <div>
                      <div className="item-title">{drive.name}</div>
                      <div className="item-subtitle">
                        {[drive.model, drive.serial, drive.capacityBytes ? formatBytes(drive.capacityBytes) : null]
                          .filter(Boolean)
                          .join(" • ")}
                      </div>
                    </div>
                    <div className="item-metric">
                      <span className={`inventory-badge ${drive.health === "critical" || drive.predictedFailure ? "status-stopped" : drive.health === "warning" ? "status-pending" : "status-running"}`}>
                        {formatHealthState(drive.health)}
                      </span>
                      <div className="item-subtitle">
                        {drive.temperatureC !== null ? `${drive.temperatureC.toFixed(1)}°C` : "Temp —"}
                        {drive.predictedFailure ? " • prédiction panne" : ""}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="stack-sm">
              <p className="muted">
                {hardwareMonitorConfig?.enabled
                  ? "Le BMC/iLO est configuré mais aucune métrique n’a pu être lue depuis Redfish."
                  : "Configure un endpoint BMC/iLO Redfish dans Paramètres pour récupérer température, CPU, RAM et disques du serveur physique."}
              </p>
              <div className="quick-actions">
                <Link href="/settings?tab=proxmox" className="action-btn">
                  Ouvrir Paramètres
                </Link>
              </div>
            </div>
          )}
        </section>
        </>
      ) : null}

      {activeTab === "greenit" ? (
        <section className="content-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Calcul GreenIT</h2>
              <span className="muted">Mesure estimée</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Puissance IT estimée</span>
                <strong>{greenit.metrics.estimatedPowerWatts} W</strong>
              </div>
              <div className="row-line">
                <span>Puissance effective (PUE)</span>
                <strong>{greenit.metrics.effectivePowerWatts} W</strong>
              </div>
              <div className="row-line">
                <span>Conso annuelle</span>
                <strong>{greenit.metrics.annualKwh} kWh</strong>
              </div>
              <div className="row-line">
                <span>CO2 annuel</span>
                <strong>{greenit.metrics.annualCo2Kg} kg</strong>
              </div>
              <div className="row-line">
                <span>Coût annuel</span>
                <strong>{greenit.metrics.annualCost} €</strong>
              </div>
              <div className="row-line">
                <span>Conso actuelle</span>
                <strong>{hourlyKwh} kWh/h • {dailyKwh} kWh/j • {monthlyKwh} kWh/mois</strong>
              </div>
              <div className="row-line">
                <span>Coût actuel</span>
                <strong>{hourlyCost} €/h • {dailyCost} €/j • {monthlyCost} €/mois</strong>
              </div>
              <div className="row-line">
                <span>CO2 actuel</span>
                <strong>{dailyCo2} kg/j</strong>
              </div>
            </div>
            <p className="muted">
              Lecture rapide: consommation électrique et impact CO2 sont calculés à partir de la charge
              CPU/RAM des nœuds, puis corrigés par le PUE.
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Thermique & environnement</h2>
              <span className="muted">{greenitSettings?.outsideCity ?? "Local"}</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Température serveur</span>
                <strong>{representativeServerTemp !== null ? `${representativeServerTemp.toFixed(1)}°C` : "Non remontée"}</strong>
              </div>
              <div className="row-line">
                <span>Température extérieure</span>
                <strong>{outsideTemp !== null ? `${outsideTemp.toFixed(1)}°C` : "Non renseignée"}</strong>
              </div>
              <div className="row-line">
                <span>Ville extérieure</span>
                <strong>{greenitSettings?.outsideCity ?? "Non renseignée"}</strong>
              </div>
              <div className="row-line">
                <span>Delta thermique</span>
                <strong>{thermalDelta !== null ? `${thermalDelta > 0 ? "+" : ""}${thermalDelta.toFixed(1)}°C` : "Indisponible"}</strong>
              </div>
            </div>
            <p className="muted">
              La température serveur utilise d’abord une sonde nœud si Proxmox la remonte, sinon la valeur calibrée.
            </p>
          </section>

        </section>
      ) : null}

      {activeTab === "greenit" ? (
        greenitSettings ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Réglages GreenIT</h2>
              <span className="muted">Calibration déjà enregistrée</span>
            </div>
            <p className="muted">
              La calibration initiale est déjà faite. Pour modifier la puissance locale, le PUE, la ville extérieure
              ou les facteurs GreenIT, passe par Paramètres.
            </p>
            <div className="quick-actions">
              <Link href="/settings?tab=greenit" className="action-btn primary">
                Ouvrir Paramètres GreenIT
              </Link>
            </div>
          </section>
        ) : (
          <GreenItCalibrationPanel
            defaults={{
              estimatedPowerWatts: greenit.metrics.estimatedPowerWatts,
              pue: greenit.config.pue,
              co2FactorKgPerKwh: greenit.config.co2FactorKgPerKwh,
              electricityPricePerKwh: greenit.config.electricityPricePerKwh,
            }}
            initialSettings={greenitSettings}
          />
        )
      ) : null}

    </section>
  );
}
