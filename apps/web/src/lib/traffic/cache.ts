/**
 * The Traffic page polls every few seconds and every report is a full pass over the event store, so
 * reports are memoised per query for a few seconds, and callers that arrive while one is being built
 * wait for that one instead of starting their own.
 */
import type { AnalyticsEvent } from "@/lib/contracts";
import { computeTrafficReportAsync, type TrafficReport } from "./report";

/** How long a finished report is reused. The page polls every 4 s. */
export const TRAFFIC_REPORT_TTL_MS = 4000;

interface Entry {
  events: readonly AnalyticsEvent[];
  promise: Promise<TrafficReport>;
  /** When the report finished; undefined while it's still being built. */
  doneAt?: number;
}

const g = globalThis as unknown as { __darwinTrafficReports?: Map<string, Entry> };
const cache = () => (g.__darwinTrafficReports ??= new Map());

/**
 * The traffic report for `events`, shared: one build per (site, synthetic) at a time, reused for
 * TRAFFIC_REPORT_TTL_MS after it finishes. A different events array (the store was reset) rebuilds.
 */
export function sharedTrafficReport(events: readonly AnalyticsEvent[], opts: { site?: string; includeSynthetic?: boolean } = {}): Promise<TrafficReport> {
  const site = opts.site && opts.site !== "all" ? opts.site : "all";
  const includeSynthetic = opts.includeSynthetic ?? true;
  const key = `${includeSynthetic ? 1 : 0}|${site}`;
  const reports = cache();
  const now = Date.now();
  for (const [k, e] of reports) if (e.doneAt !== undefined && now - e.doneAt >= TRAFFIC_REPORT_TTL_MS) reports.delete(k);

  const hit = reports.get(key);
  if (hit && hit.events === events) return hit.promise;

  const entry: Entry = { events, promise: computeTrafficReportAsync(events, { site, includeSynthetic }) };
  reports.set(key, entry);
  entry.promise.then(
    () => (entry.doneAt = Date.now()),
    () => reports.get(key) === entry && reports.delete(key),
  );
  return entry.promise;
}

/** Forget every memoised report (tests). */
export function clearTrafficReports() {
  cache().clear();
}
