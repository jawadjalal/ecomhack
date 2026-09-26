import { eventStore } from "@/lib/analytics/store";
import { computeTrafficReport } from "@/lib/traffic";

export const dynamic = "force-dynamic";

/**
 * GET /api/traffic?site=all|<site>&synthetic=1|0 → TrafficReport
 * Where visitors came from (source, referring site, search query, UTM campaign, country, landing page,
 * device) with visitors, human/agent split, conversions and revenue per row. Admin only.
 */
export function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const site = (sp.get("site") ?? "all").slice(0, 100);
  const includeSynthetic = sp.get("synthetic") !== "0";
  return Response.json(computeTrafficReport(eventStore().all(), { site, includeSynthetic }));
}
