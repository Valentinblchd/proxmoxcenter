import "server-only";
import fs from "node:fs";
import path from "node:path";

export type RuntimeGreenItConfig = {
  estimatedPowerWatts: number | null;
  pue: number;
  co2FactorKgPerKwh: number;
  electricityPricePerKwh: number | null;
  electricityPriceMode: "manual" | "edf-standard";
  serverTemperatureC: number | null;
  outsideTemperatureC: number | null;
  outsideCity: string | null;
  updatedAt: string;
};

type RuntimeGreenItConfigInput = {
  estimatedPowerWatts?: unknown;
  pue?: unknown;
  co2FactorKgPerKwh?: unknown;
  electricityPricePerKwh?: unknown;
  electricityPriceMode?: unknown;
  serverTemperatureC?: unknown;
  outsideTemperatureC?: unknown;
  outsideCity?: unknown;
  updatedAt?: unknown;
};

function asNumber(value: unknown, opts: { min?: number; max?: number; allowNull?: boolean } = {}) {
  if (opts.allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseFloat(value.replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  if (typeof opts.min === "number" && parsed < opts.min) return null;
  if (typeof opts.max === "number" && parsed > opts.max) return null;
  return parsed;
}

function asText(value: unknown, max = 160) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function asIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function asElectricityPriceMode(value: unknown): "manual" | "edf-standard" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "edf-standard" || normalized === "edf" || normalized === "auto") return "edf-standard";
  return null;
}

function normalizeInput(input: RuntimeGreenItConfigInput): RuntimeGreenItConfig | null {
  const pue = asNumber(input.pue, { min: 1, max: 5 });
  const co2FactorKgPerKwh = asNumber(input.co2FactorKgPerKwh, { min: 0.001, max: 5 });
  const electricityPricePerKwh = asNumber(input.electricityPricePerKwh, { min: 0.001, max: 20, allowNull: true });
  const electricityPriceMode =
    asElectricityPriceMode(input.electricityPriceMode) ??
    (electricityPricePerKwh !== null ? "manual" : "edf-standard");
  if (pue === null || co2FactorKgPerKwh === null) {
    return null;
  }
  if (electricityPriceMode === "manual" && electricityPricePerKwh === null) {
    return null;
  }

  return {
    estimatedPowerWatts: asNumber(input.estimatedPowerWatts, { min: 1, max: 1_000_000, allowNull: true }),
    pue,
    co2FactorKgPerKwh,
    electricityPricePerKwh: electricityPriceMode === "manual" ? electricityPricePerKwh : null,
    electricityPriceMode,
    serverTemperatureC: asNumber(input.serverTemperatureC, { min: -40, max: 120, allowNull: true }),
    outsideTemperatureC: asNumber(input.outsideTemperatureC, { min: -80, max: 80, allowNull: true }),
    outsideCity: asText(input.outsideCity, 160),
    updatedAt: asIsoDate(input.updatedAt) ?? new Date().toISOString(),
  };
}

function getDefaultRuntimeGreenItConfigPath() {
  return path.join(process.cwd(), "data", "greenit-config.json");
}

export function getRuntimeGreenItConfigPath() {
  const custom = process.env.PROXCENTER_GREENIT_CONFIG_PATH?.trim();
  return custom || getDefaultRuntimeGreenItConfigPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readRuntimeGreenItConfig() {
  const filePath = getRuntimeGreenItConfigPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return normalizeInput(JSON.parse(raw) as RuntimeGreenItConfigInput);
  } catch {
    return null;
  }
}

export function writeRuntimeGreenItConfig(input: RuntimeGreenItConfigInput) {
  const normalized = normalizeInput(input);
  if (!normalized) {
    throw new Error("Configuration GreenIT invalide.");
  }
  const filePath = getRuntimeGreenItConfigPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return normalized;
}
