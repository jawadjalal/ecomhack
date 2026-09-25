import { preflight, runRestTool } from "@/lib/agent-commerce/http";

/** GET /api/agent/products/:id?want=a,b → AgentToolResult<AgentProductDetail> (get_product). */
export async function GET(req: Request, ctx: RouteContext<"/api/agent/products/[id]">) {
  const { id } = await ctx.params;
  const want = new URL(req.url).searchParams.getAll("want").join(",");
  return runRestTool(req, "get_product", { id, ...(want ? { want } : {}) });
}

export const OPTIONS = preflight;
