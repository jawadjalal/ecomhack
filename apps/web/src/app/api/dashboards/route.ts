import { eventStore } from "@/lib/analytics/store";
import { z } from "zod";
import { askForChart, computeDashboards, getPlan, removeChart, savePlan } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** GET /api/dashboards?site=… → DashboardsResponse: the dashboards the site's tracking plan asked for, live. */
export function GET(req: Request) {
  const site = new URL(req.url).searchParams.get("site") ?? "";
  if (!/^[\w.-]{1,64}$/.test(site)) return Response.json({ error: "?site= is required" }, { status: 400 });
  return Response.json(computeDashboards(site, getPlan(site), eventStore().all()));
}

const AskSchema = z.union([
  z.object({ site: z.string().regex(/^[\w.-]{1,64}$/), message: z.string().trim().min(2).max(300) }),
  z.object({ site: z.string().regex(/^[\w.-]{1,64}$/), remove: z.string().max(80) }),
]);

/**
 * POST /api/dashboards { site, message } → { plan, reply, id }: ask for a chart in plain English.
 * POST /api/dashboards { site, remove } → { plan }: remove a chart you asked for.
 */
export async function POST(req: Request) {
  const parsed = AskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be { site, message } or { site, remove }" }, { status: 400 });
  const plan = getPlan(parsed.data.site);
  if (!plan) return Response.json({ error: "This store doesn't have a tracking plan yet. Set one up in Setup first." }, { status: 404 });
  if ("remove" in parsed.data) return Response.json({ plan: savePlan(removeChart(plan, parsed.data.remove)) });
  const out = askForChart(plan, parsed.data.message);
  return Response.json({ ...out, plan: savePlan(out.plan) });
}
