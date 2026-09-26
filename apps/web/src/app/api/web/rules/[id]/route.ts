import { deleteRule, errorResponse, getRule, readJson, readSitePage, requestOrigin, siteUrl, updateRule, webState } from "@/lib/web";

/**
 * PATCH /api/web/rules/:id { status?, name?, hypothesis?, audience?, changes? } → { rule }
 * Starting or shipping it checks its copy against the site's page: a claim the page doesn't make is a 422 (store.ts).
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/web/rules/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const site = getRule(id)?.site;
    const outline = site ? await readSitePage(site, siteUrl(site, requestOrigin(req), webState(site).overview.url)) : undefined;
    return Response.json({ rule: updateRule(id, body, { outline }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/web/rules/:id → { ok } */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/web/rules/[id]">) {
  const { id } = await ctx.params;
  return deleteRule(id) ? Response.json({ ok: true }) : Response.json({ error: "Rule not found" }, { status: 404 });
}
