/**
 * Click heatmap from darwin.js autocapture: which elements people click on a page, per traffic source.
 * The selectors are the ones darwin.js recorded (valid CSS), so the console can find the elements in
 * the page again and paint the heat over them. Console previews never count.
 */
import type { AnalyticsEvent, HeatmapElement, TrafficSource, WebHeatmap } from "@/lib/contracts";
import { TRAFFIC_SOURCES } from "@/lib/contracts";
import { EXPOSURE_EVENT, isPreview } from "./results";
import { classifySource } from "./segment";

export const MAX_HEATMAP_ELEMENTS = 40;

const isSource = (v: unknown): v is TrafficSource => typeof v === "string" && (TRAFFIC_SOURCES as readonly string[]).includes(v);

export function computeHeatmap(site: string, events: readonly AnalyticsEvent[], opts: { path?: string; source?: TrafficSource } = {}): WebHeatmap {
  const mine = events.filter((e) => e.properties?.darwin_site === site && !isPreview(e.properties?.$current_url));

  // Each visitor's source: what the runtime reported, else their first page view.
  const sourceOf = new Map<string, TrafficSource>();
  for (const e of mine) {
    if (sourceOf.has(e.distinct_id)) continue;
    const p = e.properties;
    if (e.event === EXPOSURE_EVENT && isSource(p.web_source)) sourceOf.set(e.distinct_id, p.web_source);
    else if (e.event === "$pageview") sourceOf.set(e.distinct_id, classifySource({ url: p.$current_url, referrer: p.$referrer }).source);
  }

  const byEl = new Map<string, { tag: string; texts: Map<string, number>; clicks: number; rage: number; visitors: Set<string> }>();
  const visitors = new Set<string>();
  let clicks = 0;
  let rage = 0;
  let synthetic = 0;
  for (const e of mine) {
    if (e.event !== "$autocapture" && e.event !== "$rageclick") continue;
    const p = e.properties;
    const selector = typeof p.$selector === "string" ? p.$selector : "";
    if (!selector) continue;
    if (opts.path && p.$pathname !== opts.path) continue;
    if (opts.source && (sourceOf.get(e.distinct_id) ?? "direct") !== opts.source) continue;
    let el = byEl.get(selector);
    if (!el) byEl.set(selector, (el = { tag: String(p.$el_tag ?? ""), texts: new Map(), clicks: 0, rage: 0, visitors: new Set() }));
    if (e.event === "$rageclick") {
      el.rage++;
      rage++;
      continue;
    }
    el.clicks++;
    clicks++;
    el.visitors.add(e.distinct_id);
    visitors.add(e.distinct_id);
    const text = typeof p.$el_text === "string" ? p.$el_text : "";
    if (text) el.texts.set(text, (el.texts.get(text) ?? 0) + 1);
    if (p.synthetic === true) synthetic++;
  }

  const elements: HeatmapElement[] = [...byEl]
    .map(([selector, el]) => ({
      selector,
      tag: el.tag,
      text: [...el.texts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      clicks: el.clicks,
      rageClicks: el.rage,
      visitors: el.visitors.size,
      share: clicks ? el.clicks / clicks : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.rageClicks - a.rageClicks)
    .slice(0, MAX_HEATMAP_ELEMENTS);

  return { site, path: opts.path, source: opts.source, clicks, rageClicks: rage, visitors: visitors.size, syntheticClicks: synthetic, elements };
}
