import { deleteRule, errorResponse, readJson, updateRule } from "@/lib/web";

/** PATCH /api/web/rules/:id { status?, name?, hypothesis?, audience?, changes? } → { rule } */
export async function PATCH(req: Request, ctx: RouteContext<"/api/web/rules/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    return Response.json({ rule: updateRule(id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/web/rules/:id → { ok } */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/web/rules/[id]">) {
  const { id } = await ctx.params;
  return deleteRule(id) ? Response.json({ ok: true }) : Response.json({ error: "Rule not found" }, { status: 404 });
}
