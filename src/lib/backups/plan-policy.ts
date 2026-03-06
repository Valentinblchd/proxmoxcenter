export type BackupRecurrenceUnit = "hour" | "day" | "week" | "month" | "year";
export type BackupRetentionMode = "auto" | "manual";
export type BackupRetentionPreset = "short" | "balanced" | "long";

export type BackupRetentionPolicy = {
  days: number;
  weeks: number;
  months: number;
  years: number;
};

export type BackupScheduleShape = {
  recurrenceEvery: number;
  recurrenceUnit: BackupRecurrenceUnit;
  preferredTime: string;
};

function clampPositiveInt(value: number, fallback: number, max = 3650) {
  if (!Number.isInteger(value) || value < 1 || value > max) return fallback;
  return value;
}

export function normalizeLegacyRecurrence(runsPerWeek: number) {
  if (runsPerWeek >= 14) {
    return { recurrenceEvery: 12, recurrenceUnit: "hour" as const };
  }
  if (runsPerWeek >= 7) {
    return { recurrenceEvery: 1, recurrenceUnit: "day" as const };
  }
  if (runsPerWeek >= 2) {
    return { recurrenceEvery: 3, recurrenceUnit: "day" as const };
  }
  return { recurrenceEvery: 1, recurrenceUnit: "week" as const };
}

export function approximateRunsPerWeek(recurrenceEvery: number, recurrenceUnit: BackupRecurrenceUnit) {
  const every = clampPositiveInt(recurrenceEvery, 1);
  if (recurrenceUnit === "hour") return Math.max(1, Math.round((24 * 7) / every));
  if (recurrenceUnit === "day") return Math.max(1, Math.round(7 / every));
  if (recurrenceUnit === "week") return Math.max(1, Math.round(1 / every));
  if (recurrenceUnit === "month") return 0;
  return 0;
}

export function formatRecurrenceLabel(recurrenceEvery: number, recurrenceUnit: BackupRecurrenceUnit) {
  const every = clampPositiveInt(recurrenceEvery, 1);
  if (recurrenceUnit === "hour") return every === 1 ? "Toutes les heures" : `Toutes les ${every} heures`;
  if (recurrenceUnit === "day") return every === 1 ? "Tous les jours" : `Tous les ${every} jours`;
  if (recurrenceUnit === "week") return every === 1 ? "Chaque semaine" : `Toutes les ${every} semaines`;
  if (recurrenceUnit === "month") return every === 1 ? "Chaque mois" : `Tous les ${every} mois`;
  return every === 1 ? "Chaque année" : `Tous les ${every} ans`;
}

export function buildAutoRetentionPolicy(
  preset: BackupRetentionPreset,
  recurrenceEvery: number,
  recurrenceUnit: BackupRecurrenceUnit,
): BackupRetentionPolicy {
  const every = clampPositiveInt(recurrenceEvery, 1);

  if (recurrenceUnit === "hour") {
    if (preset === "short") return { days: Math.max(2, Math.ceil(3 / every)), weeks: 2, months: 1, years: 0 };
    if (preset === "balanced") return { days: Math.max(7, Math.ceil(7 / every)), weeks: 4, months: 3, years: 1 };
    return { days: Math.max(10, Math.ceil(10 / every)), weeks: 8, months: 6, years: 1 };
  }

  if (recurrenceUnit === "day") {
    if (preset === "short") return { days: Math.max(7, every * 7), weeks: 4, months: 2, years: 0 };
    if (preset === "balanced") return { days: Math.max(14, every * 14), weeks: 8, months: 3, years: 1 };
    return { days: Math.max(21, every * 21), weeks: 12, months: 6, years: 1 };
  }

  if (recurrenceUnit === "week") {
    if (preset === "short") return { days: 0, weeks: Math.max(4, every * 4), months: 3, years: 0 };
    if (preset === "balanced") return { days: 0, weeks: Math.max(8, every * 8), months: 6, years: 1 };
    return { days: 0, weeks: Math.max(12, every * 12), months: 12, years: 1 };
  }

  if (recurrenceUnit === "month") {
    if (preset === "short") return { days: 0, weeks: 0, months: Math.max(6, every * 6), years: 1 };
    if (preset === "balanced") return { days: 0, weeks: 0, months: Math.max(12, every * 12), years: 2 };
    return { days: 0, weeks: 0, months: Math.max(18, every * 18), years: 3 };
  }

  if (preset === "short") return { days: 0, weeks: 0, months: 0, years: Math.max(2, every * 2) };
  if (preset === "balanced") return { days: 0, weeks: 0, months: 0, years: Math.max(3, every * 3) };
  return { days: 0, weeks: 0, months: 0, years: Math.max(5, every * 5) };
}

export function inferRetentionPreset(
  mode: BackupRetentionMode,
  policy: BackupRetentionPolicy,
  recurrenceEvery: number,
  recurrenceUnit: BackupRecurrenceUnit,
) {
  if (mode !== "auto") return null;
  const presets: BackupRetentionPreset[] = ["short", "balanced", "long"];
  for (const preset of presets) {
    const expected = buildAutoRetentionPolicy(preset, recurrenceEvery, recurrenceUnit);
    if (
      expected.days === policy.days &&
      expected.weeks === policy.weeks &&
      expected.months === policy.months &&
      expected.years === policy.years
    ) {
      return preset;
    }
  }
  return null;
}

export function formatRetentionPolicy(policy: BackupRetentionPolicy, mode: BackupRetentionMode) {
  const chunks: string[] = [];
  if (policy.days > 0) chunks.push(`${policy.days} jour${policy.days > 1 ? "s" : ""}`);
  if (policy.weeks > 0) chunks.push(`${policy.weeks} semaine${policy.weeks > 1 ? "s" : ""}`);
  if (policy.months > 0) chunks.push(`${policy.months} mois`);
  if (policy.years > 0) chunks.push(`${policy.years} an${policy.years > 1 ? "s" : ""}`);
  if (chunks.length === 0) return "Aucune";
  return mode === "auto" ? `Auto: ${chunks.join(" • ")}` : chunks.join(" • ");
}

function parsePreferredTime(preferredTime: string) {
  const match = preferredTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { hours: 1, minutes: 0 };
  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
  };
}

function addInterval(base: Date, every: number, unit: BackupRecurrenceUnit) {
  const next = new Date(base);
  if (unit === "hour") next.setHours(next.getHours() + every);
  if (unit === "day") next.setDate(next.getDate() + every);
  if (unit === "week") next.setDate(next.getDate() + every * 7);
  if (unit === "month") next.setMonth(next.getMonth() + every);
  if (unit === "year") next.setFullYear(next.getFullYear() + every);
  return next;
}

function buildScheduleBase(now: Date, preferredTime: string, unit: BackupRecurrenceUnit) {
  const { hours, minutes } = parsePreferredTime(preferredTime);
  if (unit === "hour") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, minutes, 0, 0);
  }
  if (unit === "day") {
    return new Date(now.getFullYear(), now.getMonth(), 1, hours, minutes, 0, 0);
  }
  if (unit === "week") {
    const january = new Date(now.getFullYear(), 0, 1, hours, minutes, 0, 0);
    const day = january.getDay();
    const mondayShift = day === 0 ? -6 : 1 - day;
    january.setDate(january.getDate() + mondayShift);
    return january;
  }
  if (unit === "month") {
    return new Date(now.getFullYear(), 0, 1, hours, minutes, 0, 0);
  }
  return new Date(now.getFullYear(), 0, 1, hours, minutes, 0, 0);
}

export function getLastScheduledRun(schedule: BackupScheduleShape, now: Date) {
  const every = clampPositiveInt(schedule.recurrenceEvery, 1);
  let current = buildScheduleBase(now, schedule.preferredTime, schedule.recurrenceUnit);

  while (current.getTime() > now.getTime()) {
    current = addInterval(current, -every, schedule.recurrenceUnit);
  }

  let guard = 0;
  while (guard < 1000) {
    const next = addInterval(current, every, schedule.recurrenceUnit);
    if (next.getTime() > now.getTime()) {
      return current;
    }
    current = next;
    guard += 1;
  }

  return current;
}

export function getNextScheduledRun(schedule: BackupScheduleShape, now: Date) {
  const every = clampPositiveInt(schedule.recurrenceEvery, 1);
  const last = getLastScheduledRun(schedule, now);
  const preferred = parsePreferredTime(schedule.preferredTime);

  if (schedule.recurrenceUnit !== "hour") {
    last.setHours(preferred.hours, preferred.minutes, 0, 0);
  }

  return addInterval(last, every, schedule.recurrenceUnit);
}
