import { z } from "zod";
import { errorResponse, pageOutline, readJson, requestOrigin, SiteSchema, siteUrl, stepAutopilot, webState } from "@/lib/web";

/**
 * POST /api/web/autopilot/step { site } → { state, actions }
 * Decide running tests (ship / stop) and start new ones where the conversion gap is biggest.
 * The console calls this every few seconds while autopilot is on.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site } = z.object({ site: SiteSchema }).parse(body);
    const outline = await pageOutline(siteUrl(site, requestOrigin(req), webState(site).overview.url)); // cached 5 min
    return Response.json(stepAutopilot(site, outline));
  } catch (err) {
    return errorResponse(err);
  }
}
