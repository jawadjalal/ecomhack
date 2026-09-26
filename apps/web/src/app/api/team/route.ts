import { teamState } from "@/lib/team";

export const dynamic = "force-dynamic";

/** GET /api/team → TeamStateResponse { agents (with tools), chats (last message + unread), model } (admin). */
export async function GET() {
  return Response.json(teamState(), { headers: { "cache-control": "no-store" } });
}
