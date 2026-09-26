import { z } from "zod";
import { AGENT_IDS, type TeamEvent } from "@/lib/contracts/team";
import { publicOrigin } from "@/lib/github";
import { TeamError, runTeamTurn } from "@/lib/team";

/** A turn can delegate to several agents that step the loop, audit stores or open PRs. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const Body = z
  .object({
    chatId: z.string().trim().max(80).optional(),
    agentId: z.enum(AGENT_IDS as [string, ...string[]]).optional(),
    text: z.string().max(4000).default(""),
    confirm: z.object({ id: z.string().trim().min(3).max(80), approved: z.boolean() }).optional(),
    context: z.object({ path: z.string().max(200).optional() }).optional(),
  })
  .refine((b) => b.confirm || b.text.trim(), { message: "Send text (or a confirm)." });

/**
 * POST /api/team/chat { chatId?, agentId?, text, confirm?, context? } → application/x-ndjson stream of TeamEvent,
 * one JSON object per line, always ending with { type: "done" } (admin: see lib/auth/admin.ts).
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const input = { ...parsed.data, agentId: parsed.data.agentId as (typeof AGENT_IDS)[number] | undefined, origin: publicOrigin(req) };
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TeamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // client went away; the turn still finishes and is persisted
        }
      };
      try {
        await runTeamTurn(input, emit);
      } catch (err) {
        const status = err instanceof TeamError ? err.status : 500;
        emit({ type: "done", chatId: input.chatId ?? "", model: "heuristic", error: `${status}: ${err instanceof Error ? err.message : String(err)}` });
      }
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
