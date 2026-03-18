import "server-only";
import fs from "node:fs";
import path from "node:path";

const HISTORY_RETENTION_DAYS = 370;
const MAX_SAMPLE_GAP_MS = 12 * 60 * 60 * 1000;
const HISTORY_TIME_ZONE = process.env.PROXCENTER_TIMEZONE?.trim() || "Europe/Paris";

export type GreenItHistorySample = {
  timestamp: string;
  itPowerWatts: number;
  effectivePowerWatts: number;
  electricityPricePerKwh: number;
  annualSubscriptionEur?: number;
  co2FactorKgPerKwh: number;
  powerSource: string;
};

export type GreenItHistoryDay = {
  date: string;
  trackedHours: number;
  itWattHours: number;
  effectiveWattHours: number;
  costEur: number;
  co2Kg: number;
  maxItPowerWatts: number;
  maxEffectivePowerWatts: number;
  lastPowerSource: string;
};

type GreenItHistoryState = {
  updatedAt: string;
  lastSample: GreenItHistorySample | null;
  days: GreenItHistoryDay[];
};

export type GreenItMonthlySummary = {
  month: string;
  trackedDays: number;
  totalKwh: number;
  totalCostEur: number;
  totalCo2Kg: number;
  averageDailyKwh: number;
  averageDailyCostEur: number;
  projectedMonthKwh: number;
  projectedMonthCostEur: number;
  projectedMonthCo2Kg: number;
};

function getDefaultGreenItHistoryPath() {
  return path.join(process.cwd(), "data", "greenit-history.json");
}

function getGreenItHistoryPath() {
  const custom = process.env.PROXCENTER_GREENIT_HISTORY_PATH?.trim();
  return custom || getDefaultGreenItHistoryPath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HISTORY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function monthKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HISTORY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date).slice(0, 7);
}

function parseDayKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfNextLocalDay(date: Date) {
  const key = dayKey(date);
  const parsed = parseDayKey(key);
  if (!parsed) return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return new Date(parsed.getTime() + 24 * 60 * 60 * 1000);
}

function normalizeDay(value: unknown): GreenItHistoryDay | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.date !== "string" || !parseDayKey(record.date)) return null;
  const trackedHours =
    typeof record.trackedHours === "number" && Number.isFinite(record.trackedHours) && record.trackedHours >= 0
      ? record.trackedHours
      : 0;
  const itWattHours =
    typeof record.itWattHours === "number" && Number.isFinite(record.itWattHours) && record.itWattHours >= 0
      ? record.itWattHours
      : 0;
  const effectiveWattHours =
    typeof record.effectiveWattHours === "number" && Number.isFinite(record.effectiveWattHours) && record.effectiveWattHours >= 0
      ? record.effectiveWattHours
      : 0;
  const costEur =
    typeof record.costEur === "number" && Number.isFinite(record.costEur) && record.costEur >= 0 ? record.costEur : 0;
  const co2Kg =
    typeof record.co2Kg === "number" && Number.isFinite(record.co2Kg) && record.co2Kg >= 0 ? record.co2Kg : 0;
  const maxItPowerWatts =
    typeof record.maxItPowerWatts === "number" && Number.isFinite(record.maxItPowerWatts) && record.maxItPowerWatts >= 0
      ? record.maxItPowerWatts
      : 0;
  const maxEffectivePowerWatts =
    typeof record.maxEffectivePowerWatts === "number" &&
    Number.isFinite(record.maxEffectivePowerWatts) &&
    record.maxEffectivePowerWatts >= 0
      ? record.maxEffectivePowerWatts
      : 0;

  return {
    date: record.date,
    trackedHours,
    itWattHours,
    effectiveWattHours,
    costEur,
    co2Kg,
    maxItPowerWatts,
    maxEffectivePowerWatts,
    lastPowerSource: typeof record.lastPowerSource === "string" ? record.lastPowerSource : "inconnu",
  };
}

function readState(): GreenItHistoryState {
  const filePath = getGreenItHistoryPath();
  if (!fs.existsSync(filePath)) {
    return { updatedAt: new Date().toISOString(), lastSample: null, days: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const days = Array.isArray(parsed.days) ? parsed.days.map(normalizeDay).filter(Boolean) as GreenItHistoryDay[] : [];
    const lastSample =
      parsed.lastSample && typeof parsed.lastSample === "object"
        ? (parsed.lastSample as GreenItHistorySample)
        : null;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      lastSample,
      days,
    };
  } catch {
    return { updatedAt: new Date().toISOString(), lastSample: null, days: [] };
  }
}

function writeState(state: GreenItHistoryState) {
  const filePath = getGreenItHistoryPath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function pruneDays(days: GreenItHistoryDay[]) {
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const cutoffKey = dayKey(cutoff);
  return days
    .filter((day) => day.date >= cutoffKey)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function upsertDay(days: GreenItHistoryDay[], fragment: Omit<GreenItHistoryDay, "maxItPowerWatts" | "maxEffectivePowerWatts" | "lastPowerSource"> & {
  maxItPowerWatts: number;
  maxEffectivePowerWatts: number;
  lastPowerSource: string;
}) {
  const existing = days.find((entry) => entry.date === fragment.date);
  if (!existing) {
    days.push({
      ...fragment,
    });
    return;
  }

  existing.trackedHours += fragment.trackedHours;
  existing.itWattHours += fragment.itWattHours;
  existing.effectiveWattHours += fragment.effectiveWattHours;
  existing.costEur += fragment.costEur;
  existing.co2Kg += fragment.co2Kg;
  existing.maxItPowerWatts = Math.max(existing.maxItPowerWatts, fragment.maxItPowerWatts);
  existing.maxEffectivePowerWatts = Math.max(existing.maxEffectivePowerWatts, fragment.maxEffectivePowerWatts);
  existing.lastPowerSource = fragment.lastPowerSource;
}

function integrateInterval(days: GreenItHistoryDay[], sample: GreenItHistorySample, start: Date, end: Date) {
  let cursor = new Date(start);
  while (cursor < end) {
    const nextDay = startOfNextLocalDay(cursor);
    const boundary = nextDay < end ? nextDay : end;
    const hours = Math.max(0, (boundary.getTime() - cursor.getTime()) / 3_600_000);
    if (hours > 0) {
      upsertDay(days, {
        date: dayKey(cursor),
        trackedHours: hours,
        itWattHours: sample.itPowerWatts * hours,
        effectiveWattHours: sample.effectivePowerWatts * hours,
        costEur:
          (sample.effectivePowerWatts * hours / 1000) * sample.electricityPricePerKwh +
          ((sample.annualSubscriptionEur ?? 0) / 8760) * hours,
        co2Kg: (sample.effectivePowerWatts * hours / 1000) * sample.co2FactorKgPerKwh,
        maxItPowerWatts: sample.itPowerWatts,
        maxEffectivePowerWatts: sample.effectivePowerWatts,
        lastPowerSource: sample.powerSource,
      });
    }
    cursor = new Date(boundary);
  }
}

export function recordGreenItSample(sample: GreenItHistorySample) {
  const state = readState();
  const now = new Date(sample.timestamp);
  if (state.lastSample?.timestamp) {
    const previousTime = new Date(state.lastSample.timestamp);
    if (!Number.isNaN(previousTime.getTime()) && previousTime < now) {
      const cappedStart = previousTime;
      const cappedEnd = new Date(Math.min(now.getTime(), previousTime.getTime() + MAX_SAMPLE_GAP_MS));
      if (cappedEnd > cappedStart) {
        integrateInterval(state.days, state.lastSample, cappedStart, cappedEnd);
      }
    }
  }

  state.lastSample = sample;
  state.updatedAt = new Date().toISOString();
  state.days = pruneDays(state.days);
  writeState(state);
  return state;
}

function buildMonthlySummary(days: GreenItHistoryDay[], month: string): GreenItMonthlySummary {
  const monthDays = days.filter((entry) => entry.date.startsWith(`${month}-`));
  const totalEffectiveWh = monthDays.reduce((sum, entry) => sum + entry.effectiveWattHours, 0);
  const totalCostEur = monthDays.reduce((sum, entry) => sum + entry.costEur, 0);
  const totalCo2Kg = monthDays.reduce((sum, entry) => sum + entry.co2Kg, 0);
  const trackedDayCount = new Set(monthDays.map((entry) => entry.date)).size;
  const date = new Date(`${month}-01T12:00:00.000Z`);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const averageDailyKwh = trackedDayCount > 0 ? totalEffectiveWh / 1000 / trackedDayCount : 0;
  const averageDailyCostEur = trackedDayCount > 0 ? totalCostEur / trackedDayCount : 0;

  return {
    month,
    trackedDays: trackedDayCount,
    totalKwh: totalEffectiveWh / 1000,
    totalCostEur,
    totalCo2Kg,
    averageDailyKwh,
    averageDailyCostEur,
    projectedMonthKwh: averageDailyKwh * daysInMonth,
    projectedMonthCostEur: averageDailyCostEur * daysInMonth,
    projectedMonthCo2Kg: trackedDayCount > 0 ? (totalCo2Kg / trackedDayCount) * daysInMonth : 0,
  };
}

export function readGreenItHistorySummary() {
  const state = readState();
  const days = pruneDays(state.days);
  const now = new Date();
  const currentMonth = buildMonthlySummary(days, monthKey(now));
  const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12, 0, 0));
  const previousMonth = buildMonthlySummary(days, monthKey(previousMonthDate));

  return {
    updatedAt: state.updatedAt,
    lastSample: state.lastSample,
    days: days.map((entry) => ({
      ...entry,
      averageItPowerWatts: entry.trackedHours > 0 ? entry.itWattHours / entry.trackedHours : 0,
      averageEffectivePowerWatts: entry.trackedHours > 0 ? entry.effectiveWattHours / entry.trackedHours : 0,
      kwh: entry.effectiveWattHours / 1000,
    })),
    currentMonth,
    previousMonth,
  };
}
