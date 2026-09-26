import { z } from "zod";
import { errorResponse, listRules, MAX_SIM_VISITORS, pageOutline, readJson, requestOrigin, SiteSchema, simulateWebTraffic, siteUrl, webState } from "@/lib/web";

const SimSchema = z.object({
  site: SiteSchema,
  visitors: z.number().int().min(1).max(MAX_SIM_VISITORS).default(500),
  /** Custom events the store sends (a tracking plan's goals), so simulated visitors send them too. */
  events: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,39}$/))
    .max(12)
    .optional(),
});

/**
 * POST /api/web/simulate { site, visitors? } → WebSimulateResponse.
 * Synthetic visitors through the site's live rules. Every event has properties.synthetic = true.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site, visitors, events } = SimSchema.parse(body);
    const url = siteUrl(site, requestOrigin(req), webState(site).overview.url) ?? `https://${site}/`;
    const outline = await pageOutline(url); // cached 5 min; lets simulated visitors click real elements
    return Response.json(simulateWebTraffic({ site, visitors, rules: listRules(site), url, outline, extraEvents: events }));
  } catch (err) {
    return errorResponse(err);
  }
}
