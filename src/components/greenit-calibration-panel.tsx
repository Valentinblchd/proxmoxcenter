"use client";

import { useEffect, useMemo, useState } from "react";

type GreenItCalibrationPanelProps = {
  defaults: {
    estimatedPowerWatts: number;
    pue: number;
    co2FactorKgPerKwh: number;
    electricityPricePerKwh: number;
  };
  initialSettings?: {
    estimatedPowerWatts: number | null;
    pue: number;
    co2FactorKgPerKwh: number;
    electricityPricePerKwh: number;
    serverTemperatureC: number | null;
    outsideTemperatureC: number | null;
    outsideCity: string | null;
  } | null;
};

type SaveResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  settings?: {
    estimatedPowerWatts: number | null;
    pue: number;
    co2FactorKgPerKwh: number;
    electricityPricePerKwh: number;
    serverTemperatureC: number | null;
    outsideTemperatureC: number | null;
    outsideCity: string | null;
  } | null;
};

type WeatherResponse = {
  ok?: boolean;
  error?: string;
  city?: string;
  temperatureC?: number;
};

function asPositiveNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function asNumberOrNull(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GreenItCalibrationPanel({ defaults, initialSettings = null }: GreenItCalibrationPanelProps) {
  const [powerWatts, setPowerWatts] = useState(() =>
    String(initialSettings?.estimatedPowerWatts ?? defaults.estimatedPowerWatts),
  );
  const [pue, setPue] = useState(() => String(initialSettings?.pue ?? defaults.pue));
  const [co2Factor, setCo2Factor] = useState(() =>
    String(initialSettings?.co2FactorKgPerKwh ?? defaults.co2FactorKgPerKwh),
  );
  const [priceKwh, setPriceKwh] = useState(() =>
    String(initialSettings?.electricityPricePerKwh ?? defaults.electricityPricePerKwh),
  );
  const [serverTemperatureC, setServerTemperatureC] = useState(() =>
    initialSettings?.serverTemperatureC !== null && initialSettings?.serverTemperatureC !== undefined
      ? String(initialSettings.serverTemperatureC)
      : "",
  );
  const [outsideTemperatureC, setOutsideTemperatureC] = useState(() =>
    initialSettings?.outsideTemperatureC !== null && initialSettings?.outsideTemperatureC !== undefined
      ? String(initialSettings.outsideTemperatureC)
      : "",
  );
  const [outsideCity, setOutsideCity] = useState(() => initialSettings?.outsideCity ?? "");
  const [busy, setBusy] = useState(false);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setPowerWatts(String(initialSettings?.estimatedPowerWatts ?? defaults.estimatedPowerWatts));
    setPue(String(initialSettings?.pue ?? defaults.pue));
    setCo2Factor(String(initialSettings?.co2FactorKgPerKwh ?? defaults.co2FactorKgPerKwh));
    setPriceKwh(String(initialSettings?.electricityPricePerKwh ?? defaults.electricityPricePerKwh));
    setServerTemperatureC(
      initialSettings?.serverTemperatureC !== null && initialSettings?.serverTemperatureC !== undefined
        ? String(initialSettings.serverTemperatureC)
        : "",
    );
    setOutsideTemperatureC(
      initialSettings?.outsideTemperatureC !== null && initialSettings?.outsideTemperatureC !== undefined
        ? String(initialSettings.outsideTemperatureC)
        : "",
    );
    setOutsideCity(initialSettings?.outsideCity ?? "");
  }, [defaults, initialSettings]);

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
      effectivePowerWatts,
      annualKwh,
      annualCo2Kg,
      annualCost,
      thermalDelta,
    };
  }, [co2Factor, defaults, outsideTemperatureC, powerWatts, priceKwh, pue, serverTemperatureC]);

  async function saveSettings() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/settings/greenit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          estimatedPowerWatts: asPositiveNumber(powerWatts, defaults.estimatedPowerWatts),
          pue: asPositiveNumber(pue, defaults.pue),
          co2FactorKgPerKwh: asPositiveNumber(co2Factor, defaults.co2FactorKgPerKwh),
          electricityPricePerKwh: asPositiveNumber(priceKwh, defaults.electricityPricePerKwh),
          serverTemperatureC: asNumberOrNull(serverTemperatureC),
          outsideTemperatureC: asNumberOrNull(outsideTemperatureC),
          outsideCity: outsideCity.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as SaveResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Impossible d’enregistrer les réglages GreenIT.");
      }
      if (payload.settings) {
        setOutsideCity(payload.settings.outsideCity ?? "");
        setOutsideTemperatureC(
          payload.settings.outsideTemperatureC !== null && payload.settings.outsideTemperatureC !== undefined
            ? String(payload.settings.outsideTemperatureC)
            : "",
        );
      }
      setNotice(payload.message || "Réglages GreenIT enregistrés.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Impossible d’enregistrer GreenIT.");
    } finally {
      setBusy(false);
    }
  }

  async function fetchOutsideWeather() {
    if (!outsideCity.trim()) {
      setError("Renseigne d’abord une ville extérieure.");
      return;
    }
    setWeatherBusy(true);
    setError("");
    setNotice("");
    try {
      const url = new URL("/api/observability/weather", window.location.origin);
      url.searchParams.set("city", outsideCity.trim());
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as WeatherResponse;
      if (!response.ok || !payload.ok || typeof payload.temperatureC !== "number") {
        throw new Error(payload.error || "Température extérieure indisponible.");
      }
      setOutsideCity(payload.city ?? outsideCity.trim());
      setOutsideTemperatureC(String(payload.temperatureC));
      setNotice(`Température extérieure mise à jour${payload.city ? ` pour ${payload.city}` : ""}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Impossible de récupérer la météo.");
    } finally {
      setWeatherBusy(false);
    }
  }

  function resetToDefaults() {
    setPowerWatts(String(defaults.estimatedPowerWatts));
    setPue(String(defaults.pue));
    setCo2Factor(String(defaults.co2FactorKgPerKwh));
    setPriceKwh(String(defaults.electricityPricePerKwh));
    setServerTemperatureC("");
    setOutsideTemperatureC("");
    setOutsideCity("");
    setNotice("");
    setError("");
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{initialSettings ? "Paramètres GreenIT" : "Calibration GreenIT"}</h2>
        <span className="muted">{initialSettings ? "Réglages persistés pour toute l’app" : "Première calibration"}</span>
      </div>

      {error ? (
        <div className="backup-alert error">
          <strong>Erreur</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="backup-alert info">
          <strong>Info</strong>
          <p>{notice}</p>
        </div>
      ) : null}

      <div className="provision-grid">
        <label className="provision-field">
          <span className="provision-field-label">Puissance IT locale (W)</span>
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
          <span className="provision-field-label">Température serveur (°C)</span>
          <input
            className="provision-input"
            value={serverTemperatureC}
            onChange={(event) => setServerTemperatureC(event.target.value)}
            inputMode="decimal"
            placeholder="Laisser vide si une sonde remonte"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Ville extérieure</span>
          <input
            className="provision-input"
            value={outsideCity}
            onChange={(event) => setOutsideCity(event.target.value)}
            placeholder="Paris"
          />
        </label>
        <label className="provision-field">
          <span className="provision-field-label">Température extérieure (°C)</span>
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
            <div className="item-metric">
              {computed.thermalDelta > 0 ? "+" : ""}
              {computed.thermalDelta.toFixed(1)}°C
            </div>
          </article>
        ) : null}
      </div>

      <div className="quick-actions">
        <button type="button" className="action-btn" onClick={fetchOutsideWeather} disabled={weatherBusy}>
          {weatherBusy ? "Lecture météo..." : "Récupérer météo"}
        </button>
        <button type="button" className="action-btn primary" onClick={() => void saveSettings()} disabled={busy}>
          {busy ? "Enregistrement..." : "Enregistrer"}
        </button>
        <button type="button" className="action-btn" onClick={resetToDefaults} disabled={busy || weatherBusy}>
          Réinitialiser
        </button>
      </div>
    </section>
  );
}
