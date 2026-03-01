import { NextRequest } from "next/server";
import { consumeStagedRestorePayload } from "@/lib/backups/restore-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ token: string }>;
};

async function getParams(context: RouteContext): Promise<{ token: string }> {
  return await context.params;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await getParams(context);
  const staged = consumeStagedRestorePayload(token);
  if (!staged) {
    return new Response("Stage backup introuvable ou expiré.", { status: 404 });
  }

  return new Response(Buffer.from(staged.bytes), {
    status: 200,
    headers: {
      "content-type": staged.contentType || "application/octet-stream",
      "content-length": String(staged.bytes.byteLength),
      "content-disposition": `attachment; filename="${encodeURIComponent(staged.filename)}"`,
      "cache-control": "no-store",
    },
  });
}
