import { preflight, runRestTool, runRestToolFromBody } from "@/lib/agent-commerce/http";

/** POST /api/agent/cart { id, size, quantity } → AgentToolResult<CartView> (add_to_cart). */
export async function POST(req: Request) {
  return runRestToolFromBody(req, "add_to_cart");
}

/** GET /api/agent/cart → AgentToolResult<CartView> (get_cart). */
export async function GET(req: Request) {
  return runRestTool(req, "get_cart", {});
}

export const OPTIONS = preflight;
