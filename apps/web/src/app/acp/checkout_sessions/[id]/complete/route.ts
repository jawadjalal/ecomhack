import { acpHttp, acpPreflight } from "@/lib/store-agent/acp";

export const dynamic = "force-dynamic";

/**
 * POST /acp/checkout_sessions/:id/complete — demo catalog: records a labelled, simulated payment → "completed"
 * with an order. Real Whop store: "in_progress" with a `payment` link to a Whop checkout tagged with the session.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return acpHttp(req, "complete", (await ctx.params).id);
}

export const OPTIONS = acpPreflight;
