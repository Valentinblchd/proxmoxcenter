import "server-only";
import { createHash } from "node:crypto";
import { Agent, type Dispatcher } from "undici";
import {
  readRuntimeHardwareMonitorConfig,
  type RuntimeHardwareMonitorConfig,
} from "@/lib/hardware/runtime-config";

export type HardwareHealthState = "ok" | "warning" | "critical" | "unknown";

export type HardwareTemperatureSensor = {
  name: string;
  readingC: number | null;
  state: HardwareHealthState;
  source: string;
};

export type HardwareProcessor = {
  id: string;
  name: string;
  model: string | null;
  totalCores: number | null;
  health: HardwareHealthState;
  temperatureC: number | null;
};

export type HardwareMemoryModule = {
  id: string;
  name: string;
  capacityBytes: number | null;
  manufacturer: string | null;
  partNumber: string | null;
  health: HardwareHealthState;
};

export type HardwareDrive = {
  id: string;
  name: string;
  model: string | null;
  serial: string | null;
  capacityBytes: number | null;
  mediaType: string | null;
  health: HardwareHealthState;
  temperatureC: number | null;
  predictedFailure: boolean | null;
};

export type HardwareSnapshot = {
  source: "redfish";
  fetchedAt: string;
  nodeName: string | null;
  label: string | null;
  host: string;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  powerState: string | null;
  systemHealth: HardwareHealthState;
  managerModel: string | null;
  managerFirmwareVersion: string | null;
  temperatures: HardwareTemperatureSensor[];
  processors: HardwareProcessor[];
  memoryModules: HardwareMemoryModule[];
  drives: HardwareDrive[];
  summary: {
    maxTemperatureC: number | null;
    averageTemperatureC: number | null;
    processorCount: number;
    processorCritical: number;
    processorWarning: number;
    memoryModuleCount: number;
    memoryCritical: number;
    memoryWarning: number;
    driveCount: number;
    driveCritical: number;
    driveWarning: number;
  };
};

type RedfishResource = Record<string, unknown>;

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

function collectTemperatureSensors(
  value: unknown,
  source: string,
  depth = 0,
  sensors: HardwareTemperatureSensor[] = [],
) {
  if (depth > 6 || value === null || value === undefined) {
    return sensors;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTemperatureSensors(item, source, depth + 1, sensors);
    }
    return sensors;
  }
  if (!isRecord(value)) {
    return sensors;
  }

  const reading =
    asNumber(value.ReadingCelsius) ??
    asNumber(value.TemperatureCelsius) ??
    asNumber(value.CurrentReading) ??
    asNumber(value.Reading);

  if (reading !== null && reading >= -40 && reading <= 150) {
    sensors.push({
      name:
        asString(value.Name) ??
        asString(value.MemberId) ??
        asString(value.PhysicalContext) ??
        asString(value.Id) ??
        "Température",
      readingC: reading,
      state: extractHealthState(value),
      source,
    });
  }

  for (const nested of Object.values(value)) {
    collectTemperatureSensors(nested, source, depth + 1, sensors);
  }
  return sensors;
}

function pickProcessorTemperature(name: string, temperatures: HardwareTemperatureSensor[]) {
  const normalized = name.toLowerCase();
  const candidates = temperatures.filter((sensor) => {
    const label = sensor.name.toLowerCase();
    return (
      label.includes(normalized) ||
      (label.includes("cpu") && (normalized.includes("cpu") || normalized.includes("proc")))
    );
  });
  if (candidates.length === 0) return null;
  return Math.max(...candidates.map((sensor) => sensor.readingC ?? -Infinity).filter(Number.isFinite));
}

function parseProcessor(resource: RedfishResource, temperatures: HardwareTemperatureSensor[]): HardwareProcessor {
  const name = asString(resource.Name) ?? asString(resource.Id) ?? "CPU";
  return {
    id: asString(resource.Id) ?? name,
    name,
    model: asString(resource.Model),
    totalCores: asNumber(resource.TotalCores),
    health: extractHealthState(resource),
    temperatureC: pickProcessorTemperature(name, temperatures),
  };
}

function parseMemoryModule(resource: RedfishResource): HardwareMemoryModule {
  const capacityBytes =
    asNumber(resource.CapacityBytes) ??
    (asNumber(resource.CapacityMiB) !== null ? asNumber(resource.CapacityMiB)! * 1024 * 1024 : null);
  return {
    id: asString(resource.Id) ?? asString(resource.Name) ?? "memory",
    name: asString(resource.Name) ?? asString(resource.DeviceLocator) ?? asString(resource.Id) ?? "Mémoire",
    capacityBytes,
    manufacturer: asString(resource.Manufacturer),
    partNumber: asString(resource.PartNumber),
    health: extractHealthState(resource),
  };
}

function parseDrive(resource: RedfishResource): HardwareDrive {
  const predictedFailureRaw = resource.PredictedMediaLifeLeftPercent ?? resource.FailurePredicted;
  const predictedFailure =
    typeof predictedFailureRaw === "boolean"
      ? predictedFailureRaw
      : asNumber(predictedFailureRaw) !== null
        ? (asNumber(predictedFailureRaw) ?? 100) <= 10
        : null;
  return {
    id: asString(resource.Id) ?? asString(resource.Name) ?? "drive",
    name: asString(resource.Name) ?? asString(resource.Id) ?? "Disque",
    model: asString(resource.Model),
    serial: asString(resource.SerialNumber),
    capacityBytes:
      asNumber(resource.CapacityBytes) ??
      (asNumber(resource.CapacityMiB) !== null ? asNumber(resource.CapacityMiB)! * 1024 * 1024 : null),
    mediaType: asString(resource.MediaType) ?? asString(resource.Protocol),
    health: extractHealthState(resource),
    temperatureC:
      asNumber(resource.TemperatureCelsius) ??
      asNumber(resource.CurrentTemperatureCelsius) ??
      asNumber(resource.Temperature),
    predictedFailure,
  };
}

function summarizeHardware(snapshot: Omit<HardwareSnapshot, "summary">) {
  const temperatureValues = snapshot.temperatures
    .map((entry) => entry.readingC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageTemperatureC =
    temperatureValues.length > 0
      ? temperatureValues.reduce((sum, value) => sum + value, 0) / temperatureValues.length
      : null;

  return {
    maxTemperatureC: temperatureValues.length > 0 ? Math.max(...temperatureValues) : null,
    averageTemperatureC,
    processorCount: snapshot.processors.length,
    processorCritical: snapshot.processors.filter((entry) => entry.health === "critical").length,
    processorWarning: snapshot.processors.filter((entry) => entry.health === "warning").length,
    memoryModuleCount: snapshot.memoryModules.length,
    memoryCritical: snapshot.memoryModules.filter((entry) => entry.health === "critical").length,
    memoryWarning: snapshot.memoryModules.filter((entry) => entry.health === "warning").length,
    driveCount: snapshot.drives.length,
    driveCritical: snapshot.drives.filter(
      (entry) => entry.health === "critical" || entry.predictedFailure === true,
    ).length,
    driveWarning: snapshot.drives.filter(
      (entry) => entry.health === "warning" || entry.temperatureC !== null && entry.temperatureC >= 50,
    ).length,
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
  const processors = (
    await readCollectionMembers(config, getOdataId(system?.Processors))
  ).map((resource) => parseProcessor(resource, temperatures));
  const memoryModules = (
    await readCollectionMembers(config, getOdataId(system?.Memory))
  ).map((resource) => parseMemoryModule(resource));
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
  };

  return {
    ...baseSnapshot,
    summary: summarizeHardware(baseSnapshot),
  };
}
