import { briefingOrigin, getBriefing, type Briefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";

/**
 * GET /api/briefing → Briefing { generatedAt, headline, text, ask?, items }
 * Darwin's state in plain English for the merchant's chat bot (admin-gated: Authorization: Bearer <DARWIN_ADMIN_TOKEN>).
 */
export async function GET(req: Request) {
  const briefing = await getBriefing({ origin: briefingOrigin(req) });
  return Response.json(briefing satisfies Briefing, { headers: { "cache-control": "no-store" } });
}
