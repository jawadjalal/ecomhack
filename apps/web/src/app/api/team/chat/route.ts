import { z } from "zod";
import type { TeamEvent } from "@/lib/contracts";
import { publicOrigin } from "@/lib/github";
import { runTeamTurn } from "@/lib/team";

/** Specialists may step the loop, audit stores or edit code: allow time. */
export const maxDuration = 300;

const Body = z
  .object({
    chatId: z.string().max(60).optional(),
    agentId: z.enum(["darwin", "iris", "pixel", "fizz", "dash"]).optional(),
    text: z.string().max(4000).default(""),
    confirm: z.object({ id: z.string().min(1).max(60), approved: z.boolean() }).optional(),
    context: z.object({ path: z.string().max(200).optional() }).optional(),
  })
  .refine((b) => b.confirm || b.text.trim(), { message: "Send text (or a confirm)." });

/**
 * POST /api/team/chat { chatId?, agentId?, text, confirm?, context? } → NDJSON stream of TeamEvent (admin).
 * Message events upsert by message id (a confirm answer re-sends the confirm message with `resolved`).
 * The stream always ends with a `done` event.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const origin = publicOrigin(req);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: TeamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      await runTeamTurn({ ...parsed.data, origin }, emit);
      open = false;
      try {
        controller.close();
      } catch {
        /* already closed by the client */
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
