import "server-only";
import { recordGreenItSample } from "@/lib/greenit/history";
import { resolveGreenItElectricityPricing } from "@/lib/greenit/edf-tariff";
import { readRuntimeGreenItConfig } from "@/lib/greenit/runtime-config";
import { fetchHardwareSnapshot } from "@/lib/hardware/redfish";
import { readRuntimeHardwareMonitorConfig } from "@/lib/hardware/runtime-config";
import {
  readRuntimeHardwareSnapshotState,
  writeRuntimeHardwareSnapshotState,
} from "@/lib/hardware/runtime-snapshot";
import { buildGreenItAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

type GreenItSamplerGlobal = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
  intervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
};

const GREENIT_SAMPLER_GLOBAL_KEY = "__proxcenter_greenit_sampler__";
const DEFAULT_INTERVAL_MS = 5 * 60_000;

function getGlobalState(): GreenItSamplerGlobal {
  const globalRef = globalThis as typeof globalThis & {
    [GREENIT_SAMPLER_GLOBAL_KEY]?: GreenItSamplerGlobal;
  };

  if (!globalRef[GREENIT_SAMPLER_GLOBAL_KEY]) {
    globalRef[GREENIT_SAMPLER_GLOBAL_KEY] = {
      started: false,
      running: false,
      timer: null,
      intervalMs: DEFAULT_INTERVAL_MS,
      lastRunAt: null,
      lastError: null,
    };
  }

  return globalRef[GREENIT_SAMPLER_GLOBAL_KEY];
}

function resolveIntervalMs() {
  const raw = process.env.PROXCENTER_GREENIT_SAMPLE_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 60 * 60_000) {
    return DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

export async function runGreenItSamplingCycle() {
  const state = getGlobalState();
  if (state.running) {
    return;
  }

  state.running = true;
  state.lastError = null;

  try {
    const snapshot = await getDashboardSnapshot();
    const greenitSettings = readRuntimeGreenItConfig();
    const electricityPricing = await resolveGreenItElectricityPricing(greenitSettings);
    const hardwareMonitorConfig = readRuntimeHardwareMonitorConfig();

    let hardwareSnapshot = null;
    if (hardwareMonitorConfig?.enabled) {
      const attemptedAt = new Date().toISOString();
      try {
        hardwareSnapshot = await fetchHardwareSnapshot(hardwareMonitorConfig);
        writeRuntimeHardwareSnapshotState({
          status: hardwareSnapshot ? "ok" : "error",
          attemptedAt,
          fetchedAt: hardwareSnapshot?.fetchedAt ?? null,
          error: hardwareSnapshot ? null : "Aucune donnée Redfish remontée.",
          snapshot: hardwareSnapshot,
        });
      } catch (error) {
        const previous = readRuntimeHardwareSnapshotState();
        writeRuntimeHardwareSnapshotState({
          status: "error",
          attemptedAt,
          fetchedAt: previous.fetchedAt,
          error: error instanceof Error ? error.message : "Échec de collecte Redfish.",
          snapshot: previous.snapshot,
        });
      }
    } else {
      writeRuntimeHardwareSnapshotState({
        status: "idle",
        attemptedAt: new Date().toISOString(),
        fetchedAt: null,
        error: null,
        snapshot: null,
      });
    }

    const livePowerWatts = hardwareSnapshot?.summary.powerAverageWatts ?? hardwareSnapshot?.summary.powerNowWatts ?? null;
    const livePowerSource =
      livePowerWatts !== null ? `Power meter ${hardwareSnapshot?.label ?? hardwareSnapshot?.host ?? "serveur"}` : null;
    const greenit = buildGreenItAdvisor(snapshot, {
      ...(greenitSettings ?? {}),
      electricityPricePerKwh: electricityPricing.pricePerKwh,
      electricityBillingMode: greenitSettings?.electricityBillingMode ?? "energy-only",
      annualSubscriptionEur: electricityPricing.annualSubscriptionEur,
      liveMeasuredPowerWatts: livePowerWatts,
      liveMeasuredPowerSource: livePowerSource,
    });

    recordGreenItSample({
      timestamp: new Date().toISOString(),
      itPowerWatts: greenit.metrics.estimatedPowerWatts,
      effectivePowerWatts: greenit.metrics.effectivePowerWatts,
      electricityPricePerKwh: electricityPricing.pricePerKwh,
      annualSubscriptionEur:
        greenit.config.electricityBillingMode === "full-bill" ? electricityPricing.annualSubscriptionEur ?? 0 : 0,
      co2FactorKgPerKwh: greenit.config.co2FactorKgPerKwh,
      powerSource: greenit.metrics.powerSourceLabel,
    });

    state.lastRunAt = new Date().toISOString();
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Erreur sampler GreenIT.";
  } finally {
    state.running = false;
  }
}

export function ensureGreenItSamplerStarted() {
  const state = getGlobalState();
  if (state.started) {
    return;
  }

  state.intervalMs = resolveIntervalMs();
  state.started = true;
  void runGreenItSamplingCycle();
  state.timer = setInterval(() => {
    void runGreenItSamplingCycle();
  }, state.intervalMs);
}
