import { z } from "zod";
import { publicOrigin } from "@/lib/github";
import { receive } from "@/lib/team";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().trim().min(3).max(80).optional(),
  text: z.string().trim().max(500).optional(),
  approved: z.boolean().optional(),
});

/**
 * POST /api/team/channels/reply { token? , text? , approved? } → { ok, text } (admin).
 * A reply from Slack, Discord, email or the Grok bot. Same confirm gate as a tap.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  if (!parsed.data.token && !parsed.data.text) return Response.json({ error: "Send a token or the merchant's reply." }, { status: 400 });
  const res = await receive(parsed.data, { origin: publicOrigin(req) });
  return Response.json(res);
}
