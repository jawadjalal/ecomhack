import { z } from "zod";
import type { AnalyticsEventInput } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { bearer, isAdminCredential, ADMIN_COOKIE } from "@/lib/auth/admin";
import { getLiveSpec } from "@/lib/spec/store";

/**
 * POST /api/simulate/events: synthetic traffic from a seed script for a store Darwin didn't build
 * (e.g. `apple-site/seed/seed.mjs`), so Issues / Traffic light up before any real visitor arrives.
 *
 * Why this exists: the public ingest routes (/api/collect, /api/capture, /ingest) are for real browsers,
 * so they force `synthetic: false`. A seed script needs the opposite guarantee: everything it sends is
 * labelled simulated. This route therefore
 *   - ALWAYS stamps `properties.synthetic = true` (a client can't use it to fake real results),
 *   - trusts `visitor_kind` / `agent_name` (they only describe simulated visitors),
 *   - drops `experiment_id` / `variant` (seeded visitors never count towards Darwin's A/B tests),
 *   - keeps an integer `spec_version` (the config version the modelled site is on) or uses the live one.
 * It's admin-gated like the rest of /api/simulate (`Authorization: Bearer <DARWIN_ADMIN_TOKEN>` when a token is set).
 */

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const EventSchema = z.object({
  event: z.string().min(1).max(200),
  distinct_id: z.string().min(1).max(200),
  timestamp: z.string().max(64).optional(),
  uuid: z.string().max(64).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
const BodySchema = z.object({ events: z.array(EventSchema).min(1).max(MAX_EVENTS) });

function safeTimestamp(ts: string | undefined, now: number): string {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) && t <= now + 60_000 && now - t <= MAX_AGE_MS ? new Date(t).toISOString() : new Date(now).toISOString();
}

export async function POST(req: Request) {
  const credential = bearer(req.headers.get("authorization")) ?? cookieValue(req.headers.get("cookie"), ADMIN_COOKIE);
  if (!isAdminCredential(credential)) {
    return Response.json({ error: "Unauthorized: send Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "Body must be JSON: { events: [...] }" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const now = Date.now();
  const liveVersion = getLiveSpec().version;
  const events: AnalyticsEventInput[] = parsed.data.events.map((e) => {
    const { experiment_id: _e, variant: _v, synthetic: _s, spec_version, visitor_kind, agent_name, ...props } = e.properties; // eslint-disable-line @typescript-eslint/no-unused-vars
    const kind = visitor_kind === "agent" ? "agent" : "human";
    return {
      event: e.event,
      distinct_id: e.distinct_id,
      uuid: e.uuid,
      timestamp: safeTimestamp(e.timestamp, now),
      properties: {
        $lib: "darwin-seed",
        persona: "seed",
        ...props,
        visitor_kind: kind,
        ...(kind === "agent" && typeof agent_name === "string" && agent_name ? { agent_name: agent_name.slice(0, 80) } : {}),
        spec_version: Number.isInteger(spec_version) && (spec_version as number) >= 0 ? (spec_version as number) : liveVersion,
        synthetic: true,
      },
    };
  });
  const stored = track(events);
  return Response.json({ ok: true, count: stored.length, synthetic: true });
}

function cookieValue(header: string | null, name: string): string | undefined {
  const m = header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}
