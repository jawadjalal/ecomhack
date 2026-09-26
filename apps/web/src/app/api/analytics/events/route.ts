import type { NextRequest } from "next/server";
import type { AnalyticsEvent, AnalyticsEventsResponse } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
/** Upper bound on events scanned per poll (a huge burst is caught up over a few polls). */
const SCAN_MAX = 20_000;

const list = (v: string | null) =>
  v ? new Set(v.split(",").map((s) => s.trim()).filter(Boolean)) : undefined;

/**
 * GET /api/analytics/events?after=<uuid>&limit=100   live feed, newest last → { events, cursor }
 *
 * Poll with `after=<cursor>`. Without a cursor (or with one that was evicted / reset) you get the
 * latest `limit` events. If more than `limit` events arrived since the cursor, the newest `limit`
 * are returned (a live feed skips ahead instead of lagging). `cursor` is the uuid of the newest
 * event scanned, so filtered polls never rescan.
 *
 * Optional filters: `visitorKind=human|agent`, `events=a,b` (only these), `exclude=$autocapture,…`.
 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const after = sp.get("after") || undefined;
  const limitRaw = Number(sp.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw))) : DEFAULT_LIMIT;
  const kind = sp.get("visitorKind");
  const only = list(sp.get("events"));
  const exclude = list(sp.get("exclude"));
  const filtered = Boolean((kind === "human" || kind === "agent") || only || exclude);

  const store = eventStore();
  // Everything after the cursor (up to SCAN_MAX), or a recent window when there is no cursor.
  const scanned = store.since(after, after ? SCAN_MAX : filtered ? 5000 : limit);

  let events: AnalyticsEvent[] = scanned;
  if (filtered) {
    events = scanned.filter((e) => {
      if ((kind === "human" || kind === "agent") && (e.properties.visitor_kind ?? "human") !== kind) return false;
      if (only && !only.has(e.event)) return false;
      if (exclude?.has(e.event)) return false;
      return true;
    });
  }
  if (events.length > limit) events = events.slice(-limit);

  const cursor = scanned.at(-1)?.uuid ?? after;
  const body: AnalyticsEventsResponse = { events, ...(cursor ? { cursor } : {}) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
