import { agentCardResponse } from "@/lib/agent-commerce/discovery";
import { preflight } from "@/lib/agent-commerce/http";

export const dynamic = "force-dynamic";

/** GET /.well-known/agent.json: legacy A2A path, same card as /.well-known/agent-card.json. */
export async function GET(req: Request) {
  return agentCardResponse(req);
}

export const OPTIONS = preflight;
