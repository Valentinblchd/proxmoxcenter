import "server-only";
import { createHash } from "node:crypto";
import { Agent, type Dispatcher } from "undici";
import {
  collectTemperatureSensors,
  parseDrive,
  parseMemoryModule,
  parsePowerMetrics,
  parseProcessor,
  summarizeHardware,
  type HardwareDrive,
  type HardwareHealthState,
  type HardwareMemoryModule,
  type HardwarePowerMetrics,
  type HardwareSnapshot,
  type HardwareTemperatureSensor,
  type RedfishResource,
} from "@/lib/hardware/redfish-shared";
import {
  readRuntimeHardwareMonitorConfig,
  type RuntimeHardwareMonitorConfig,
} from "@/lib/hardware/runtime-config";

export type {
  HardwareDrive,
  HardwareHealthState,
  HardwareMemoryModule,
  HardwarePowerMetrics,
  HardwareProcessor,
  HardwareSnapshot,
  HardwareTemperatureSensor,
} from "@/lib/hardware/redfish-shared";

const REDFISH_CA_AGENTS = new Map<string, Agent>();
const REDFISH_INSECURE_AGENT = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});
const REDFISH_REQUEST_TIMEOUT_MS = 8_000;

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHealthState(raw: unknown): HardwareHealthState {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!text) return "unknown";
  if (["ok", "good", "enabled", "healthy", "normal"].includes(text)) return "ok";
  if (["warning", "degraded", "caution"].includes(text)) return "warning";
  if (["critical", "failed", "failure", "absent", "offline"].includes(text)) return "critical";
  return "unknown";
}

function extractStateText(value: unknown) {
  if (!isRecord(value)) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }
  const status = isRecord(value.Status) ? value.Status : null;
  const state =
    asString(status?.State) ??
    asString(value.State) ??
    asString(value.Status);
  return state ? state.trim().toLowerCase() : "";
}

function extractHealthState(value: unknown): HardwareHealthState {
  if (!isRecord(value)) return normalizeHealthState(value);
  const status = value.Status;
  if (isRecord(status)) {
    return normalizeHealthState(
      status.HealthRollup ?? status.Health ?? status.State ?? value.HealthRollup ?? value.Health ?? value.State,
    );
  }
  return normalizeHealthState(value.HealthRollup ?? value.Health ?? value.State);
}

function getOdataId(value: unknown) {
  if (!isRecord(value)) return null;
  return asString(value["@odata.id"]);
}

function getCollectionMemberIds(value: unknown) {
  if (!isRecord(value)) return [] as string[];
  const members = Array.isArray(value.Members) ? value.Members : [];
  return members
    .map((entry) => getOdataId(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function createRedfishDispatcher(config: RuntimeHardwareMonitorConfig): Dispatcher | undefined {
  if (config.protocol !== "https") return undefined;
  if (config.tlsMode === "insecure" || config.allowInsecureTls) {
    return REDFISH_INSECURE_AGENT;
  }
  if (config.tlsMode === "custom-ca" && config.customCaCertPem) {
    const key = createHash("sha256").update(config.customCaCertPem).digest("hex");
    const existing = REDFISH_CA_AGENTS.get(key);
    if (existing) return existing;

    const agent = new Agent({
      connect: {
        rejectUnauthorized: true,
        ca: config.customCaCertPem,
      },
    });
    REDFISH_CA_AGENTS.set(key, agent);
    return agent;
  }
  return undefined;
}

function buildRedfishUrl(config: RuntimeHardwareMonitorConfig, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return new URL(path);
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, `${config.baseUrl.replace(/\/+$/, "")}/`);
}

async function redfishRequest<T>(config: RuntimeHardwareMonitorConfig, path: string): Promise<T> {
  const auth = Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64");
  const dispatcher = createRedfishDispatcher(config);
  const response = await fetch(buildRedfishUrl(config, path), {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REDFISH_REQUEST_TIMEOUT_MS),
    ...(dispatcher ? ({ dispatcher } as RequestInit) : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Redfish HTTP ${response.status}`);
  }
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function readCollectionMembers(
  config: RuntimeHardwareMonitorConfig,
  collectionPath: string | null | undefined,
) {
  if (!collectionPath) return [] as RedfishResource[];
  try {
    const collection = await redfishRequest<RedfishResource>(config, collectionPath);
    const memberIds = getCollectionMemberIds(collection);
    const members = await Promise.all(
      memberIds.map(async (memberId) => {
        try {
          return await redfishRequest<RedfishResource>(config, memberId);
        } catch {
          return null;
        }
      }),
    );
    return members.filter((entry): entry is RedfishResource => Boolean(entry));
  } catch {
    return [] as RedfishResource[];
  }
}

function sumNullableNumbers(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function averageNullableNumbers(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function maxNullableNumbers(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}

function mergePowerMetrics(metrics: HardwarePowerMetrics[]): HardwarePowerMetrics | null {
  if (metrics.length === 0) return null;
  return {
    source: metrics.map((entry) => entry.source).join(" + "),
    currentWatts: sumNullableNumbers(metrics.map((entry) => entry.currentWatts)),
    averageWatts: sumNullableNumbers(metrics.map((entry) => entry.averageWatts)),
    minWatts: sumNullableNumbers(metrics.map((entry) => entry.minWatts)),
    maxWatts: sumNullableNumbers(metrics.map((entry) => entry.maxWatts)),
    cpuWatts: sumNullableNumbers(metrics.map((entry) => entry.cpuWatts)),
    memoryWatts: sumNullableNumbers(metrics.map((entry) => entry.memoryWatts)),
    gpuWatts: sumNullableNumbers(metrics.map((entry) => entry.gpuWatts)),
    ambientTemperatureC: averageNullableNumbers(metrics.map((entry) => entry.ambientTemperatureC)),
  };
}


export async function probeHardwareMonitor(config: RuntimeHardwareMonitorConfig) {
  const root = await redfishRequest<RedfishResource>(config, "/redfish/v1/");
  const systems = await readCollectionMembers(config, getOdataId(root.Systems) ?? "/redfish/v1/Systems");
  const managers = await readCollectionMembers(config, getOdataId(root.Managers) ?? "/redfish/v1/Managers");
  const system = systems[0] ?? null;
  const manager = managers[0] ?? null;

  return {
    ok: true as const,
    vendor: asString(system?.Manufacturer) ?? asString(manager?.Manufacturer) ?? null,
    model: asString(system?.Model) ?? null,
    serial: asString(system?.SerialNumber) ?? null,
    managerModel: asString(manager?.Model) ?? null,
    firmwareVersion: asString(manager?.FirmwareVersion) ?? null,
  };
}

async function resolveChassisIds(root: RedfishResource, system: RedfishResource | null) {
  const idsFromRootCollection = getCollectionMemberIds(
    await (async () => root)(),
  );
  const idsFromSystemLinks = isRecord(system?.Links) && Array.isArray(system?.Links.Chassis)
    ? system?.Links.Chassis.map((entry) => getOdataId(entry))
    : [];
  const rootChassisCollection = getOdataId(root.Chassis);
  return {
    rootChassisCollection,
    chassisIds: uniqueStrings(idsFromSystemLinks),
    rootInlineIds: uniqueStrings(idsFromRootCollection),
  };
}

async function loadChassisResources(config: RuntimeHardwareMonitorConfig, root: RedfishResource, system: RedfishResource | null) {
  const resolved = await resolveChassisIds(root, system);
  const collectionMembers =
    resolved.rootChassisCollection ? await readCollectionMembers(config, resolved.rootChassisCollection) : [];
  if (collectionMembers.length > 0) {
    return collectionMembers;
  }
  if (resolved.chassisIds.length > 0) {
    const directMembers = await Promise.all(
      resolved.chassisIds.map(async (id) => {
        try {
          return await redfishRequest<RedfishResource>(config, id);
        } catch {
          return null;
        }
      }),
    );
    return directMembers.filter((entry): entry is RedfishResource => Boolean(entry));
  }
  return [] as RedfishResource[];
}

async function loadTemperatureSensors(config: RuntimeHardwareMonitorConfig, root: RedfishResource, system: RedfishResource | null) {
  const chassis = await loadChassisResources(config, root, system);
  const sensors: HardwareTemperatureSensor[] = [];
  for (const resource of chassis) {
    const chassisId = asString(resource["@odata.id"]) ?? null;
    const thermalCandidates = uniqueStrings([
      getOdataId(resource.Thermal),
      chassisId ? `${chassisId.replace(/\/+$/, "")}/Thermal` : null,
      getOdataId(resource.ThermalSubsystem),
    ]);
    for (const candidate of thermalCandidates) {
      try {
        const payload = await redfishRequest<RedfishResource>(config, candidate);
        collectTemperatureSensors(payload, candidate, 0, sensors);
      } catch {
        // Continue probing other candidate endpoints.
      }
    }
  }

  const deduped = new Map<string, HardwareTemperatureSensor>();
  for (const sensor of sensors) {
    const key = `${sensor.source}:${sensor.name}:${sensor.readingC ?? "na"}`;
    if (!deduped.has(key)) deduped.set(key, sensor);
  }
  return [...deduped.values()];
}

async function loadPowerMetrics(
  config: RuntimeHardwareMonitorConfig,
  root: RedfishResource,
  system: RedfishResource | null,
) {
  const chassis = await loadChassisResources(config, root, system);
  const metrics: HardwarePowerMetrics[] = [];
  for (const resource of chassis) {
    const chassisId = asString(resource["@odata.id"]) ?? null;
    const powerCandidates = uniqueStrings([
      getOdataId(resource.Power),
      chassisId ? `${chassisId.replace(/\/+$/, "")}/Power` : null,
    ]);
    for (const candidate of powerCandidates) {
      try {
        const payload = await redfishRequest<RedfishResource>(config, candidate);
        const metric = parsePowerMetrics(payload, candidate);
        if (metric) {
          metrics.push(metric);
        }
      } catch {
        // Continue probing other candidate endpoints.
      }
    }
  }
  return mergePowerMetrics(metrics);
}

async function loadDrives(config: RuntimeHardwareMonitorConfig, system: RedfishResource | null) {
  const storagePath = getOdataId(system?.Storage);
  const storageMembers = await readCollectionMembers(config, storagePath);
  const driveLinks = uniqueStrings(
    storageMembers.flatMap((storage) => {
      const direct = Array.isArray(storage.Drives) ? storage.Drives.map((entry) => getOdataId(entry)) : [];
      return direct;
    }),
  );
  const drives = await Promise.all(
    driveLinks.map(async (driveLink) => {
      try {
        const resource = await redfishRequest<RedfishResource>(config, driveLink);
        return parseDrive(resource);
      } catch {
        return null;
      }
    }),
  );
  return drives.filter((entry): entry is HardwareDrive => Boolean(entry));
}

export async function fetchHardwareSnapshot(
  configInput?: RuntimeHardwareMonitorConfig | null,
): Promise<HardwareSnapshot | null> {
  const config = configInput ?? readRuntimeHardwareMonitorConfig();
  if (!config?.enabled) return null;

  const root = await redfishRequest<RedfishResource>(config, "/redfish/v1/");
  const systems = await readCollectionMembers(config, getOdataId(root.Systems) ?? "/redfish/v1/Systems");
  const managers = await readCollectionMembers(config, getOdataId(root.Managers) ?? "/redfish/v1/Managers");
  const system = systems[0] ?? null;
  const manager = managers[0] ?? null;
  const temperatures = await loadTemperatureSensors(config, root, system);
  const power = await loadPowerMetrics(config, root, system);
  const processors = (
    await readCollectionMembers(config, getOdataId(system?.Processors))
  ).map((resource) => parseProcessor(resource, temperatures));
  const memoryModules = (
    await readCollectionMembers(config, getOdataId(system?.Memory))
  )
    .map((resource) => parseMemoryModule(resource))
    .filter((resource): resource is HardwareMemoryModule => Boolean(resource));
  const drives = await loadDrives(config, system);

  const baseSnapshot = {
    source: "redfish" as const,
    fetchedAt: new Date().toISOString(),
    nodeName: config.nodeName,
    label: config.label,
    host: config.host,
    manufacturer: asString(system?.Manufacturer) ?? asString(manager?.Manufacturer) ?? null,
    model: asString(system?.Model) ?? null,
    serial: asString(system?.SerialNumber) ?? null,
    powerState: asString(system?.PowerState),
    systemHealth: extractHealthState(system ?? manager ?? root),
    managerModel: asString(manager?.Model) ?? null,
    managerFirmwareVersion: asString(manager?.FirmwareVersion) ?? null,
    temperatures,
    processors,
    memoryModules,
    drives,
    power,
  };

  return {
    ...baseSnapshot,
    summary: summarizeHardware(baseSnapshot),
  };
}
