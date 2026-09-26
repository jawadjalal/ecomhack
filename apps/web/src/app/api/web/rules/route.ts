import { z } from "zod";
import { installSnippet } from "@/lib/github";
import { listPlans } from "@/lib/tracking";
import { createRule, errorResponse, readJson, readSitePage, requestOrigin, SiteSchema, siteUrl, webState } from "@/lib/web";

export const dynamic = "force-dynamic";

/**
 * GET /api/web/rules?site=… → WebRulesResponse: rules, their results, traffic by source, known sites (plans ∪ rules ∪
 * events), and `install`: the darwin.js tag from the same helper onboarding uses.
 * Reads the site's page first (cached 5 min), so live copy it doesn't back up is paused before it's shown.
 */
export async function GET(req: Request) {
  const site = SiteSchema.safeParse(new URL(req.url).searchParams.get("site") ?? "");
  if (!site.success) return Response.json({ error: "?site= is required (the data-darwin-site of your darwin.js tag)" }, { status: 400 });
  await readSitePage(site.data, siteUrl(site.data, requestOrigin(req), webState(site.data).overview.url));
  const plans = listPlans();
  const state = webState(site.data, { planSites: plans.map((p) => p.site) });
  const storeUrl = plans.find((p) => p.site === site.data)?.siteUrl ?? state.overview.url;
  return Response.json({ ...state, install: { ...installSnippet(req, site.data), storeUrl } });
}

const CreateSchema = z.object({ rule: z.unknown(), status: z.enum(["draft", "running"]).default("draft") });

/**
 * POST /api/web/rules { rule: WebRuleDraft, status?: "draft" | "running" } → { rule }
 * Starting it checks its copy against the site's page: a claim the page doesn't make is a 422 (store.ts).
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { rule, status } = CreateSchema.parse(body);
    const site = SiteSchema.safeParse((rule as { site?: unknown } | null)?.site);
    const outline = status === "running" && site.success ? await readSitePage(site.data, siteUrl(site.data, requestOrigin(req), webState(site.data).overview.url)) : undefined;
    return Response.json({ rule: createRule(rule, status, { outline }) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
