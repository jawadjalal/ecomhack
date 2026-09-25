import { agentCardResponse } from "@/lib/agent-commerce/discovery";
import { preflight } from "@/lib/agent-commerce/http";

export const dynamic = "force-dynamic";

/** GET /.well-known/agent-card.json: A2A-style agent card for the store's merchant agent. */
export async function GET(req: Request) {
  return agentCardResponse(req);
}

export const OPTIONS = preflight;
