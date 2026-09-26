import { z } from "zod";
import { errorResponse, listRules, MAX_SIM_VISITORS, readJson, requestOrigin, SiteSchema, simulateWebTraffic, siteUrl, webState } from "@/lib/web";

const SimSchema = z.object({ site: SiteSchema, visitors: z.number().int().min(1).max(MAX_SIM_VISITORS).default(500) });

/**
 * POST /api/web/simulate { site, visitors? } → WebSimulateResponse.
 * Synthetic visitors through the site's live rules. Every event has properties.synthetic = true.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site, visitors } = SimSchema.parse(body);
    const url = siteUrl(site, requestOrigin(req), webState(site).overview.url) ?? `https://${site}/`;
    return Response.json(simulateWebTraffic({ site, visitors, rules: listRules(site), url }));
  } catch (err) {
    return errorResponse(err);
  }
}
