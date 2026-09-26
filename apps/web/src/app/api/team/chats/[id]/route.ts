import type { TeamChatResponse } from "@/lib/contracts";
import { getChatView } from "@/lib/team";

/** GET /api/team/chats/[id] → { chat, messages } (404 { error } when unknown) (admin). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = getChatView(id);
  if (!view) return Response.json({ error: "Unknown chat" }, { status: 404 });
  return Response.json(view satisfies TeamChatResponse, { headers: { "cache-control": "no-store" } });
}
