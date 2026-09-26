import { getReport } from "@/lib/research";

export const dynamic = "force-dynamic";

/** GET /api/research/[id] → ResearchReport. */
export async function GET(_req: Request, ctx: RouteContext<"/api/research/[id]">) {
  const { id } = await ctx.params;
  const report = getReport(id);
  return report ? Response.json(report) : Response.json({ error: "Report not found" }, { status: 404 });
}
