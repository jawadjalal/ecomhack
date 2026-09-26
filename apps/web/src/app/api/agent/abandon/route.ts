import { preflight, runRestToolFromBody } from "@/lib/agent-commerce/http";

/** POST /api/agent/abandon { reason } → records `agent_abandoned` and closes the session. */
export async function POST(req: Request) {
  return runRestToolFromBody(req, "abandon");
}

export const OPTIONS = preflight;
