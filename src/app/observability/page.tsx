import { cookies } from "next/headers";
import Link from "next/link";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import GreenItCalibrationPanel from "@/components/greenit-calibration-panel";
import GreenItHistoryExplorer from "@/components/greenit-history-explorer";
import HardwareMonitorStatusPanel from "@/components/hardware-monitor-status-panel";
import ObservabilityHistoryExplorer from "@/components/observability-history-explorer";
import ObservabilityTrendPanel from "@/components/observability-trend-panel";
import PlatformStateAlerts from "@/components/platform-state-alerts";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { resolveGreenItElectricityPricing } from "@/lib/greenit/edf-tariff";
import { readGreenItHistorySummary } from "@/lib/greenit/history";
import { fetchHardwareSnapshot, type HardwareSnapshot, type HardwareHealthState } from "@/lib/hardware/redfish";
import { readRuntimeHardwareMonitorConfig } from "@/lib/hardware/runtime-config";
import { readRuntimeHardwareSnapshotState } from "@/lib/hardware/runtime-snapshot";
import { buildGreenItAdvisor, buildSecurityAdvisor } from "@/lib/insights/advisor";
import { readRuntimeGreenItConfig } from "@/lib/greenit/runtime-config";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import {
  OBSERVABILITY_HISTORY_RANGES,
  readClusterObservabilityHistory,
} from "@/lib/proxmox/observability-history";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { formatBytes, formatPercent, formatRelativeTime } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

type ObservabilityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const TABS = [
  { id: "overview", label: "Vue" },
  { id: "health", label: "Santé" },
  { id: "greenit", label: "Énergie" },
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

function formatPowerMetric(value: number | null) {
  return value !== null ? `${Math.round(value)} W` : "—";
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
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const canRetestHardwareProbe = session?.role === "admin";

  const snapshot = await getDashboardSnapshot();
  const hasLiveData = snapshot.mode === "live";
  const historySeries = hasLiveData
    ? await readClusterObservabilityHistory(snapshot.nodes.map((node) => node.name), readString(params.range))
    : {
        range: OBSERVABILITY_HISTORY_RANGES[1],
        points: [],
        summary: null,
      };
  const security = buildSecurityAdvisor(snapshot);
  const greenitSettings = readRuntimeGreenItConfig();
  const electricityPricing = await resolveGreenItElectricityPricing(greenitSettings);
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

  const cachedHardwareState = readRuntimeHardwareSnapshotState();
  const hardwareSnapshot =
    cachedHardwareState.snapshot ??
    (hardwareMonitorConfig?.enabled && (activeTab === "overview" || activeTab === "health" || activeTab === "greenit")
      ? await fetchHardwareSnapshot(hardwareMonitorConfig).catch(() => null)
      : null);
  const livePowerWatts = hardwareSnapshot?.summary.powerAverageWatts ?? hardwareSnapshot?.summary.powerNowWatts ?? null;
  const livePowerSource =
    livePowerWatts !== null ? `Power meter ${hardwareSnapshot?.label ?? hardwareSnapshot?.host ?? "serveur"}` : null;
  const hardwareFreshnessLabel = cachedHardwareState.fetchedAt ? formatRelativeTime(cachedHardwareState.fetchedAt) : "jamais";
  const hardwareStatusLabel =
    !hardwareMonitorConfig?.enabled
      ? "Non configuré"
      : cachedHardwareState.status === "ok"
        ? `OK • ${hardwareFreshnessLabel}`
        : cachedHardwareState.status === "error"
          ? `Erreur • ${hardwareFreshnessLabel}`
          : "En attente";
  const greenit = buildGreenItAdvisor(snapshot, {
    ...(greenitSettings ?? {}),
    electricityPricePerKwh: electricityPricing.pricePerKwh,
    electricityBillingMode: greenitSettings?.electricityBillingMode ?? "energy-only",
    annualSubscriptionEur: electricityPricing.annualSubscriptionEur,
    liveMeasuredPowerWatts: livePowerWatts,
    liveMeasuredPowerSource: livePowerSource,
  });
  const greenitHistory = readGreenItHistorySummary();
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
    <section className="content content-wide">
      <header className="topbar">
        <div>
          <p className="eyebrow">Observabilité</p>
          <h1>Supervision, sonde serveur et énergie</h1>
          <p className="muted">CPU, RAM, IO, sonde matérielle et coût électrique au même endroit.</p>
        </div>
        <div className="topbar-meta">
          {hasLiveData ? <span className="pill live">Live</span> : <span className="pill">Hors ligne</span>}
          <InventoryRefreshButton auto intervalMs={5000} />
        </div>
      </header>

      <PlatformStateAlerts live={hasLiveData} warnings={snapshot.warnings} />

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

      {activeTab !== "greenit" ? (
        <section className="panel observability-trend-shell">
          <div className="panel-head">
            <h2>Supervision cluster</h2>
            <span className="muted">Fenêtre active: {historySeries.range.label}</span>
          </div>
          <div className="hub-tabs observability-range-tabs">
            {OBSERVABILITY_HISTORY_RANGES.map((range) => (
              <Link
                key={range.id}
                href={`/observability?tab=${encodeURIComponent(activeTab)}&range=${encodeURIComponent(range.id)}`}
                className={`hub-tab${historySeries.range.id === range.id ? " is-active" : ""}`}
              >
                {range.label}
              </Link>
            ))}
          </div>
          <div className="content-grid observability-trend-grid">
            <ObservabilityTrendPanel
              title="CPU cluster"
              subtitle="Charge agrégée"
              points={historySeries.points.map((point) => ({ timestamp: point.timestamp, value: point.cpuRatio }))}
              mode="percent"
              toneClass="tone-blue"
            />
            <ObservabilityTrendPanel
              title="RAM cluster"
              subtitle="Mémoire utilisée"
              points={historySeries.points.map((point) => ({ timestamp: point.timestamp, value: point.memoryRatio }))}
              mode="percent"
              toneClass="tone-orange"
            />
            <ObservabilityTrendPanel
              title="Réseau"
              subtitle="Trafic total in + out"
              points={historySeries.points.map((point) => ({
                timestamp: point.timestamp,
                value: point.networkBytesPerSecond,
              }))}
              mode="network"
              toneClass="tone-green"
            />
            <ObservabilityTrendPanel
              title="Disque système"
              subtitle="Occupation rootfs"
              points={historySeries.points.map((point) => ({ timestamp: point.timestamp, value: point.diskRatio }))}
              mode="percent"
              toneClass="tone-purple"
            />
            <ObservabilityTrendPanel
              title="IO wait"
              subtitle="Attente disque"
              points={historySeries.points.map((point) => ({ timestamp: point.timestamp, value: point.ioWaitRatio }))}
              mode="percent"
              toneClass="tone-red"
            />
          </div>
          <ObservabilityHistoryExplorer points={historySeries.points} rangeLabel={historySeries.range.label} />
        </section>
      ) : null}

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
              <div className="row-line">
                <span>Statut sonde</span>
                <strong>{hardwareStatusLabel}</strong>
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
              <h2>Rapport énergétique</h2>
              <span className="muted">{greenit.metrics.powerSourceLabel}</span>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Source puissance</span>
                <strong>{greenit.metrics.powerSourceLabel}</strong>
              </div>
              <div className="row-line">
                <span>Puissance IT</span>
                <strong>{greenit.metrics.estimatedPowerWatts} W</strong>
              </div>
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
                <span>Puissance effective (PUE)</span>
                <strong>{greenit.metrics.effectivePowerWatts} W</strong>
              </div>
            </div>
            <div className="quick-actions">
              <Link href="/observability?tab=greenit" className="action-btn">
                Ouvrir le rapport énergétique
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
              <div className="advisor-kpi-grid hardware-kpi-grid">
                <article className="advisor-kpi-card">
                  <span className="stat-label">Puissance live</span>
                  <strong>{formatPowerMetric(hardwareSnapshot.summary.powerNowWatts)}</strong>
                </article>
                <article className="advisor-kpi-card">
                  <span className="stat-label">Puissance moy.</span>
                  <strong>{formatPowerMetric(hardwareSnapshot.summary.powerAverageWatts)}</strong>
                </article>
                <article className="advisor-kpi-card">
                  <span className="stat-label">CPU power</span>
                  <strong>{formatPowerMetric(hardwareSnapshot.summary.cpuPowerWatts)}</strong>
                </article>
                <article className="advisor-kpi-card">
                  <span className="stat-label">DIMM power</span>
                  <strong>{formatPowerMetric(hardwareSnapshot.summary.memoryPowerWatts)}</strong>
                </article>
              </div>

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
                  <span>Power meter</span>
                  <strong>
                    {formatPowerMetric(hardwareSnapshot.summary.powerAverageWatts)}
                    {hardwareSnapshot.summary.powerPeakWatts !== null
                      ? ` • pic ${Math.round(hardwareSnapshot.summary.powerPeakWatts)} W`
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

              <HardwareMonitorStatusPanel
                configured={Boolean(hardwareMonitorConfig?.enabled)}
                canRetest={canRetestHardwareProbe}
                initialStatus={cachedHardwareState.status}
                initialFetchedAt={cachedHardwareState.fetchedAt}
                initialAttemptedAt={cachedHardwareState.attemptedAt}
                initialError={cachedHardwareState.error}
              />

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
              {hardwareMonitorConfig?.enabled ? (
                <p className="muted">Le BMC/iLO est configuré mais aucune métrique Redfish n’a pu être lue.</p>
              ) : (
                <div className="hint-box">
                  <div className="item-title">Activer la sonde serveur</div>
                  <div className="item-subtitle">
                    Paramètres → Proxmox → Sonde serveur
                  </div>
                  <div className="item-subtitle">
                    Renseigne l’hôte iLO/Redfish, un compte lecture seule, le mot de passe et le nœud associé.
                  </div>
                </div>
              )}
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
            <div className="greenit-hero">
              <div className="greenit-hero-left">
                <div>
                  <h2>Puissance & impact</h2>
                  <div className="muted">{greenit.metrics.powerSourceLabel}</div>
                </div>
              </div>
              <div className="greenit-hero-bars">
                <div className="greenit-inline-bar">
                  <span>Puissance IT</span>
                  <div className="inventory-progress inventory-progress-wide">
                    <span className="tone-green" style={{ width: `${Math.min(100, Math.max(8, Math.round((greenit.metrics.estimatedPowerWatts / Math.max(greenit.metrics.effectivePowerWatts, 1)) * 100)))}%` }} />
                  </div>
                  <strong>{greenit.metrics.estimatedPowerWatts} W</strong>
                </div>
                <div className="greenit-inline-bar">
                  <span>Puissance PUE</span>
                  <div className="inventory-progress inventory-progress-wide">
                    <span className="tone-orange" style={{ width: `${Math.min(100, Math.max(10, Math.round((greenit.metrics.effectivePowerWatts / Math.max(greenit.metrics.effectivePowerWatts, 1)) * 100)))}%` }} />
                  </div>
                  <strong>{greenit.metrics.effectivePowerWatts} W</strong>
                </div>
              </div>
            </div>

            <section className="advisor-kpi-grid">
              <article className="advisor-kpi-card">
                <span className="stat-label">
                  {greenit.metrics.powerSource === "metered"
                    ? "Puissance mesurée"
                    : greenit.metrics.powerSource === "manual"
                      ? "Puissance locale"
                      : "Puissance estimée"}
                </span>
                <strong>{greenit.metrics.estimatedPowerWatts} W</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Puissance effective</span>
                <strong>{greenit.metrics.effectivePowerWatts} W</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Conso annuelle</span>
                <strong>{greenit.metrics.annualKwh} kWh</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Coût annuel</span>
                <strong>{greenit.metrics.annualCost} €</strong>
              </article>
            </section>

            <div className="stack-sm">
              <div className="row-line">
                <span>Source puissance</span>
                <strong>{greenit.metrics.powerSourceLabel}</strong>
              </div>
              <div className="row-line">
                <span>Lecture actuelle</span>
                <strong>{hourlyKwh} kWh/h • {Math.round(greenit.metrics.effectivePowerWatts)} W</strong>
              </div>
              <div className="row-line">
                <span>CO2 annuel</span>
                <strong>{greenit.metrics.annualCo2Kg} kg</strong>
              </div>
              <div className="row-line">
                <span>Conso projetée</span>
                <strong>{dailyKwh} kWh/j • {monthlyKwh} kWh/mois</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Tarif & coût</h2>
              <span className="muted">{electricityPricing.mode === "edf-standard" ? "EDF standard auto" : "Tarif manuel"}</span>
            </div>
            <div className="advisor-kpi-grid hardware-kpi-grid">
              <article className="advisor-kpi-card">
                <span className="stat-label">Tarif actif</span>
                <strong>{electricityPricing.pricePerKwh.toFixed(4)} €/kWh</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Coût / jour</span>
                <strong>{dailyCost} €</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Coût / mois</span>
                <strong>{monthlyCost} €</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Coût / an</span>
                <strong>{greenit.metrics.annualCost} €</strong>
              </article>
            </div>
            <div className="stack-sm">
              <div className="row-line">
                <span>Mode coût</span>
                <strong>
                  {greenit.config.electricityBillingMode === "full-bill" ? "Facture complète" : "Énergie seule"}
                  {greenit.config.annualSubscriptionEur !== null
                    ? ` • abonnement ${greenit.config.annualSubscriptionEur.toFixed(2)} €/an`
                    : ""}
                </strong>
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
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Thermique & sonde</h2>
              <span className="muted">{greenitSettings?.outsideCity ?? "Local"}</span>
            </div>
            <div className="advisor-kpi-grid hardware-kpi-grid">
              <article className="advisor-kpi-card">
                <span className="stat-label">Temp serveur</span>
                <strong>{representativeServerTemp !== null ? `${representativeServerTemp.toFixed(1)}°C` : "—"}</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Extérieur</span>
                <strong>{outsideTemp !== null ? `${outsideTemp.toFixed(1)}°C` : "—"}</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Delta</span>
                <strong>{thermalDelta !== null ? `${thermalDelta > 0 ? "+" : ""}${thermalDelta.toFixed(1)}°C` : "—"}</strong>
              </article>
              <article className="advisor-kpi-card">
                <span className="stat-label">Ambiant power meter</span>
                <strong>{hardwareSnapshot?.summary.ambientTemperatureC !== null && hardwareSnapshot?.summary.ambientTemperatureC !== undefined ? `${hardwareSnapshot.summary.ambientTemperatureC.toFixed(1)}°C` : "—"}</strong>
              </article>
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
              <div className="row-line">
                <span>Sonde serveur</span>
                <strong>
                  {hardwareSnapshot
                    ? hardwareSnapshot.label ?? hardwareSnapshot.host
                    : hardwareMonitorConfig?.enabled
                      ? "Configurée mais non remontée"
                      : "À configurer dans Paramètres > Proxmox"}
                </strong>
              </div>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "greenit" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Projection mensuelle</h2>
            <span className="muted">{greenitHistory.days.length} archive(s) disponibles</span>
          </div>

          <div className="advisor-kpi-grid hardware-kpi-grid">
            <article className="advisor-kpi-card">
              <span className="stat-label">Mois en cours</span>
              <strong>{greenitHistory.currentMonth.totalKwh.toFixed(1)} kWh</strong>
              <small>{greenitHistory.currentMonth.totalCostEur.toFixed(2)} €</small>
            </article>
            <article className="advisor-kpi-card">
              <span className="stat-label">Projection fin de mois</span>
              <strong>{greenitHistory.currentMonth.projectedMonthKwh.toFixed(1)} kWh</strong>
              <small>{greenitHistory.currentMonth.projectedMonthCostEur.toFixed(2)} €</small>
            </article>
            <article className="advisor-kpi-card">
              <span className="stat-label">Jour moyen</span>
              <strong>{greenitHistory.currentMonth.averageDailyKwh.toFixed(2)} kWh</strong>
              <small>{greenitHistory.currentMonth.averageDailyCostEur.toFixed(2)} €/j</small>
            </article>
            <article className="advisor-kpi-card">
              <span className="stat-label">Mois précédent</span>
              <strong>{greenitHistory.previousMonth.totalKwh.toFixed(1)} kWh</strong>
              <small>{greenitHistory.previousMonth.totalCostEur.toFixed(2)} €</small>
            </article>
          </div>

          {greenitHistory.days.length === 0 ? (
            <p className="muted">L’historique journalier commencera à se remplir automatiquement avec les prochaines lectures GreenIT.</p>
          ) : null}
        </section>
      ) : null}

      {activeTab === "greenit" ? (
        <GreenItHistoryExplorer days={greenitHistory.days} updatedAt={greenitHistory.updatedAt} />
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
            pricing={{
              activePricePerKwh: electricityPricing.pricePerKwh,
              mode: electricityPricing.mode,
              sourceLabel: electricityPricing.sourceLabel,
              updatedAt: electricityPricing.fetchedAt,
              effectiveDate: electricityPricing.effectiveDate,
              stale: electricityPricing.stale,
              annualSubscriptionEur: electricityPricing.annualSubscriptionEur,
            }}
            initialSettings={greenitSettings}
          />
        )
      ) : null}

    </section>
  );
}
