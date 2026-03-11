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

export type HardwarePowerMetrics = {
  source: string;
  currentWatts: number | null;
  averageWatts: number | null;
  minWatts: number | null;
  maxWatts: number | null;
  cpuWatts: number | null;
  memoryWatts: number | null;
  gpuWatts: number | null;
  ambientTemperatureC: number | null;
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
  power: HardwarePowerMetrics | null;
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
    powerNowWatts: number | null;
    powerAverageWatts: number | null;
    powerPeakWatts: number | null;
    cpuPowerWatts: number | null;
    memoryPowerWatts: number | null;
    ambientTemperatureC: number | null;
  };
};

export type RedfishResource = Record<string, unknown>;

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

function readHpePowerMetric(resource: RedfishResource) {
  const oem = isRecord(resource.Oem) ? resource.Oem : null;
  const hpe = oem && isRecord(oem.Hpe) ? oem.Hpe : null;
  return hpe && isRecord(hpe.PowerMetric) ? hpe.PowerMetric : null;
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

export function collectTemperatureSensors(
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
  const state = extractStateText(value);

  if (state !== "absent" && reading !== null && reading >= -40 && reading <= 150) {
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

export function parseProcessor(
  resource: RedfishResource,
  temperatures: HardwareTemperatureSensor[],
): HardwareProcessor {
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

export function parseMemoryModule(resource: RedfishResource): HardwareMemoryModule | null {
  if (extractStateText(resource) === "absent") {
    return null;
  }
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

export function parseDrive(resource: RedfishResource): HardwareDrive | null {
  if (extractStateText(resource) === "absent") {
    return null;
  }
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

export function parsePowerMetrics(resource: RedfishResource, source: string): HardwarePowerMetrics | null {
  const powerControl = Array.isArray(resource.PowerControl) ? resource.PowerControl.filter(isRecord) : [];
  const powerSupplies = Array.isArray(resource.PowerSupplies) ? resource.PowerSupplies.filter(isRecord) : [];
  const hpePowerMetric = readHpePowerMetric(resource);

  const currentWatts =
    sumNullableNumbers(powerControl.map((entry) => asNumber(entry.PowerConsumedWatts))) ??
    sumNullableNumbers(powerSupplies.map((entry) => asNumber(entry.LastPowerOutputWatts)));
  const averageWatts =
    sumNullableNumbers(
      powerControl.map((entry) => {
        const metrics = isRecord(entry.PowerMetrics) ? entry.PowerMetrics : null;
        return asNumber(metrics?.AverageConsumedWatts);
      }),
    ) ??
    sumNullableNumbers(
      powerSupplies.map((entry) => {
        const oem = isRecord(entry.Oem) ? entry.Oem : null;
        const hpe = oem && isRecord(oem.Hpe) ? oem.Hpe : null;
        return asNumber(hpe?.AveragePowerOutputWatts);
      }),
    );
  const minWatts = sumNullableNumbers(
    powerControl.map((entry) => {
      const metrics = isRecord(entry.PowerMetrics) ? entry.PowerMetrics : null;
      return asNumber(metrics?.MinConsumedWatts);
    }),
  );
  const maxWatts =
    sumNullableNumbers(
      powerControl.map((entry) => {
        const metrics = isRecord(entry.PowerMetrics) ? entry.PowerMetrics : null;
        return asNumber(metrics?.MaxConsumedWatts);
      }),
    ) ??
    sumNullableNumbers(
      powerSupplies.map((entry) => {
        const oem = isRecord(entry.Oem) ? entry.Oem : null;
        const hpe = oem && isRecord(oem.Hpe) ? oem.Hpe : null;
        return asNumber(hpe?.MaxPowerOutputWatts);
      }),
    );
  const cpuWatts = hpePowerMetric ? asNumber(hpePowerMetric.CpuWatts) : null;
  const memoryWatts = hpePowerMetric ? asNumber(hpePowerMetric.DimmWatts) : null;
  const gpuWatts = hpePowerMetric ? asNumber(hpePowerMetric.GpuWatts) : null;
  const ambientTemperatureC = hpePowerMetric ? asNumber(hpePowerMetric.AmbTemp) : null;

  if (
    currentWatts === null &&
    averageWatts === null &&
    minWatts === null &&
    maxWatts === null &&
    cpuWatts === null &&
    memoryWatts === null &&
    gpuWatts === null &&
    ambientTemperatureC === null
  ) {
    return null;
  }

  return {
    source,
    currentWatts,
    averageWatts,
    minWatts,
    maxWatts,
    cpuWatts,
    memoryWatts,
    gpuWatts,
    ambientTemperatureC,
  };
}

export function summarizeHardware(snapshot: Omit<HardwareSnapshot, "summary">) {
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
    powerNowWatts: snapshot.power?.currentWatts ?? null,
    powerAverageWatts: snapshot.power?.averageWatts ?? null,
    powerPeakWatts: snapshot.power?.maxWatts ?? null,
    cpuPowerWatts: snapshot.power?.cpuWatts ?? null,
    memoryPowerWatts: snapshot.power?.memoryWatts ?? null,
    ambientTemperatureC: snapshot.power?.ambientTemperatureC ?? null,
  };
}

export const __redfishTestUtils = {
  collectTemperatureSensors,
  parseProcessor,
  parseMemoryModule,
  parseDrive,
  parsePowerMetrics,
  summarizeHardware,
};
