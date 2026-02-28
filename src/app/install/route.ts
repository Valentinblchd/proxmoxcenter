import { NextRequest, NextResponse } from "next/server";
import { BOOTSTRAP_SCRIPT_TEMPLATE } from "@/lib/install/bootstrap-template";
import { getTrustedOriginForRequest } from "@/lib/security/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = getTrustedOriginForRequest(request) ?? request.nextUrl.origin;
  const installBaseUrl = `${origin}/install-assets`;
  const script = BOOTSTRAP_SCRIPT_TEMPLATE.replaceAll(
    "__PROXMOXCENTER_INSTALL_BASE_URL__",
    installBaseUrl,
  );

  return new NextResponse(script, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
