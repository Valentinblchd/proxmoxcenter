import { NextResponse } from "next/server";
import { buildGreenItAdvisor, buildSecurityAdvisor } from "@/lib/insights/advisor";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getDashboardSnapshot();
  const security = buildSecurityAdvisor(snapshot);
  const greenit = buildGreenItAdvisor(snapshot);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    snapshot: {
      mode: snapshot.mode,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      summary: snapshot.summary,
      warnings: snapshot.warnings,
    },
    advisors: {
      security,
      greenit,
    },
  });
}
