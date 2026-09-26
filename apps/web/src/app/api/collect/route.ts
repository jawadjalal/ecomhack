import { allowIngest, sanitizeClientEvents } from "@/lib/analytics/trust";
import { z } from "zod";
import type { AnalyticsEventInput } from "@/lib/contracts";
import { classifyVisitor } from "@/lib/analytics/classify";
import { track } from "@/lib/analytics/store";

/**
 * POST /api/collect — cross-origin ingestion for darwin.js running on merchant storefronts.
 *
 * Body: `{ events: [{ event, distinct_id, timestamp?, uuid?, properties? }] }` (same as /api/capture;
 * a bare array or single event is also accepted). Sent as `text/plain` by the tracker so browsers
 * skip the CORS preflight; JSON content types work too. Visitors are classified server-side
 * (human vs AI agent) — whatever the client claims is overwritten.
 */

const MAX_BODY_BYTES = 128 * 1024;
const MAX_EVENTS = 200;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Agent-Name, X-Darwin-Agent",
  "Access-Control-Max-Age": "86400",
};

const EventSchema = z.object({
  event: z.string().min(1).max(200),
  distinct_id: z.string().min(1).max(200),
  timestamp: z.string().max(64).optional(),
  uuid: z.string().max(64).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
const BodySchema = z.object({ events: z.array(EventSchema).min(1).max(MAX_EVENTS) });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

function normalize(raw: unknown): unknown {
  if (Array.isArray(raw)) return { events: raw };
  if (raw && typeof raw === "object" && !("events" in raw) && "event" in raw) return { events: [raw] };
  return raw;
}

/** Trust client timestamps only within a day of server time (clock skew, replayed queues). */
function safeTimestamp(ts: string | undefined, now: number): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && Math.abs(t - now) <= MAX_CLOCK_SKEW_MS ? new Date(t).toISOString() : new Date(now).toISOString();
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes).` }, 413);
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes).` }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON: { events: [...] }" }, 400);
  }
  const parsed = BodySchema.safeParse(normalize(raw));
  if (!parsed.success) return json({ error: z.prettifyError(parsed.error) }, 400);

  const ua = req.headers.get("user-agent");
  const classified = classifyVisitor({
    userAgent: ua,
    declaredAgent: req.headers.get("x-agent-name") ?? req.headers.get("x-darwin-agent"),
  });
  // navigator.webdriver is set by Playwright / Puppeteer / Selenium — how browser-using agents run.
  const automated = classified.kind === "human" && parsed.data.events.some((e) => e.properties.$webdriver === true);
  const kind = automated ? "agent" : classified.kind;
  const agentName = automated ? "automated-browser" : classified.agentName;

  const now = Date.now();
  const events: AnalyticsEventInput[] = parsed.data.events.map((e) => {
    const { agent_name: _claimed, ...props } = e.properties; // eslint-disable-line @typescript-eslint/no-unused-vars
    return {
      event: e.event,
      distinct_id: e.distinct_id,
      uuid: e.uuid,
      timestamp: safeTimestamp(e.timestamp, now),
      properties: {
        $lib: "darwin-js",
        $user_agent: ua ?? undefined,
        ...props,
        // Server-side classification wins over whatever the client claims.
        visitor_kind: kind,
        ...(kind === "agent" && agentName ? { agent_name: agentName } : {}),
      },
    };
  });
  if (!allowIngest(req, events.length)) return json({ error: "Too many events" }, 429);
  // Other sites' events never count towards Darwin's experiments.
  const stored = track(sanitizeClientEvents(events, "external"));
  return json({ ok: true, count: stored.length });
}
