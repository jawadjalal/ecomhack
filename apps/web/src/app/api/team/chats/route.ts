import { z } from "zod";
import { AGENT_IDS } from "@/lib/contracts/team";
import { createUserChat } from "@/lib/team";

const Body = z.object({
  title: z.string().trim().max(80).optional(),
  members: z.array(z.enum(AGENT_IDS as [string, ...string[]])).min(1).max(5),
});

/** POST /api/team/chats { title?, members } → Chat. One member = the direct chat; several = a new group chat (admin). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Body must be { title?, members: AgentId[] }: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  try {
    return Response.json(createUserChat(parsed.data as Parameters<typeof createUserChat>[0]), { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
