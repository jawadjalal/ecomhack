import { z } from "zod";
import { draftRule, errorResponse, readJson, requestOrigin, SiteSchema, siteUrl, webState } from "@/lib/web";

const DraftSchema = z.object({
  site: SiteSchema,
  prompt: z.string().trim().min(3).max(1000),
  /** The page to ground selectors in. Defaults to the latest page seen on the site. */
  url: z.string().trim().max(2000).optional(),
});

/** POST /api/web/draft { site, prompt, url? } → WebDraftResponse. Not saved: the merchant reviews it first. */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site, prompt, url } = DraftSchema.parse(body);
    const origin = requestOrigin(req);
    const page = url ? new URL(url, origin).href : siteUrl(site, origin, webState(site).overview.url);
    return Response.json(await draftRule(site, prompt, { url: page }));
  } catch (err) {
    return errorResponse(err);
  }
}
