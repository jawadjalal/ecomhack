import type { TeamStateResponse } from "@/lib/contracts";
import { getTeamState } from "@/lib/team";

/** GET /api/team → { agents, chats (with lastMessage, messageCount), model } (admin). */
export async function GET() {
  return Response.json(getTeamState() satisfies TeamStateResponse, { headers: { "cache-control": "no-store" } });
}
