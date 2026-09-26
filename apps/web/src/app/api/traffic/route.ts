import { eventStore } from "@/lib/analytics/store";
import { sharedTrafficReport } from "@/lib/traffic";

export const dynamic = "force-dynamic";

/**
 * GET /api/traffic?site=all|<site>&synthetic=1|0 → TrafficReport
 * Where visitors came from (source, referring site, search query, UTM campaign, country, landing page,
 * device) with visitors, human/agent split, conversions and revenue per row. Admin only.
 * Memoised per query for a few seconds and shared by concurrent polls (see lib/traffic/cache.ts).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const site = (sp.get("site") ?? "all").slice(0, 100);
  const includeSynthetic = sp.get("synthetic") !== "0";
  return Response.json(await sharedTrafficReport(eventStore().all(), { site, includeSynthetic }));
}
