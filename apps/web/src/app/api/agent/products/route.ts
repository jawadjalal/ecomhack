import { preflight, runRestTool } from "@/lib/agent-commerce/http";

/**
 * GET /api/agent/products?query=&category=&maxPrice=&size=&terrain=&want=a,b
 * → AgentToolResult<AgentProduct[]> (search_products).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const args: Record<string, unknown> = {};
  const query = q.get("query") ?? q.get("q");
  if (query) args.query = query;
  for (const key of ["category", "maxPrice", "size", "terrain"]) {
    const v = q.get(key);
    if (v) args[key] = v;
  }
  const want = q.getAll("want").join(",");
  if (want) args.want = want;
  return runRestTool(req, "search_products", args);
}

export const OPTIONS = preflight;
