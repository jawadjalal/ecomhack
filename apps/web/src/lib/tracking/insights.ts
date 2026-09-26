/**
 * The "ask for anything" charts: trends, big numbers, retention, paths, lifecycle, breakdowns, time to
 * buy and day × hour grids, computed from the site's PostHog-shaped events. Ideas from product analytics
 * tools (trends / retention / paths / lifecycle / stickiness); our own code, sized for one store.
 *
 * Every card reports the share of its events that were simulated, so the console can label it.
 */
import type { AnalyticsEvent, DashboardBreakdown, DashboardData, DashboardInterval, DashboardSpec } from "@/lib/contracts";
import { TRAFFIC_SOURCE_LABEL } from "@/lib/contracts";
import { classifySource } from "@/lib/web";

type Ev = AnalyticsEvent;
export type InsightPart = Omit<DashboardData, "id" | "kind" | "title" | "why" | "custom">;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEP: Record<DashboardInterval, number> = { minute: MIN, hour: HOUR, day: DAY };
const COUNT: Record<DashboardInterval, number> = { minute: 30, hour: 24, day: 14 };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Noise that isn't a step anyone takes. */
const NOT_A_STEP = /^\$(autocapture|rageclick|pageleave|darwin_web_exposure|identify|set)$|exposure/;

const ts = (e: Ev) => Date.parse(e.timestamp);
const isWhop = (e: Ev) => typeof e.properties?.whop_event === "string";
const simShare = (evs: readonly Ev[]) => {
  let n = 0;
  for (const e of evs) if (e.properties?.synthetic === true) n++;
  return n ? n / evs.length : undefined;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pathOf = (e: Ev) => {
  const p = e.properties?.$pathname;
  if (typeof p === "string" && p) return p;
  try {
    return new URL(String(e.properties?.$current_url ?? "")).pathname || "/";
  } catch {
    return "/";
  }
};

/** Bucket size that fits the data: minutes for a fresh store, hours for a day or two, days after that. */
export function autoInterval(evs: readonly Ev[], now: number): DashboardInterval {
  let first = now;
  for (const e of evs) first = Math.min(first, ts(e));
  const span = now - first;
  return span <= 90 * MIN ? "minute" : span <= 3 * DAY ? "hour" : "day";
}

export interface InsightCtx {
  events: readonly Ev[];
  now: number;
  label: (event: string) => string;
}

/** A visitor's traffic source, from their first event with a URL. */
function sourceMap(events: readonly Ev[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) {
    if (out.has(e.distinct_id) || isWhop(e)) continue;
    if (e.properties?.visitor_kind === "agent") {
      out.set(e.distinct_id, "AI agents");
      continue;
    }
    const url = e.properties?.$current_url;
    if (typeof url !== "string") continue;
    const seg = classifySource({ url, referrer: typeof e.properties?.$referrer === "string" ? e.properties.$referrer : undefined });
    out.set(e.distinct_id, TRAFFIC_SOURCE_LABEL[seg.source]?.split(" (")[0] ?? seg.source);
  }
  return out;
}

const BREAKDOWN_LABEL: Record<DashboardBreakdown, string> = { visitor_kind: "People vs AI agents", device: "Device", source: "Where they came from", page: "Page" };
const isBreakdown = (p: string | undefined): p is DashboardBreakdown => !!p && p in BREAKDOWN_LABEL;

function keyer(by: DashboardBreakdown, events: readonly Ev[]): (e: Ev) => string {
  if (by === "visitor_kind") return (e) => (e.properties?.visitor_kind === "agent" ? "AI agents" : "People");
  if (by === "device") return (e) => (e.properties?.visitor_kind === "agent" ? "AI agents" : typeof e.properties?.$device_type === "string" ? e.properties.$device_type : "Unknown");
  if (by === "page") return pathOf;
  const src = sourceMap(events);
  return (e) => src.get(e.distinct_id) ?? "Direct";
}

/* ------------------------------------------------------------------ trend */

export function trend(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const names = d.events?.length ? d.events : ["$pageview"];
  const hits = ctx.events.filter((e) => names.includes(e.event));
  const interval = d.interval ?? autoInterval(hits, ctx.now);
  const step = STEP[interval];
  const n = COUNT[interval];
  const start = Math.floor(ctx.now / step) - n + 1;
  const buckets = Array.from({ length: n }, (_, i) => new Date((start + i) * step).toISOString());
  const key = d.breakdown ? keyer(d.breakdown, ctx.events) : names.length > 1 ? (e: Ev) => e.event : () => names[0];
  const by = new Map<string, number[]>();
  const previous = new Array<number>(n).fill(0);
  const counted: Ev[] = [];
  for (const e of hits) {
    const b = Math.floor(ts(e) / step) - start;
    if (b >= 0 && b < n) {
      const k = key(e);
      const arr = by.get(k) ?? new Array<number>(n).fill(0);
      arr[b]++;
      by.set(k, arr);
      counted.push(e);
    } else if (b >= -n && b < 0) previous[b + n]++;
  }
  const all = [...by]
    .map(([k, values]) => ({ key: k, label: d.breakdown ? k : ctx.label(k), total: values.reduce((a, v) => a + v, 0), values }))
    .sort((a, b) => b.total - a.total);
  // Five lines at most: the rest become "Everything else".
  const series = all.slice(0, 5);
  if (all.length > 5) {
    const rest = all.slice(5);
    series.push({ key: "other", label: "Everything else", total: rest.reduce((a, s) => a + s.total, 0), values: buckets.map((_, i) => rest.reduce((a, s) => a + s.values[i], 0)) });
  }
  const total = series.reduce((a, s) => a + s.total, 0);
  return {
    empty: total === 0,
    simulated: simShare(counted),
    trend: { interval, display: d.display ?? (interval === "day" ? "bars" : "line"), breakdown: d.breakdown, buckets, series, total, previousTotal: previous.reduce((a, v) => a + v, 0), previous },
  };
}

/* ------------------------------------------------------------------ number */

const PERIOD = { hour: "in the last hour", today: "today", week: "in the last 7 days" } as const;

export function bigNumber(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const name = d.events?.[0] ?? "$pageview";
  const period = d.period ?? "today";
  const startOfDay = Math.floor(ctx.now / DAY) * DAY;
  const from = period === "hour" ? ctx.now - HOUR : period === "week" ? ctx.now - 7 * DAY : startOfDay;
  const len = Math.max(MIN, ctx.now - from);
  const prevFrom = from - (period === "today" ? DAY : len);
  const prevTo = prevFrom + len;
  const money = d.property === "revenue";
  const unique = d.property === "distinct_id";
  const hits = ctx.events.filter((e) => e.event === name);
  const inNow = hits.filter((e) => ts(e) >= from && ts(e) <= ctx.now);
  const inPrev = hits.filter((e) => ts(e) >= prevFrom && ts(e) < prevTo);
  const measure = (evs: Ev[]) => (money ? evs.reduce((a, e) => a + (Number(e.properties?.revenue) || 0), 0) : unique ? new Set(evs.map((e) => e.distinct_id)).size : evs.length);
  const value = measure(inNow);
  const previous = measure(inPrev);
  const spark = Array.from({ length: 12 }, (_, i) => {
    const a = from + (len * i) / 12;
    const b = from + (len * (i + 1)) / 12;
    return measure(inNow.filter((e) => ts(e) >= a && (i === 11 ? ts(e) <= b : ts(e) < b)));
  });
  const label = money ? "Revenue" : unique ? "Visitors" : ctx.label(name);
  return {
    empty: hits.length === 0,
    simulated: simShare(inNow),
    number: { label, value, previous, change: previous > 0 ? value / previous - 1 : undefined, period: PERIOD[period], spark, ...(money ? { money: true } : {}) },
  };
}

/* ------------------------------------------------------------------ people-based */

interface Person {
  first: number;
  times: number[];
}

/** Humans only (agents don't "come back" the same way), whop webhooks aside. */
function people(events: readonly Ev[]): { map: Map<string, Person>; used: Ev[] } {
  const map = new Map<string, Person>();
  const used: Ev[] = [];
  for (const e of events) {
    if (isWhop(e) || e.properties?.visitor_kind === "agent") continue;
    const t = ts(e);
    if (!Number.isFinite(t)) continue;
    const p = map.get(e.distinct_id);
    if (p) {
      p.first = Math.min(p.first, t);
      p.times.push(t);
    } else map.set(e.distinct_id, { first: t, times: [t] });
    used.push(e);
  }
  return { map, used };
}

export function retention(_d: DashboardSpec, ctx: InsightCtx, days = 7): InsightPart {
  const { map, used } = people(ctx.events);
  const today = Math.floor(ctx.now / DAY);
  const oldest = today - days + 1;
  const cohorts = new Map<number, { size: number; returned: number[] }>();
  for (const p of map.values()) {
    const c = Math.floor(p.first / DAY);
    if (c < oldest || c > today) continue;
    const row = cohorts.get(c) ?? { size: 0, returned: new Array<number>(today - c + 1).fill(0) };
    row.size++;
    const active = new Set(p.times.map((t) => Math.floor(t / DAY) - c));
    for (const k of active) if (k >= 0 && k < row.returned.length) row.returned[k]++;
    cohorts.set(c, row);
  }
  const rows = [...cohorts]
    .sort((a, b) => a[0] - b[0])
    .map(([c, r]) => ({ day: new Date(c * DAY).toISOString().slice(0, 10), size: r.size, returned: r.returned.slice(0, days) }));
  return { empty: rows.length === 0, simulated: simShare(used), retention: { cohorts: rows, days } };
}

export function lifecycle(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const { map, used } = people(ctx.events);
  const interval = d.interval ?? (autoInterval(used, ctx.now) === "day" ? "day" : "hour");
  const step = STEP[interval];
  const n = interval === "day" ? 14 : 24;
  const end = Math.floor(ctx.now / step);
  const start = end - n + 1;
  const rows = Array.from({ length: n }, (_, i) => ({ t: new Date((start + i) * step).toISOString(), new: 0, returning: 0, resurrecting: 0, dormant: 0 }));
  for (const p of map.values()) {
    const first = Math.floor(p.first / step);
    const active = new Set(p.times.map((t) => Math.floor(t / step)));
    for (let b = start; b <= end; b++) {
      const row = rows[b - start];
      const on = active.has(b);
      const before = active.has(b - 1);
      if (on && b === first) row.new++;
      else if (on && before) row.returning++;
      else if (on && b > first) row.resurrecting++;
      else if (!on && before) row.dormant++;
    }
  }
  const any = rows.some((r) => r.new + r.returning + r.resurrecting + r.dormant > 0);
  return { empty: !any, simulated: simShare(used), lifecycle: { interval, rows } };
}

/* ------------------------------------------------------------------ paths */

export function paths(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const byVisitor = new Map<string, Ev[]>();
  for (const e of ctx.events) {
    if (isWhop(e) || NOT_A_STEP.test(e.event)) continue;
    const list = byVisitor.get(e.distinct_id) ?? [];
    list.push(e);
    byVisitor.set(e.distinct_id, list);
  }
  const from = d.from || (d.events?.[0] ?? "product_viewed");
  const isPage = from.startsWith("/");
  const stepOf = (e: Ev) => (e.event === "$pageview" ? pathOf(e) : ctx.label(e.event));
  const matches = (e: Ev) => (isPage ? e.event === "$pageview" && (from === "/" ? pathOf(e) === "/" : pathOf(e).startsWith(from)) : e.event === from);
  const counts = new Map<string, { steps: string[]; count: number }>();
  const used: Ev[] = [];
  let total = 0;
  for (const list of byVisitor.values()) {
    list.sort((a, b) => ts(a) - ts(b));
    const at = list.findIndex(matches);
    if (at < 0) continue;
    total++;
    const steps: string[] = [];
    for (const e of list.slice(at + 1)) {
      const s = stepOf(e);
      if (s === steps.at(-1) || (!steps.length && s === stepOf(list[at]))) continue;
      steps.push(s);
      used.push(e);
      if (steps.length === 3) break;
    }
    if (!steps.length) steps.push("Left the store");
    const k = steps.join(" → ");
    const row = counts.get(k) ?? { steps, count: 0 };
    row.count++;
    counts.set(k, row);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  return { empty: total === 0, simulated: simShare(used), paths: { from, fromLabel: isPage ? from : ctx.label(from), total, paths: top } };
}

/* ------------------------------------------------------------------ breakdown */

const PROPERTY_LABEL: Record<string, string> = { product_id: "Product", $pathname: "Page", code: "Code", $device_type: "Device", step: "Step" };

export function breakdown(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const event = d.events?.[0] ?? "$pageview";
  const property = d.property ?? "device";
  const hits = ctx.events.filter((e) => e.event === event);
  const key = isBreakdown(property)
    ? keyer(property, ctx.events)
    : (e: Ev) => {
        const v = e.properties?.[property];
        return v === undefined || v === null || v === "" ? undefined : String(v);
      };
  const counts = new Map<string, number>();
  const used: Ev[] = [];
  for (const e of hits) {
    const k = key(e);
    if (k === undefined) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    used.push(e);
  }
  const total = used.length;
  const items = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, c]) => ({ key: k, label: k, count: c, share: total ? c / total : 0 }));
  const propertyLabel = isBreakdown(property) ? BREAKDOWN_LABEL[property] : (PROPERTY_LABEL[property] ?? cap(property.replace(/^\$/, "").replace(/_/g, " ")));
  return {
    empty: total === 0,
    simulated: simShare(used),
    bars: { property, propertyLabel, event, total, items },
    ...(total === 0 && hits.length > 0 ? { note: `${hits.length.toLocaleString("en-GB")} “${ctx.label(event)}” events so far, none with a ${property}. Send it: window.darwin?.capture("${event}", { ${property}: … })` } : {}),
  };
}

/* ------------------------------------------------------------------ time to convert */

const BINS: [number, string][] = [
  [10_000, "Under 10 s"],
  [MIN, "10 s – 1 min"],
  [5 * MIN, "1 – 5 min"],
  [30 * MIN, "5 – 30 min"],
  [2 * HOUR, "30 min – 2 h"],
  [DAY, "2 – 24 h"],
  [7 * DAY, "1 – 7 days"],
  [Infinity, "Over a week"],
];

export function timeToConvert(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const goal = d.events?.at(-1) ?? "order_completed";
  const first = new Map<string, number>();
  const done = new Map<string, number>();
  const used: Ev[] = [];
  for (const e of ctx.events) {
    if (isWhop(e)) continue;
    const t = ts(e);
    first.set(e.distinct_id, Math.min(first.get(e.distinct_id) ?? t, t));
    if (e.event === goal && !done.has(e.distinct_id)) {
      done.set(e.distinct_id, t);
      used.push(e);
    } else if (e.event === goal) done.set(e.distinct_id, Math.min(done.get(e.distinct_id)!, t));
  }
  const waits = [...done].map(([id, t]) => Math.max(0, t - (first.get(id) ?? t))).sort((a, b) => a - b);
  const bins = BINS.map(([, label]) => ({ label, count: 0 }));
  for (const w of waits) bins[BINS.findIndex(([max]) => w < max)].count++;
  // Trim empty bins at the long end so the chart isn't mostly air.
  let last = bins.length - 1;
  while (last > 2 && bins[last].count === 0) last--;
  return {
    empty: waits.length === 0,
    simulated: simShare(used),
    histogram: { bins: bins.slice(0, last + 1), total: waits.length, medianMs: waits.length ? waits[Math.floor(waits.length / 2)] : undefined },
  };
}

/* ------------------------------------------------------------------ hourly */

export function hourly(d: DashboardSpec, ctx: InsightCtx): InsightPart {
  const name = d.events?.[0] ?? "$pageview";
  const since = ctx.now - 28 * DAY;
  const cells = DAYS.map(() => new Array<number>(24).fill(0));
  const used: Ev[] = [];
  for (const e of ctx.events) {
    if (e.event !== name) continue;
    const t = ts(e);
    if (t < since || t > ctx.now) continue;
    const at = new Date(t);
    cells[(at.getUTCDay() + 6) % 7][at.getUTCHours()]++;
    used.push(e);
  }
  let max = 0;
  let peak: { day: string; hour: number; count: number } | undefined;
  cells.forEach((row, di) =>
    row.forEach((c, h) => {
      if (c > max) {
        max = c;
        peak = { day: DAYS[di], hour: h, count: c };
      }
    }),
  );
  return { empty: used.length === 0, simulated: simShare(used), grid: { days: DAYS, cells, max, peak, total: used.length } };
}

/** The part of a card that the new kinds compute; undefined for the older kinds. */
export function computeInsight(d: DashboardSpec, ctx: InsightCtx): InsightPart | undefined {
  switch (d.kind) {
    case "trend":
      return trend(d, ctx);
    case "number":
      return bigNumber(d, ctx);
    case "retention":
      return retention(d, ctx);
    case "paths":
      return paths(d, ctx);
    case "lifecycle":
      return lifecycle(d, ctx);
    case "breakdown":
      return breakdown(d, ctx);
    case "time_to_convert":
      return timeToConvert(d, ctx);
    case "hourly":
      return hourly(d, ctx);
    default:
      return undefined;
  }
}
