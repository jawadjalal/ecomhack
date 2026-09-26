import { eventStore } from "@/lib/analytics/store";
import { sharedTrafficReport } from "@/lib/traffic";
import { listPlans } from "@/lib/tracking";
import { listRules, siteDirectory } from "@/lib/web";

export const dynamic = "force-dynamic";

/**
 * GET /api/traffic?site=all|<site>&synthetic=1|0 → TrafficReport
 * Where visitors came from (source, referring site, search query, UTM campaign, country, landing page,
 * device) with visitors, human/agent split, conversions and revenue per row. Admin only.
 * `sites` is every site Darwin knows (tracking plans ∪ web rules ∪ sites with events), for the site picker.
 * Memoised per query for a few seconds and shared by concurrent polls (see lib/traffic/cache.ts).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const site = (sp.get("site") ?? "all").slice(0, 100);
  const includeSynthetic = sp.get("synthetic") !== "0";
  const report = await sharedTrafficReport(eventStore().all(), { site, includeSynthetic });
  // The site picker lists every site Darwin knows (same list as Personalize): plans ∪ rules ∪ sites with events.
  const sites = siteDirectory({ plans: listPlans().map((p) => p.site), rules: listRules(), extra: report.sites });
  return Response.json({ ...report, sites });
}
