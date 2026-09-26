import { handleA2aPost } from "@/lib/agent-commerce/a2a";
import { agentCardResponse } from "@/lib/agent-commerce/discovery";
import { CORS_HEADERS, preflight } from "@/lib/agent-commerce/http";

export const dynamic = "force-dynamic";

/** POST /api/a2a: A2A JSON-RPC 2.0 (message/send) with PACE's merchant agent. */
export async function POST(req: Request) {
  const body = await handleA2aPost(await req.text(), req.headers);
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

/** GET /api/a2a: the agent card, for clients that look here instead of /.well-known/agent-card.json. */
export async function GET(req: Request) {
  return agentCardResponse(req);
}

export const OPTIONS = preflight;
