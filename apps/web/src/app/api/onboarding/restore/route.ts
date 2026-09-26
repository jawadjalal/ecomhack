import { z } from "zod";
import { restorePlan, TrackingPlanSchema } from "@/lib/tracking";

const MAX_BODY = 64_000;

/**
 * POST /api/onboarding/restore { plan } → { restored, plan }
 * The browser's copy of a tracking plan (lib/tracking/remember.ts), sent back when this server instance has
 * none for the site (Vercel runs several, each with its own memory). Saved only when the server has no plan
 * for plan.site; otherwise the server's plan wins and is returned. Admin-gated like the other onboarding routes.
 */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "Body too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Body must be JSON: { plan }" }, { status: 400 });
  }
  const parsed = z.strictObject({ plan: TrackingPlanSchema }).safeParse(raw);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  return Response.json(restorePlan(parsed.data.plan));
}
