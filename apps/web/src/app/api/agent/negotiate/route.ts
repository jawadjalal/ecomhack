import { preflight, runRestToolFromBody } from "@/lib/agent-commerce/http";

/** POST /api/agent/negotiate { id, offer (pence), message? } → AgentToolResult<NegotiationOutcome>. */
export async function POST(req: Request) {
  return runRestToolFromBody(req, "negotiate");
}

export const OPTIONS = preflight;
