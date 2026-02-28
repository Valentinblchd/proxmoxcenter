import { NextRequest, NextResponse } from "next/server";
import { proxmoxRequest } from "@/lib/proxmox/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProxmoxTaskStatus = {
  status?: string;
  exitstatus?: string;
  type?: string;
  upid?: string;
};

export async function GET(request: NextRequest) {
  const node = request.nextUrl.searchParams.get("node")?.trim();
  const upid = request.nextUrl.searchParams.get("upid")?.trim();

  if (!node || !upid) {
    return NextResponse.json(
      { error: "Missing query params: node, upid." },
      { status: 400 },
    );
  }

  try {
    const data = await proxmoxRequest<ProxmoxTaskStatus>(
      `nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    );

    return NextResponse.json({
      ok: true,
      data,
      done: data?.status === "stopped",
      success: data?.status === "stopped" ? data?.exitstatus === "OK" : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
