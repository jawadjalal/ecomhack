import { z } from "zod";
import { errorResponse, readJson, readSitePage, requestOrigin, retractUnbackedCopy, setAutopilot, SiteSchema, siteUrl, webState } from "@/lib/web";

/**
 * POST /api/web/autopilot { site, on } → WebAutopilotState
 * Either way, live copy that states something the page doesn't (a made-up rating, say) is paused, whoever wrote it.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site, on } = z.object({ site: SiteSchema, on: z.boolean() }).parse(body);
    setAutopilot(site, on);
    const outline = await readSitePage(site, siteUrl(site, requestOrigin(req), webState(site).overview.url)); // cached 5 min
    return Response.json(retractUnbackedCopy(site, outline));
  } catch (err) {
    return errorResponse(err);
  }
}
