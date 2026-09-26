/**
 * Events that arrive over HTTP from browsers (/api/capture, /ingest, /api/collect) are untrusted:
 * anyone can POST them. Before they reach the store we
 *   - drop client claims that decide results: `synthetic`, `experiment_id`, `variant`, `spec_version`,
 *   - re-derive experiment attribution server-side from the visitor id (storefront events only;
 *     events from other sites never count towards our experiments),
 *   - rate-limit per client IP.
 * In-process writers (simulator, agent tools) are trusted and don't go through here.
 */
import type { AnalyticsEventInput } from "@/lib/contracts";
import { attributionProps, resolveSpecForVisitor } from "@/lib/spec/resolve";

const CLAIMS = ["synthetic", "experiment_id", "variant", "spec_version"] as const;

export type IngestSource = "storefront" | "external";

export function sanitizeClientEvents(events: AnalyticsEventInput[], source: IngestSource): AnalyticsEventInput[] {
  const attribution = new Map<string, Record<string, unknown>>();
  return events.map((e) => {
    const props = { ...(e.properties ?? {}) } as Record<string, unknown>;
    for (const k of CLAIMS) delete props[k];
    if (source === "storefront" && e.distinct_id) {
      let attr = attribution.get(e.distinct_id);
      if (!attr) {
        attr = attributionProps(resolveSpecForVisitor(e.distinct_id)) as Record<string, unknown>;
        attribution.set(e.distinct_id, attr);
      }
      Object.assign(props, attr);
    }
    return { ...e, properties: { ...props, synthetic: false } } as AnalyticsEventInput;
  });
}

const WINDOW_MS = 60_000;
/** Events per client IP per minute. A real shopper sends a few dozen; a posthog-js flush up to ~100. */
export const MAX_EVENTS_PER_MINUTE = Number(process.env.DARWIN_INGEST_RATE || 600);

const g = globalThis as unknown as { __darwinIngestRate?: Map<string, { start: number; count: number }> };

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** Count `n` events against the caller's budget. Returns false when over the limit (drop the batch). */
export function allowIngest(req: Request, n: number, now = Date.now()): boolean {
  const map = (g.__darwinIngestRate ??= new Map());
  const key = clientIp(req);
  const cur = map.get(key);
  const bucket = cur && now - cur.start < WINDOW_MS ? cur : { start: now, count: 0 };
  if (bucket.count + n > MAX_EVENTS_PER_MINUTE) return false;
  bucket.count += n;
  map.set(key, bucket);
  if (map.size > 10_000) map.delete(map.keys().next().value!);
  return true;
}

export function resetIngestRate() {
  g.__darwinIngestRate?.clear();
}
