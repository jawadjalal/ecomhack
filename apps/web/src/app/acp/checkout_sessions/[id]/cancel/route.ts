import { acpHttp, acpPreflight } from "@/lib/store-agent/acp";

export const dynamic = "force-dynamic";

/** POST /acp/checkout_sessions/:id/cancel — cancel (405 once completed or canceled). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return acpHttp(req, "cancel", (await ctx.params).id);
}

export const OPTIONS = acpPreflight;
