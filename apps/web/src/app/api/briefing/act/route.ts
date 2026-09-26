import { z } from "zod";
import { actOnBriefing, briefingOrigin, getBriefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";
/** Shipping a store page test promotes the spec and opens a pull request: allow a few seconds. */
export const maxDuration = 60;

const Body = z.object({
  /** An item id from GET /api/briefing, e.g. "agent:at_…", "web:<site>:wr_…", "loop:exp_…". */
  id: z.string().trim().min(3).max(200),
  action: z.enum(["ship", "stop"]),
});

/**
 * POST /api/briefing/act { id, action: "ship" | "stop" } → { ok, text, briefing }
 * The merchant said yes / no to the briefing bot. Always 200 with `ok` (false + a plain-English reason when
 * nothing could be done), so the bot can forward `text` either way; 400 only for a malformed body.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Expected JSON body { "id": "<item id from GET /api/briefing>", "action": "ship" | "stop" }' }, { status: 400 });
  }
  const result = await actOnBriefing(parsed.data.id, parsed.data.action);
  const briefing = await getBriefing({ origin: briefingOrigin(req) });
  return Response.json({ ...result, briefing }, { headers: { "cache-control": "no-store" } });
}
