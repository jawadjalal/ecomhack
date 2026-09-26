import { z } from "zod";
import type { AssistantResponse } from "@/lib/contracts";
import { runAssistant } from "@/lib/assistant/agent";
import { publicOrigin } from "@/lib/github";

/** A turn can step the loop (simulated traffic) or audit a store: allow a little time. */
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(60)
    .default([]),
  confirm: z
    .object({
      tool: z.string().min(1).max(60),
      args: z.record(z.string(), z.unknown()).optional(),
      approved: z.boolean(),
    })
    .optional(),
  context: z
    .object({
      path: z.string().max(200).optional(),
      site: z.string().regex(/^[\w.-]{1,64}$/).optional(),
    })
    .optional(),
});

/**
 * POST /api/assistant { messages, confirm?, context? } → AssistantResponse (admin: see lib/auth/admin.ts).
 * Darwin, the merchant's managing assistant. Side-effecting tools come back as `pendingConfirm` and only
 * run when the merchant sends `confirm: { tool, args, approved: true }`.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Body must be { messages: [{ role, content }], confirm?, context? }: ${z.prettifyError(parsed.error)}` }, { status: 400 });
  }
  if (!parsed.data.confirm && !parsed.data.messages.some((m) => m.role === "user" && m.content.trim())) {
    return Response.json({ error: "Send at least one user message (or a confirm)." }, { status: 400 });
  }
  try {
    const res = await runAssistant({ ...parsed.data, origin: publicOrigin(req) });
    return Response.json(res satisfies AssistantResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[assistant] turn failed", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
