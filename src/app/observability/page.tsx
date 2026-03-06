import Link from "next/link";
import InventoryRefreshButton from "@/components/inventory-refresh-button";
import GreenItCalibrationPanel from "@/components/greenit-calibration-panel";
import { buildGreenItAdvisor, buildSecurityAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { proxmoxRequest } from "@/lib/proxmox/client";
import { formatBytes, formatPercent, formatRelativeTime } from "@/lib/ui/format";

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
  const greenit = buildGreenItAdvisor(snapshot);
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

  const diskHealth =
    hasLiveData && (activeTab === "overview" || activeTab === "health")
      ? await fetchDiskHealth(snapshot.nodes.map((node) => node.name))
      : [];
  const diskCritical = diskHealth.filter((entry) => inferDiskSeverity(entry) === "critical").length;
  const diskWarning = diskHealth.filter((entry) => inferDiskSeverity(entry) === "warning").length;
  const diskUnknown = diskHealth.filter((entry) => inferDiskSeverity(entry) === "unknown").length;
  const hourlyKwh = Number((greenit.metrics.annualKwh / 8760).toFixed(3));
  const dailyKwh = Number((greenit.metrics.annualKwh / 365).toFixed(2));
  const monthlyKwh = Number((greenit.metrics.annualKwh / 12).toFixed(1));
  const hourlyCost = Number((greenit.metrics.annualCost / 8760).toFixed(3));
  const dailyCost = Number((greenit.metrics.annualCost / 365).toFixed(2));
  const monthlyCost = Number((greenit.metrics.annualCost / 12).toFixed(2));
  const dailyCo2 = Number((greenit.metrics.annualCo2Kg / 365).toFixed(2));

  const topRecommendations = [...security.recommendations, ...greenit.recommendations].slice(0, 8);

  return (
    <section className="content">
      <header className="topbar">
        <div>
          <p className="eyebrow">Observabilité</p>
          <h1>Santé, GreenIT et recommandations</h1>
        </div>
        <div className="topbar-meta">
          <InventoryRefreshButton auto intervalMs={5000} />
          {hasLiveData ? <span className="pill live">Live</span> : <span className="pill">Hors ligne</span>}
          <span className="muted">MàJ {formatRelativeTime(snapshot.lastUpdatedAt)}</span>
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

      {(activeTab === "overview" || activeTab === "health") ? (
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
      ) : null}

      {(activeTab === "overview" || activeTab === "greenit") ? (
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
              <h2>Hypothèses</h2>
              <span className="muted">Ajustables ci-dessous</span>
            </div>
            <div className="mini-list">
              <article className="mini-list-item">
                <div>
                  <div className="item-title">GREENIT_PUE</div>
                  <div className="item-subtitle">Facteur infra datacenter</div>
                </div>
                <div className="item-metric">{greenit.config.pue}</div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">GREENIT_CO2_FACTOR_KG_PER_KWH</div>
                  <div className="item-subtitle">Facteur carbone local</div>
                </div>
                <div className="item-metric">{greenit.config.co2FactorKgPerKwh}</div>
              </article>
              <article className="mini-list-item">
                <div>
                  <div className="item-title">GREENIT_ELECTRICITY_PRICE</div>
                  <div className="item-subtitle">Prix du kWh</div>
                </div>
                <div className="item-metric">{greenit.config.electricityPricePerKwh} €</div>
              </article>
            </div>
            <p className="muted">
              Formule: <code>(Puissance IT × PUE × 24 × 365) / 1000</code> puis conversion CO2 et coût.
            </p>
          </section>
        </section>
      ) : null}

      {(activeTab === "overview" || activeTab === "greenit") ? (
        <GreenItCalibrationPanel
          defaults={{
            estimatedPowerWatts: greenit.metrics.estimatedPowerWatts,
            pue: greenit.config.pue,
            co2FactorKgPerKwh: greenit.config.co2FactorKgPerKwh,
            electricityPricePerKwh: greenit.config.electricityPricePerKwh,
          }}
        />
      ) : null}

      {activeTab === "overview" ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Recommandations</h2>
            <span className="muted">{topRecommendations.length}</span>
          </div>
          <div className="mini-list">
            {topRecommendations.map((rec) => (
              <Link key={rec.id} href={recommendationHref(rec)} className="mini-list-item mini-list-link">
                <div>
                  <div className="item-title">{rec.title}</div>
                  <div className="item-subtitle">{rec.action}</div>
                </div>
                <div className="item-metric">{rec.severity}</div>
              </Link>
            ))}
          </div>
          <div className="row-line">
            <span>Score sécurité</span>
            <strong>{security.score}/100</strong>
          </div>
          <div className="row-line">
            <span>Score GreenIT</span>
            <strong>{greenit.score}/100</strong>
          </div>
        </section>
      ) : null}
    </section>
  );
}
