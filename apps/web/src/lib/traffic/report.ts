/**
 * "Our own Google Analytics": where visitors came from and whether they bought, from one pass over
 * the event stream. First touch per visitor = their first page view (or first event, for agents
 * that only ever call the API).
 *
 * Honesty rules:
 * - Google/Bing don't pass organic search terms any more, so a search visitor without utm_term/q
 *   is counted under "(not provided)", never guessed.
 * - Simulated visitors are counted separately (`synthetic`) and can be excluded.
 */
import type { AnalyticsEvent, TrafficSource } from "@/lib/contracts";
import { normalizePath } from "@/lib/analytics/summary";
import { classifySource } from "@/lib/web/segment";
import { countryFlag, countryName, simulatedCountry } from "./geo";
import { hostOf, referrerName, utmSourceName } from "./referrers";

export const TRAFFIC_DIMENSIONS = ["source", "referrer", "query", "campaign", "country", "landing", "device"] as const;
export type TrafficDimension = (typeof TRAFFIC_DIMENSIONS)[number];

export interface TrafficRow {
  key: string;
  label: string;
  visitors: number;
  humans: number;
  agents: number;
  conversions: number;
  conversionRate: number;
  /** Pence. */
  revenue: number;
  synthetic: number;
}

export interface TrafficTotals {
  visitors: number;
  humans: number;
  agents: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
  synthetic: number;
  countries: number;
  /** Search-engine visitors whose search terms the engine didn't pass on. */
  notProvided: number;
}

export interface TrafficReport {
  generatedAt: string;
  /** Site filter applied ("all" = every site). */
  site: string;
  includeSynthetic: boolean;
  /** Sites seen in the stream ("pace-store" = the built-in demo store). */
  sites: string[];
  totals: TrafficTotals;
  dimensions: Record<TrafficDimension, TrafficRow[]>;
}

export const DEMO_STORE_SITE = "pace-store";
export const NOT_PROVIDED = "(not provided)";
const ROW_LIMIT = 12;

const PREVIEW = /[?&](darwin_(source|variant|q|preview)|preview|previewSpec|variant)=/;

interface Touch {
  kind: "human" | "agent";
  synthetic: boolean;
  source: TrafficSource;
  referrer: { key: string; label: string };
  query?: string;
  campaign?: string;
  country: string;
  landing: string;
  device: string;
  converted: boolean;
  revenue: number;
  /** Seen a page view yet (agents may never send one). */
  landed: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function params(url: string | undefined): URLSearchParams {
  try {
    return url ? new URL(url).searchParams : new URLSearchParams();
  } catch {
    return new URLSearchParams();
  }
}

function firstTouch(e: AnalyticsEvent): Omit<Touch, "converted" | "revenue"> {
  const p = e.properties ?? {};
  const url = str(p.$current_url);
  const referrerUrl = str(p.$referrer);
  const kind = p.visitor_kind === "agent" ? "agent" : "human";
  const seg = classifySource({ url, referrer: referrerUrl });
  const sp = params(url);

  let refHost = hostOf(referrerUrl);
  if (refHost && refHost === hostOf(url)) refHost = ""; // internal navigation isn't a referrer
  const utmSource = sp.get("utm_source") ?? "";
  const referrer = refHost
    ? { key: `ref:${referrerName(refHost)}`, label: referrerName(refHost) } // google.com + google.co.uk = one "Google" row
    : utmSource
      ? { key: `utm:${utmSource.toLowerCase()}`, label: utmSourceName(utmSource) }
      : kind === "agent"
        ? { key: "agent-api", label: "Agent API (MCP / A2A)" }
        : { key: "direct", label: "Direct / none" };

  const campaignParts = [sp.get("utm_source"), sp.get("utm_medium"), sp.get("utm_campaign")].filter((x): x is string => !!x?.trim());
  const query = seg.query || (seg.source === "search" ? NOT_PROVIDED : undefined);

  return {
    kind,
    synthetic: p.synthetic === true,
    source: seg.source,
    referrer,
    query,
    campaign: campaignParts.length ? campaignParts.join(" / ") : undefined,
    country: str(p.$geo_country)?.toUpperCase() ?? "",
    landing: normalizePath(str(p.$pathname) ?? (url ? new URL(url, "http://x").pathname : "/")),
    device: str(p.$device_type) ?? (kind === "agent" ? "Agent" : "Unknown"),
    landed: e.event === "$pageview",
  };
}

function siteOf(e: AnalyticsEvent): string {
  return str(e.properties?.darwin_site) ?? DEMO_STORE_SITE;
}

const SOURCE_LABEL: Record<TrafficSource, string> = {
  ai: "AI assistants",
  search: "Search engines",
  social: "Social",
  paid: "Paid ads",
  email: "Email",
  referral: "Other websites",
  direct: "Direct",
};

export interface TrafficReportOptions {
  site?: string;
  includeSynthetic?: boolean;
  now?: Date;
}

/** What one pass over the events collects: first touch per visitor and the sites seen. */
interface Scan {
  site: string;
  includeSynthetic: boolean;
  visitors: Map<string, Touch>;
  sites: Set<string>;
}

function startScan(opts: TrafficReportOptions): Scan {
  return {
    site: opts.site && opts.site !== "all" ? opts.site : "all",
    includeSynthetic: opts.includeSynthetic ?? true,
    visitors: new Map(),
    sites: new Set(),
  };
}

function scanEvents(scan: Scan, events: readonly AnalyticsEvent[], start: number, end: number) {
  const { site, includeSynthetic, visitors, sites } = scan;
  for (let i = start; i < end; i++) {
    const e = events[i];
    if (!e.distinct_id) continue;
    const s = siteOf(e);
    sites.add(s);
    if (site !== "all" && s !== site) continue;
    const p = e.properties ?? {};
    if (!includeSynthetic && p.synthetic === true) continue;
    if (typeof p.$current_url === "string" && PREVIEW.test(p.$current_url)) continue; // console previews aren't visitors

    let v = visitors.get(e.distinct_id);
    if (!v) {
      v = { ...firstTouch(e), converted: false, revenue: 0 };
      visitors.set(e.distinct_id, v);
    } else if (!v.landed && e.event === "$pageview") {
      // An agent's first event may be an API call; a later page view is the better first touch.
      Object.assign(v, { ...firstTouch(e), kind: v.kind, synthetic: v.synthetic });
    }
    if (!v.country && typeof p.$geo_country === "string") v.country = p.$geo_country.toUpperCase();
    if (e.event === "order_completed") {
      v.converted = true;
      if (typeof p.revenue === "number" && Number.isFinite(p.revenue)) v.revenue += p.revenue;
    }
  }
}

function finishReport(scan: Scan, opts: TrafficReportOptions): TrafficReport {
  const { site, includeSynthetic, visitors, sites } = scan;
  type Acc = Omit<TrafficRow, "conversionRate">;
  const dims = Object.fromEntries(TRAFFIC_DIMENSIONS.map((d) => [d, new Map<string, Acc>()])) as Record<TrafficDimension, Map<string, Acc>>;
  const add = (dim: TrafficDimension, key: string | undefined, label: string, v: Touch) => {
    if (!key) return;
    const m = dims[dim];
    let row = m.get(key);
    if (!row) m.set(key, (row = { key, label, visitors: 0, humans: 0, agents: 0, conversions: 0, revenue: 0, synthetic: 0 }));
    row.visitors++;
    if (v.kind === "agent") row.agents++;
    else row.humans++;
    if (v.converted) row.conversions++;
    row.revenue += v.revenue;
    if (v.synthetic) row.synthetic++;
  };

  const totals: TrafficTotals = { visitors: 0, humans: 0, agents: 0, conversions: 0, conversionRate: 0, revenue: 0, synthetic: 0, countries: 0, notProvided: 0 };
  for (const [id, v] of visitors) {
    // Simulated visitors have no edge headers: give them a deterministic country (they're labelled synthetic).
    if (!v.country && v.synthetic) v.country = simulatedCountry(id);
    totals.visitors++;
    if (v.kind === "agent") totals.agents++;
    else totals.humans++;
    if (v.converted) totals.conversions++;
    totals.revenue += v.revenue;
    if (v.synthetic) totals.synthetic++;
    if (v.query === NOT_PROVIDED) totals.notProvided++;

    add("source", v.source, SOURCE_LABEL[v.source], v);
    add("referrer", v.referrer.key, v.referrer.label, v);
    add("query", v.query, v.query ?? "", v);
    add("campaign", v.campaign, v.campaign ?? "", v);
    add("country", v.country || "??", v.country ? `${countryFlag(v.country)} ${countryName(v.country)}` : "Unknown", v);
    add("landing", v.landing, v.landing, v);
    add("device", v.device, v.device, v);
  }
  totals.conversionRate = totals.visitors ? totals.conversions / totals.visitors : 0;
  totals.countries = [...dims.country.keys()].filter((k) => k !== "??").length;

  const finish = (m: Map<string, Acc>): TrafficRow[] =>
    [...m.values()]
      .map((r) => ({ ...r, conversionRate: r.visitors ? r.conversions / r.visitors : 0 }))
      .sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label))
      .slice(0, ROW_LIMIT);

  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    site,
    includeSynthetic,
    sites: [...sites].sort(),
    totals,
    dimensions: Object.fromEntries(TRAFFIC_DIMENSIONS.map((d) => [d, finish(dims[d])])) as Record<TrafficDimension, TrafficRow[]>,
  };
}

export function computeTrafficReport(events: readonly AnalyticsEvent[], opts: TrafficReportOptions = {}): TrafficReport {
  const scan = startScan(opts);
  scanEvents(scan, events, 0, events.length);
  return finishReport(scan, opts);
}

/** Events scanned between yields to the event loop, so a big store doesn't stall other requests. */
const CHUNK = 20_000;

/**
 * computeTrafficReport over a snapshot of `events`, yielding to the event loop every CHUNK events so
 * API calls (A2A, MCP, checkout) keep being served while a report is built.
 */
export async function computeTrafficReportAsync(events: readonly AnalyticsEvent[], opts: TrafficReportOptions = {}, chunk = CHUNK): Promise<TrafficReport> {
  const snapshot = events.slice(); // the store trims from the front while we wait
  const scan = startScan(opts);
  for (let i = 0; i < snapshot.length; i += chunk) {
    if (i) await new Promise((r) => setImmediate(r));
    scanEvents(scan, snapshot, i, Math.min(i + chunk, snapshot.length));
  }
  return finishReport(scan, opts);
}
