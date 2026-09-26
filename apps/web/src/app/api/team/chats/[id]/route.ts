import { chatView } from "@/lib/team";

export const dynamic = "force-dynamic";

/** GET /api/team/chats/[id] → TeamChatResponse { chat, messages } (marks the chat read) (admin). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = chatView(id);
  if (!view) return Response.json({ error: `Chat ${id} not found.` }, { status: 404 });
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
