import { inboxView } from "@/lib/team";

export const dynamic = "force-dynamic";

/**
 * GET /api/team/inbox?since=<iso>&limit=<n> → TeamInboxResponse (admin).
 * What the Grok bot reads: Darwin's proactive messages, newest last, with one-tap action tokens still open.
 * Reply by POSTing /api/team/chat `{ confirm: { id: <token>, approved: true } }`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? undefined;
  const limit = Number(url.searchParams.get("limit"));
  return Response.json(inboxView({ since, ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(50, limit) } : {}) }), {
    headers: { "cache-control": "no-store" },
  });
}
