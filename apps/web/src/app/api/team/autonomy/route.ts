import { z } from "zod";
import { updateAutonomy, watchState } from "@/lib/team";

export const dynamic = "force-dynamic";

const Body = z.object({
  level: z.enum(["off", "suggest", "auto-safe", "autopilot"]).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  quietHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }).optional(),
  enabled: z.boolean().optional(),
  policy: z.string().trim().min(8).max(400).optional(),
  confirmPolicy: z.string().trim().min(3).max(80).optional(),
  removePolicy: z.string().trim().min(3).max(80).optional(),
});

/** GET /api/team/autonomy → the current level, quiet hours and standing policies (admin). */
export async function GET() {
  const state = watchState();
  return Response.json({ settings: state.settings, policies: state.policies }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/team/autonomy. Set the level, compile a plain-English policy (read `compiled` back before it counts),
 * confirm one with `confirmPolicy`, or remove one. Admin.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const res = await updateAutonomy(parsed.data);
  return Response.json(res, { headers: { "cache-control": "no-store" } });
}
