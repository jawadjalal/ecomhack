import { z } from "zod";
import type { CreateTeamChatResponse } from "@/lib/contracts";
import { createUserChat } from "@/lib/team";

const Body = z.object({
  title: z.string().trim().max(80).optional(),
  members: z.array(z.enum(["darwin", "iris", "pixel", "fizz", "dash"])).min(1).max(5),
});

/** POST /api/team/chats { title?, members } → { chat } (admin). Group chats always include Darwin. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Body must be { title?, members: AgentId[] }: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  const chat = createUserChat(parsed.data);
  return Response.json({ chat } satisfies CreateTeamChatResponse);
}
