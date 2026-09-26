// GET /api/readiness/certificate/:id → ReadinessCertificate (404 when unknown)
import { getCertificate } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/readiness/certificate/[id]">) {
  const { id } = await ctx.params;
  const cert = getCertificate(id);
  if (!cert) return Response.json({ error: "Certificate not found." }, { status: 404, headers: { "access-control-allow-origin": "*" } });
  return Response.json(cert, { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
