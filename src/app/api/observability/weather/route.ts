import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeocodingResponse = {
  results?: Array<{
    name?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
};

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
  };
  current_units?: {
    temperature_2m?: string;
  };
};

function asCity(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return trimmed;
}

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  const city = asCity(request.nextUrl.searchParams.get("city"));
  if (!city) {
    return NextResponse.json({ ok: false, error: "Ville requise." }, { status: 400 });
  }

  try {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", city);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "fr");
    geocodeUrl.searchParams.set("format", "json");

    const geocodeResponse = await fetch(geocodeUrl, { cache: "no-store" });
    const geocodePayload = (await geocodeResponse.json().catch(() => ({}))) as GeocodingResponse;
    const match = Array.isArray(geocodePayload.results) ? geocodePayload.results[0] : null;
    if (!match || typeof match.latitude !== "number" || typeof match.longitude !== "number") {
      throw new Error("Ville introuvable.");
    }

    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(match.latitude));
    forecastUrl.searchParams.set("longitude", String(match.longitude));
    forecastUrl.searchParams.set("current", "temperature_2m");
    forecastUrl.searchParams.set("timezone", "auto");

    const forecastResponse = await fetch(forecastUrl, { cache: "no-store" });
    const forecastPayload = (await forecastResponse.json().catch(() => ({}))) as ForecastResponse;
    const temperatureC = forecastPayload.current?.temperature_2m;
    if (typeof temperatureC !== "number" || !Number.isFinite(temperatureC)) {
      throw new Error("Température indisponible.");
    }

    return NextResponse.json({
      ok: true,
      city: [match.name, match.country].filter(Boolean).join(", "),
      temperatureC,
      unit: forecastPayload.current_units?.temperature_2m ?? "°C",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible de lire la météo.",
      },
      { status: 400 },
    );
  }
}
