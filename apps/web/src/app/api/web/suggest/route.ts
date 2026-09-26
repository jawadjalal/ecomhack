import { z } from "zod";
import { errorResponse, readJson, readSitePage, requestOrigin, SiteSchema, siteUrl, suggestRules, webState } from "@/lib/web";

/** POST /api/web/suggest { site } → { rules: WebRuleDraft[] }: one playbook idea per source, biggest gap first. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site } = z.object({ site: SiteSchema }).parse(body);
    const { overview } = webState(site);
    const outline = await readSitePage(site, siteUrl(site, requestOrigin(req), overview.url));
    return Response.json({ rules: suggestRules(site, overview, outline) });
  } catch (err) {
    return errorResponse(err);
  }
}
