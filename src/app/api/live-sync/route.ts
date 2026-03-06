import { NextRequest, NextResponse } from "next/server";
import { requireRequestCapability } from "@/lib/auth/authz";
import { getDashboardSnapshot } from "@/lib/proxmox/dashboard";
import { getLiveSyncOverview } from "@/lib/proxmox/live-sync-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const capability = await requireRequestCapability(request, "read");
  if (!capability.ok) {
    return capability.response;
  }

  if (request.nextUrl.searchParams.get("refresh") !== "0") {
    await getDashboardSnapshot();
  }

  return NextResponse.json(getLiveSyncOverview());
}
