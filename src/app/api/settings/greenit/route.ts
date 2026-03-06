import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { appendAuditLogEntry, buildAuditActor } from "@/lib/audit/runtime-log";
import { readRuntimeGreenItConfig, writeRuntimeGreenItConfig } from "@/lib/greenit/runtime-config";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ensureSameOriginRequest, getClientIp } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GREENIT_MUTATION_LIMIT = {
  windowMs: 10 * 60_000,
  max: 20,
  blockMs: 15 * 60_000,
} as const;

type Body = {
  estimatedPowerWatts?: unknown;
  pue?: unknown;
  co2FactorKgPerKwh?: unknown;
  electricityPricePerKwh?: unknown;
  serverTemperatureC?: unknown;
  outsideTemperatureC?: unknown;
  outsideCity?: unknown;
};

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  return NextResponse.json({
    ok: true,
    settings: readRuntimeGreenItConfig(),
  });
}

export async function POST(request: NextRequest) {
  const capability = await requireRequestCapability(request, "operate");
  if (!capability.ok) {
    return capability.response;
  }

  const originCheck = ensureSameOriginRequest(request);
  if (!originCheck.ok) {
    return NextResponse.json({ ok: false, error: "Forbidden: origine invalide." }, { status: 403 });
  }

  const gate = consumeRateLimit(`settings:greenit:${getClientIp(request)}`, GREENIT_MUTATION_LIMIT);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: "Trop de modifications GreenIT. Réessaie plus tard." }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  try {
    const previous = readRuntimeGreenItConfig();
    const saved = writeRuntimeGreenItConfig({
      ...body,
      updatedAt: new Date().toISOString(),
    });

    appendAuditLogEntry({
      severity: "info",
      category: "observability",
      action: "greenit.settings",
      summary: "Réglages GreenIT mis à jour",
      actor: buildAuditActor(capability.session),
      targetType: "greenit",
      targetId: "settings",
      targetLabel: "GreenIT",
      changes: [
        {
          field: "estimatedPowerWatts",
          before: previous?.estimatedPowerWatts === null || previous?.estimatedPowerWatts === undefined ? null : String(previous.estimatedPowerWatts),
          after: saved.estimatedPowerWatts === null ? null : String(saved.estimatedPowerWatts),
        },
        {
          field: "outsideCity",
          before: previous?.outsideCity ?? null,
          after: saved.outsideCity ?? null,
        },
        {
          field: "outsideTemperatureC",
          before: previous?.outsideTemperatureC === null || previous?.outsideTemperatureC === undefined ? null : String(previous.outsideTemperatureC),
          after: saved.outsideTemperatureC === null ? null : String(saved.outsideTemperatureC),
        },
      ],
      details: {
        pue: String(saved.pue),
        co2FactorKgPerKwh: String(saved.co2FactorKgPerKwh),
        electricityPricePerKwh: String(saved.electricityPricePerKwh),
      },
    });

    return NextResponse.json({
      ok: true,
      settings: saved,
      message: "Réglages GreenIT enregistrés.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Impossible d’enregistrer GreenIT.",
      },
      { status: 400 },
    );
  }
}
