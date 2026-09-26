import { z } from "zod";
import { allowIngest } from "@/lib/analytics/trust";
import { recordDemoPayment } from "@/lib/store-agent";

/**
 * POST /api/store-agent/demo-pay { offer, ref } — the demo checkout's Pay button: a labelled, simulated payment.
 * One paid order per ref: paying again answers 200 { ok, alreadyPaid: true, title } and records nothing.
 */
export async function POST(req: Request) {
  const parsed = z.object({ offer: z.string().max(80), ref: z.string().max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be { offer, ref }" }, { status: 400 });
  if (!allowIngest(req, 1)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const out = recordDemoPayment(parsed.data.offer, parsed.data.ref, false, { exclusive: true });
  return out.ok ? Response.json(out) : Response.json({ error: "Unknown offer or reference" }, { status: 404 });
}
