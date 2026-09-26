import { eventStore } from "@/lib/analytics/store";
import { computeDashboards, getPlan } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** GET /api/dashboards?site=… → DashboardsResponse: the dashboards the site's tracking plan asked for, live. */
export function GET(req: Request) {
  const site = new URL(req.url).searchParams.get("site") ?? "";
  if (!/^[\w.-]{1,64}$/.test(site)) return Response.json({ error: "?site= is required" }, { status: 400 });
  return Response.json(computeDashboards(site, getPlan(site), eventStore().all()));
}
