// GET /api/readiness/badge/:id → image/svg+xml (grey "unknown" badge with 404 when the id is unknown)
import { badgeSvg, getCertificate } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/readiness/badge/[id]">) {
  const { id } = await ctx.params;
  const cert = getCertificate(id);
  return new Response(badgeSvg(cert), {
    status: cert ? 200 : 404,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      // Opened directly, the SVG can't run script or load anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "access-control-allow-origin": "*",
    },
  });
}
