/**
 * Results for web rules, from the event stream (one pass over the site's events).
 *
 * - A visitor is in a rule's test from their first `$darwin_web_exposure` for it (between
 *   startedAt and shippedAt). Their arm is recomputed server-side from the visitor id, so a client
 *   can't claim to be in the treatment.
 * - They converted if the rule's metric event (default order_completed) happened after that exposure.
 * - Source per visitor = what the runtime reported on the exposure (first touch of the session).
 */
import type {
  AnalyticsEvent,
  TrafficSource,
  WebArmStats,
  WebRule,
  WebRuleResult,
  WebSiteOverview,
  WebSiteSummary,
} from "@/lib/contracts";
import { TRAFFIC_SOURCES } from "@/lib/contracts";
import { comparePosteriors } from "@/lib/optimizer";
import { assignWebVariant, classifySource } from "./segment";

export const EXPOSURE_EVENT = "$darwin_web_exposure";

const arm = (visitors: number, conversions: number): WebArmStats => ({
  visitors,
  conversions,
  conversionRate: visitors ? conversions / visitors : 0,
});

interface Visitor {
  firstSeen: string;
  source?: TrafficSource;
  synthetic: boolean;
  /** metric event → timestamps */
  metrics: Map<string, string[]>;
}

function siteOf(e: AnalyticsEvent): string | undefined {
  const s = e.properties?.darwin_site;
  return typeof s === "string" ? s : undefined;
}

const PREVIEW = /[?&]darwin_(source|variant|q)=/;
const isPreview = (u: unknown) => typeof u === "string" && PREVIEW.test(u);

function isSource(v: unknown): v is TrafficSource {
  return typeof v === "string" && (TRAFFIC_SOURCES as readonly string[]).includes(v);
}

/** Everything the console needs for one site, from one pass over its events. */
export function computeSite(site: string, rules: WebRule[], events: readonly AnalyticsEvent[]): { overview: WebSiteOverview; results: WebRuleResult[] } {
  const metricNames = new Set(["order_completed", ...rules.map((r) => r.metric)]);
  const visitors = new Map<string, Visitor>();
  const exposures = new Map<string, Map<string, { ts: string; source?: TrafficSource }>>(); // rule → visitor → first exposure
  let url: string | undefined;

  for (const e of events) {
    if (siteOf(e) !== site || !e.distinct_id) continue;
    const p = e.properties ?? {};
    if (isPreview(p.$current_url)) continue; // the console's "view as" previews aren't visitors
    let v = visitors.get(e.distinct_id);
    if (!v) {
      v = { firstSeen: e.timestamp, synthetic: p.synthetic === true, metrics: new Map() };
      visitors.set(e.distinct_id, v);
    }
    if (e.event === "$pageview") {
      if (!v.source) v.source = classifySource({ url: p.$current_url as string, referrer: p.$referrer as string }).source;
      if (typeof p.$current_url === "string" && p.synthetic !== true) url = p.$current_url;
    } else if (e.event === EXPOSURE_EVENT) {
      const ruleId = typeof p.rule_id === "string" ? p.rule_id : undefined;
      if (!ruleId) continue;
      const src = isSource(p.web_source) ? p.web_source : undefined;
      if (src && !v.source) v.source = src;
      let byVisitor = exposures.get(ruleId);
      if (!byVisitor) exposures.set(ruleId, (byVisitor = new Map()));
      if (!byVisitor.has(e.distinct_id)) byVisitor.set(e.distinct_id, { ts: e.timestamp, source: src });
    }
    if (metricNames.has(e.event)) {
      const list = v.metrics.get(e.event) ?? [];
      list.push(e.timestamp);
      v.metrics.set(e.event, list);
    }
  }

  // Overview: every visitor, by source.
  const bySource = Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, { v: 0, c: 0 }])) as Record<TrafficSource, { v: number; c: number }>;
  let total = 0;
  let converted = 0;
  let synthetic = 0;
  for (const v of visitors.values()) {
    const src = v.source ?? "direct";
    const did = (v.metrics.get("order_completed")?.length ?? 0) > 0;
    bySource[src].v++;
    total++;
    if (did) {
      bySource[src].c++;
      converted++;
    }
    if (v.synthetic) synthetic++;
  }
  const overview: WebSiteOverview = {
    site,
    url: url ? stripPreviewParams(url) : undefined,
    visitors: total,
    conversions: converted,
    conversionRate: total ? converted / total : 0,
    bySource: Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, arm(bySource[s].v, bySource[s].c)])) as Record<TrafficSource, WebArmStats>,
    syntheticVisitors: synthetic,
  };

  const results = rules.map((rule): WebRuleResult => {
    const counts = { control: { v: 0, c: 0 }, treatment: { v: 0, c: 0 } };
    const perSource = new Map<TrafficSource, typeof counts>();
    let allSynthetic = true;
    for (const [visitorId, exp] of exposures.get(rule.id) ?? []) {
      if (!rule.startedAt || exp.ts < rule.startedAt) continue; // drafts never count
      if (rule.shippedAt && rule.mode === "test" && exp.ts >= rule.shippedAt) continue;
      const v = visitors.get(visitorId)!;
      const variant = assignWebVariant(visitorId, { ...rule, status: "running" });
      const did = (v.metrics.get(rule.metric) ?? []).some((ts) => ts >= exp.ts);
      if (!v.synthetic) allSynthetic = false;
      counts[variant].v++;
      if (did) counts[variant].c++;
      const src = exp.source ?? v.source ?? "direct";
      let s = perSource.get(src);
      if (!s) perSource.set(src, (s = { control: { v: 0, c: 0 }, treatment: { v: 0, c: 0 } }));
      s[variant].v++;
      if (did) s[variant].c++;
    }
    const control = arm(counts.control.v, counts.control.c);
    const treatment = arm(counts.treatment.v, counts.treatment.c);
    const compared =
      rule.mode === "test" && control.visitors > 0 && treatment.visitors > 0
        ? comparePosteriors(control, treatment, { draws: 8000, seed: 7 })
        : undefined;
    return {
      ruleId: rule.id,
      control,
      treatment,
      probabilityToBeat: compared?.probabilityToBeat,
      lift: compared?.medianLift,
      bySource: Object.fromEntries(
        [...perSource].map(([src, s]) => [src, { control: arm(s.control.v, s.control.c), treatment: arm(s.treatment.v, s.treatment.c) }]),
      ),
      synthetic: control.visitors + treatment.visitors > 0 && allSynthetic,
    };
  });

  return { overview, results };
}

/** Sites Darwin has seen (from darwin.js events) or has rules for, busiest first. */
export function knownSites(rules: WebRule[], events: readonly AnalyticsEvent[]): WebSiteSummary[] {
  const seen = new Map<string, { visitors: Set<string>; url?: string }>();
  for (const e of events) {
    const site = siteOf(e);
    if (!site || isPreview(e.properties?.$current_url)) continue;
    let s = seen.get(site);
    if (!s) seen.set(site, (s = { visitors: new Set() }));
    s.visitors.add(e.distinct_id);
    const u = e.properties?.$current_url;
    if (e.event === "$pageview" && typeof u === "string" && e.properties?.synthetic !== true) s.url = u;
  }
  for (const r of rules) if (!seen.has(r.site)) seen.set(r.site, { visitors: new Set() });
  return [...seen]
    .map(([site, s]) => ({
      site,
      url: s.url ? stripPreviewParams(s.url) : undefined,
      visitors: s.visitors.size,
      rules: rules.filter((r) => r.site === site).length,
    }))
    .sort((a, b) => b.visitors - a.visitors || a.site.localeCompare(b.site));
}

/** The page without tracking or preview parameters (what the console previews). */
export function stripPreviewParams(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^(darwin_|utm_|gclid|fbclid|msclkid|ttclid|q$|query$|s$)/.test(k)) url.searchParams.delete(k);
    }
    url.hash = "";
    return url.href;
  } catch {
    return u;
  }
}
