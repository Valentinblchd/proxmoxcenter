"use client";

import { useEffect, useMemo, useState } from "react";

type GreenItCalibrationPanelProps = {
  defaults: {
    estimatedPowerWatts: number;
    pue: number;
    co2FactorKgPerKwh: number;
    electricityPricePerKwh: number;
  };
};

type StoredOverrides = {
  estimatedPowerWatts?: number;
  pue?: number;
  co2FactorKgPerKwh?: number;
  electricityPricePerKwh?: number;
  serverTemperatureC?: number;
  outsideTemperatureC?: number;
  outsideCity?: string;
};

const STORAGE_KEY = "proxcenter_greenit_calibration_v1";

function asPositiveNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function asNumberOrNull(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredOverrides() {
  if (typeof window === "undefined") return {} as StoredOverrides;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {} as StoredOverrides;
    return JSON.parse(raw) as StoredOverrides;
  } catch {
    return {} as StoredOverrides;
  }
}

export default function GreenItCalibrationPanel({ defaults }: GreenItCalibrationPanelProps) {
  const [initialOverrides] = useState<StoredOverrides>(() => readStoredOverrides());
  const [powerWatts, setPowerWatts] = useState(() =>
    String(
      typeof initialOverrides.estimatedPowerWatts === "number" &&
        initialOverrides.estimatedPowerWatts > 0
        ? initialOverrides.estimatedPowerWatts
        : defaults.estimatedPowerWatts,
    ),
  );
  const [pue, setPue] = useState(() =>
    String(
      typeof initialOverrides.pue === "number" && initialOverrides.pue > 0
        ? initialOverrides.pue
        : defaults.pue,
    ),
  );
  const [co2Factor, setCo2Factor] = useState(() =>
    String(
      typeof initialOverrides.co2FactorKgPerKwh === "number" &&
        initialOverrides.co2FactorKgPerKwh > 0
        ? initialOverrides.co2FactorKgPerKwh
        : defaults.co2FactorKgPerKwh,
    ),
  );
  const [priceKwh, setPriceKwh] = useState(() =>
    String(
      typeof initialOverrides.electricityPricePerKwh === "number" &&
        initialOverrides.electricityPricePerKwh > 0
        ? initialOverrides.electricityPricePerKwh
        : defaults.electricityPricePerKwh,
    ),
  );
  const [serverTemperatureC, setServerTemperatureC] = useState(() =>
    typeof initialOverrides.serverTemperatureC === "number"
      ? String(initialOverrides.serverTemperatureC)
      : "",
  );
  const [outsideTemperatureC, setOutsideTemperatureC] = useState(() =>
    typeof initialOverrides.outsideTemperatureC === "number"
      ? String(initialOverrides.outsideTemperatureC)
      : "",
  );
  const [outsideCity, setOutsideCity] = useState(() =>
    typeof initialOverrides.outsideCity === "string" ? initialOverrides.outsideCity : "",
  );

  useEffect(() => {
    const payload: StoredOverrides = {
      estimatedPowerWatts: asPositiveNumber(powerWatts, defaults.estimatedPowerWatts),
      pue: asPositiveNumber(pue, defaults.pue),
      co2FactorKgPerKwh: asPositiveNumber(co2Factor, defaults.co2FactorKgPerKwh),
      electricityPricePerKwh: asPositiveNumber(priceKwh, defaults.electricityPricePerKwh),
      serverTemperatureC: asNumberOrNull(serverTemperatureC) ?? undefined,
      outsideTemperatureC: asNumberOrNull(outsideTemperatureC) ?? undefined,
      outsideCity: outsideCity.trim() || undefined,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write failures.
    }
  }, [co2Factor, defaults, outsideCity, outsideTemperatureC, powerWatts, priceKwh, pue, serverTemperatureC]);

  const computed = useMemo(() => {
    const watts = asPositiveNumber(powerWatts, defaults.estimatedPowerWatts);
    const pueValue = asPositiveNumber(pue, defaults.pue);
    const co2Value = asPositiveNumber(co2Factor, defaults.co2FactorKgPerKwh);
    const priceValue = asPositiveNumber(priceKwh, defaults.electricityPricePerKwh);
    const effectivePowerWatts = watts * pueValue;
    const annualKwh = (effectivePowerWatts * 24 * 365) / 1000;
    const annualCo2Kg = annualKwh * co2Value;
    const annualCost = annualKwh * priceValue;
    const serverTemp = asNumberOrNull(serverTemperatureC);
    const outsideTemp = asNumberOrNull(outsideTemperatureC);
    const thermalDelta = serverTemp !== null && outsideTemp !== null ? serverTemp - outsideTemp : null;

    return {
      watts,
      pueValue,
      co2Value,
      priceValue,
      effectivePowerWatts,
      annualKwh,
      annualCo2Kg,
      annualCost,
      thermalDelta,
    };
  }, [co2Factor, defaults, outsideTemperatureC, powerWatts, priceKwh, pue, serverTemperatureC]);

  function resetToDefaults() {
    setPowerWatts(String(defaults.estimatedPowerWatts));
    setPue(String(defaults.pue));
    setCo2Factor(String(defaults.co2FactorKgPerKwh));
    setPriceKwh(String(defaults.electricityPricePerKwh));
    setServerTemperatureC("");
    setOutsideTemperatureC("");
    setOutsideCity("");
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Calibration manuelle GreenIT</h2>
        <span className="muted">Persistance locale navigateur</span>
      </div>

      <div className="provision-grid">
        <label className="provision-field">
          <span className="provision-field-label">Puissance IT (W)</span>
          <input
            className="provision-input"
            value={powerWatts}
            onChange={(event) => setPowerWatts(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">PUE</span>
          <input
            className="provision-input"
            value={pue}
            onChange={(event) => setPue(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Facteur CO2 (kg/kWh)</span>
          <input
            className="provision-input"
            value={co2Factor}
            onChange={(event) => setCo2Factor(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Prix énergie (€/kWh)</span>
          <input
            className="provision-input"
            value={priceKwh}
            onChange={(event) => setPriceKwh(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>

      <div className="provision-grid">
        <label className="provision-field">
          <span className="provision-field-label">Température serveur (°C, optionnel)</span>
          <input
            className="provision-input"
            value={serverTemperatureC}
            onChange={(event) => setServerTemperatureC(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Ville extérieure (optionnel)</span>
          <input
            className="provision-input"
            value={outsideCity}
            onChange={(event) => setOutsideCity(event.target.value)}
            placeholder="Paris"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Température extérieure (°C, optionnel)</span>
          <input
            className="provision-input"
            value={outsideTemperatureC}
            onChange={(event) => setOutsideTemperatureC(event.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>

      <div className="mini-list">
        <article className="mini-list-item">
          <div>
            <div className="item-title">Puissance effective</div>
            <div className="item-subtitle">Puissance IT × PUE</div>
          </div>
          <div className="item-metric">{Math.round(computed.effectivePowerWatts)} W</div>
        </article>
        <article className="mini-list-item">
          <div>
            <div className="item-title">Conso annuelle</div>
            <div className="item-subtitle">24h × 365j</div>
          </div>
          <div className="item-metric">{Math.round(computed.annualKwh)} kWh</div>
        </article>
        <article className="mini-list-item">
          <div>
            <div className="item-title">CO2 annuel</div>
            <div className="item-subtitle">Conso × facteur CO2</div>
          </div>
          <div className="item-metric">{Math.round(computed.annualCo2Kg)} kg</div>
        </article>
        <article className="mini-list-item">
          <div>
            <div className="item-title">Coût annuel</div>
            <div className="item-subtitle">Conso × prix kWh</div>
          </div>
          <div className="item-metric">{Math.round(computed.annualCost)} €</div>
        </article>
        {computed.thermalDelta !== null ? (
          <article className="mini-list-item">
            <div>
              <div className="item-title">Delta thermique</div>
              <div className="item-subtitle">
                {outsideCity.trim() ? `${outsideCity.trim()} vs serveur` : "Extérieur vs serveur"}
              </div>
            </div>
            <div className="item-metric">{computed.thermalDelta > 0 ? "+" : ""}{computed.thermalDelta.toFixed(1)}°C</div>
          </article>
        ) : null}
      </div>

      <div className="quick-actions">
        <button type="button" className="action-btn" onClick={resetToDefaults}>
          Réinitialiser les valeurs
        </button>
      </div>
    </section>
  );
}
