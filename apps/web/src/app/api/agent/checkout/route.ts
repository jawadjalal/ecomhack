import { preflight, runRestToolFromBody } from "@/lib/agent-commerce/http";

/** POST /api/agent/checkout { maxTotal? (pence) } → AgentToolResult<AgentOrder>. */
export async function POST(req: Request) {
  return runRestToolFromBody(req, "checkout");
}

export const OPTIONS = preflight;
