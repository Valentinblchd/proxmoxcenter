import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { RuntimeGreenItConfig } from "@/lib/greenit/runtime-config";

const CRE_TRVE_URL =
  "https://www.cre.fr/consommateurs/comprendre-les-tarifs-reglementes-de-vente-delectricite-trve.html";
const EDF_STANDARD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EDF_STANDARD_FALLBACK = {
  pricePerKwh: 0.194,
  annualSubscriptionEur: 188.24,
  effectiveDate: "2026-02-01",
};

type EdfStandardTariffCache = {
  pricePerKwh: number;
  annualSubscriptionEur: number | null;
  fetchedAt: string;
  effectiveDate: string | null;
  sourceUrl: string;
  sourceLabel: string;
};

export type GreenItElectricityPricing = {
  mode: "manual" | "edf-standard";
  pricePerKwh: number;
  annualSubscriptionEur: number | null;
  sourceLabel: string;
  sourceUrl: string | null;
  fetchedAt: string | null;
  effectiveDate: string | null;
  stale: boolean;
};

function getDefaultEdfTariffCachePath() {
  return path.join(process.cwd(), "data", "edf-standard-cache.json");
}

function getEdfTariffCachePath() {
  const custom = process.env.PROXCENTER_EDF_TARIFF_CACHE_PATH?.trim();
  return custom || getDefaultEdfTariffCachePath();
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseFrenchNumber(raw: string) {
  const normalized = raw.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCache(value: unknown): EdfStandardTariffCache | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const pricePerKwh =
    typeof record.pricePerKwh === "number" && Number.isFinite(record.pricePerKwh) && record.pricePerKwh > 0
      ? record.pricePerKwh
      : null;
  if (pricePerKwh === null) return null;
  const annualSubscriptionEur =
    typeof record.annualSubscriptionEur === "number" && Number.isFinite(record.annualSubscriptionEur)
      ? record.annualSubscriptionEur
      : null;
  const fetchedAt = typeof record.fetchedAt === "string" && record.fetchedAt.trim() ? record.fetchedAt : null;
  if (!fetchedAt) return null;
  return {
    pricePerKwh,
    annualSubscriptionEur,
    fetchedAt,
    effectiveDate: typeof record.effectiveDate === "string" && record.effectiveDate.trim() ? record.effectiveDate : null,
    sourceUrl: typeof record.sourceUrl === "string" && record.sourceUrl.trim() ? record.sourceUrl : CRE_TRVE_URL,
    sourceLabel:
      typeof record.sourceLabel === "string" && record.sourceLabel.trim()
        ? record.sourceLabel
        : "CRE TRVE Base 6 kVA",
  };
}

function readCachedEdfTariff() {
  const filePath = getEdfTariffCachePath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    return normalizeCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedEdfTariff(cache: EdfStandardTariffCache) {
  const filePath = getEdfTariffCachePath();
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function isFresh(cache: EdfStandardTariffCache | null) {
  if (!cache) return false;
  const fetchedAt = new Date(cache.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return false;
  return Date.now() - fetchedAt.getTime() <= EDF_STANDARD_CACHE_TTL_MS;
}

function parseCreBase6KvaTariff(html: string): EdfStandardTariffCache | null {
  const rowMatch = html.match(/<td><em>BASE\s*6kVA<\/em><\/td><td>([\d,]+)<\/td><td>([\d,]+)<\/td>/i);
  if (!rowMatch) return null;
  const annualSubscriptionEur = parseFrenchNumber(rowMatch[1]);
  const variableCents = parseFrenchNumber(rowMatch[2]);
  if (variableCents === null) return null;

  const effectiveDateMatch =
    html.match(/1er-fevrier-(\d{4})/i) ??
    html.match(/1er f[ée]vrier (\d{4})/i);
  const effectiveDate = effectiveDateMatch ? `${effectiveDateMatch[1]}-02-01` : null;

  return {
    pricePerKwh: variableCents / 100,
    annualSubscriptionEur,
    fetchedAt: new Date().toISOString(),
    effectiveDate,
    sourceUrl: CRE_TRVE_URL,
    sourceLabel: "CRE TRVE Base 6 kVA",
  };
}

async function fetchOfficialEdfTariff() {
  const response = await fetch(CRE_TRVE_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`CRE HTTP ${response.status}`);
  }
  const parsed = parseCreBase6KvaTariff(html);
  if (!parsed) {
    throw new Error("Impossible de parser le tarif EDF standard sur la page CRE.");
  }
  writeCachedEdfTariff(parsed);
  return parsed;
}

async function getEdfStandardTariff(): Promise<{ cache: EdfStandardTariffCache; stale: boolean }> {
  const cached = readCachedEdfTariff();
  if (isFresh(cached)) {
    return { cache: cached as EdfStandardTariffCache, stale: false };
  }

  try {
    const fresh = await fetchOfficialEdfTariff();
    return { cache: fresh, stale: false };
  } catch {
    if (cached) {
      return { cache: cached, stale: true };
    }
    return {
      cache: {
        pricePerKwh: EDF_STANDARD_FALLBACK.pricePerKwh,
        annualSubscriptionEur: EDF_STANDARD_FALLBACK.annualSubscriptionEur,
        fetchedAt: new Date().toISOString(),
        effectiveDate: EDF_STANDARD_FALLBACK.effectiveDate,
        sourceUrl: CRE_TRVE_URL,
        sourceLabel: "CRE TRVE Base 6 kVA (fallback)",
      },
      stale: true,
    };
  }
}

export async function resolveGreenItElectricityPricing(config?: RuntimeGreenItConfig | null): Promise<GreenItElectricityPricing> {
  if (config?.electricityPriceMode === "manual" && config.electricityPricePerKwh && config.electricityPricePerKwh > 0) {
    return {
      mode: "manual",
      pricePerKwh: config.electricityPricePerKwh,
      annualSubscriptionEur: null,
      sourceLabel: "Tarif manuel",
      sourceUrl: null,
      fetchedAt: config.updatedAt,
      effectiveDate: null,
      stale: false,
    };
  }

  const { cache, stale } = await getEdfStandardTariff();
  return {
    mode: "edf-standard",
    pricePerKwh: cache.pricePerKwh,
    annualSubscriptionEur: cache.annualSubscriptionEur,
    sourceLabel: cache.sourceLabel,
    sourceUrl: cache.sourceUrl,
    fetchedAt: cache.fetchedAt,
    effectiveDate: cache.effectiveDate,
    stale,
  };
}
