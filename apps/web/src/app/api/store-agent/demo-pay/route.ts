import { z } from "zod";
import { allowIngest } from "@/lib/analytics/trust";
import { recordDemoPayment } from "@/lib/store-agent";

/**
 * POST /api/store-agent/demo-pay { offer, ref } — the demo checkout's Pay button: a labelled, simulated payment.
 * Only for a checkout the store agent opened: the ref must have started a checkout for this offer, else 404.
 * One paid order per ref: paying again answers 200 { ok, alreadyPaid: true, title } and records nothing.
 */
export async function POST(req: Request) {
  const parsed = z.object({ offer: z.string().max(80), ref: z.string().max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be { offer, ref }" }, { status: 400 });
  if (!allowIngest(req, 1)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const out = recordDemoPayment(parsed.data.offer, parsed.data.ref, false, { exclusive: true });
  if (out.ok) return Response.json(out);
  const error =
    out.error === "no_checkout"
      ? "No checkout was started for this reference and offer. Pay from the checkout link the store agent gave you."
      : "Unknown offer or reference";
  return Response.json({ error }, { status: 404 });
}
