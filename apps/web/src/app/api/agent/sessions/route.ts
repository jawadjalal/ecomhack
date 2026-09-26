import type { AgentSessionsResponse } from "@/lib/contracts";
import { listAgentSessions } from "@/lib/agent-commerce";
import { json, preflight } from "@/lib/agent-commerce/http";

/** GET /api/agent/sessions?limit=20 → AgentSessionsResponse (newest first, max 300). */
export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(raw) ? Math.min(300, Math.max(1, Math.floor(raw))) : 20;
  const body: AgentSessionsResponse = { sessions: listAgentSessions(limit) };
  return json(body);
}

export const OPTIONS = preflight;
