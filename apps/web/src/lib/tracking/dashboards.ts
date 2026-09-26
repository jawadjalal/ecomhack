/**
 * The dashboards a tracking plan asked for, computed live from the site's events. One pass to group the
 * site's events by visitor, then each dashboard reads what it needs. Simulated events are counted and
 * reported (the console labels them); console previews never count.
 */
import type { AnalyticsEvent, DashboardData, DashboardSpec, DashboardsResponse, SeriesPoint, TrackingPlan } from "@/lib/contracts";
import { TRAFFIC_SOURCE_LABEL } from "@/lib/contracts";
import { computeHeatmap, computeSite, isPreview, listRules } from "@/lib/web";
import { computeInsight } from "./insights";

/** Same id as lib/tracking DEMO_STORE_SITE (not imported: index.ts re-exports this module). */
const DEMO_STORE_SITE = "pace-store";

const MINUTES = 30;

interface Visitor {
  kind: "human" | "agent";
  device?: string;
  events: Set<string>;
  converted: boolean;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

function minuteSeries(times: { t: number; v: number }[], now: number): SeriesPoint[] {
  const end = Math.floor(now / 60_000);
  const buckets = new Map<number, number>();
  for (const { t, v } of times) {
    const m = Math.floor(t / 60_000);
    if (m > end - MINUTES && m <= end) buckets.set(m, (buckets.get(m) ?? 0) + v);
  }
  return Array.from({ length: MINUTES }, (_, i) => {
    const m = end - MINUTES + 1 + i;
    return { t: new Date(m * 60_000).toISOString(), v: buckets.get(m) ?? 0 };
  });
}

export function computeDashboards(site: string, plan: TrackingPlan | undefined, all: readonly AnalyticsEvent[], now = Date.now()): DashboardsResponse {
  const isWhop = (e: AnalyticsEvent) => typeof e.properties?.whop_event === "string";
  // The demo store (/store) tags nothing with darwin_site: its events are the ones without one (Whop's aside),
  // plus visitors the dashboards' own "+ simulated" button sends as darwin_site=pace-store.
  const onSite =
    site === DEMO_STORE_SITE
      ? (e: AnalyticsEvent) => (!e.properties?.darwin_site || e.properties.darwin_site === site) && !isWhop(e)
      : (e: AnalyticsEvent) => e.properties?.darwin_site === site;
  const events = all.filter((e) => (onSite(e) && !isPreview(e.properties?.$current_url)) || (plan?.whop && isWhop(e)));
  const label = (name: string) => plan?.events.find((e) => e.name === name)?.label ?? name.replace(/^\$/, "").replace(/_/g, " ");

  const visitors = new Map<string, Visitor>();
  const seen: Record<string, number> = {};
  let synthetic = 0;
  for (const e of events) {
    seen[e.event] = (seen[e.event] ?? 0) + 1;
    if (e.properties?.synthetic === true) synthetic++;
    if (isWhop(e)) {
      if (e.event === "order_completed") seen.whop_payment = (seen.whop_payment ?? 0) + 1;
      continue;
    }
    let v = visitors.get(e.distinct_id);
    if (!v) {
      v = { kind: e.properties?.visitor_kind === "agent" ? "agent" : "human", events: new Set(), converted: false };
      visitors.set(e.distinct_id, v);
      if (v.kind === "agent") seen.agent_visit = (seen.agent_visit ?? 0) + 1;
    }
    v.events.add(e.event);
    if (e.event === "order_completed") v.converted = true;
    if (!v.device && typeof e.properties?.$device_type === "string") v.device = e.properties.$device_type;
  }
  const people = [...visitors.values()].filter((v) => v.events.has("$pageview") || v.kind === "agent");
  const orders = events.filter((e) => e.event === "order_completed" && !isWhop(e));
  const whopPayments = events.filter((e) => e.event === "order_completed" && isWhop(e));
  const revenue = [...orders, ...whopPayments].reduce((a, e) => a + (Number(e.properties?.revenue) || 0), 0);
  const specs: DashboardSpec[] = plan?.dashboards ?? [
    { id: "kpis", kind: "kpis", title: "Today at a glance", why: "Visitors, orders, conversion and revenue, live." },
    { id: "sources", kind: "sources", title: "Where shoppers come from", why: "Who converts, by traffic source." },
  ];

  const build = (d: DashboardSpec): DashboardData => {
    const base = { id: d.id, kind: d.kind, title: d.title, why: d.why, ...(d.custom ? { custom: true } : {}) };
    switch (d.kind) {
      case "kpis": {
        const converted = people.filter((v) => v.converted).length;
        const agents = people.filter((v) => v.kind === "agent").length;
        return {
          ...base,
          empty: people.length === 0,
          kpis: [
            { label: "Visitors", value: people.length.toLocaleString("en-GB") },
            { label: "Orders", value: (orders.length + whopPayments.length).toLocaleString("en-GB"), hint: whopPayments.length ? `${whopPayments.length} via Whop` : undefined },
            { label: "Conversion", value: people.length ? pct(converted / people.length) : "–" },
            { label: "Revenue", value: gbp(revenue) },
            { label: "AI agents", value: agents.toLocaleString("en-GB"), hint: people.length ? `${pct(agents / people.length)} of visitors` : undefined },
          ],
        };
      }
      case "funnel": {
        const steps = d.events ?? [];
        let pool = people;
        const first = steps.length ? people.filter((v) => v.events.has(steps[0])).length : 0;
        const out = steps.map((ev) => {
          pool = pool.filter((v) => v.events.has(ev));
          return { event: ev, label: ev === "$pageview" ? "Visited" : label(ev), visitors: pool.length, rate: first ? pool.length / first : 0 };
        });
        return { ...base, empty: first === 0, steps: out };
      }
      case "sources": {
        const { overview } = computeSite(site, [], all);
        const rows = Object.entries(overview.bySource)
          .filter(([, s]) => s.visitors > 0)
          .map(([k, s]) => ({ key: k, label: TRAFFIC_SOURCE_LABEL[k as keyof typeof TRAFFIC_SOURCE_LABEL].split(" (")[0], visitors: s.visitors, conversions: s.conversions, rate: s.conversionRate }))
          .sort((a, b) => b.visitors - a.visitors);
        return { ...base, empty: rows.length === 0, rows };
      }
      case "humans-agents":
      case "devices": {
        const key = (v: Visitor) => (d.kind === "devices" ? (v.device ?? "Unknown") : v.kind === "agent" ? "AI agents" : "Humans");
        const groups = new Map<string, { visitors: number; conversions: number }>();
        // Devices are a human thing: agents have no screen.
        for (const v of d.kind === "devices" ? people.filter((p) => p.kind === "human") : people) {
          const g = groups.get(key(v)) ?? { visitors: 0, conversions: 0 };
          g.visitors++;
          if (v.converted) g.conversions++;
          groups.set(key(v), g);
        }
        const rows = [...groups].map(([k, g]) => ({ key: k, label: k, visitors: g.visitors, conversions: g.conversions, rate: g.visitors ? g.conversions / g.visitors : 0 })).sort((a, b) => b.visitors - a.visitors);
        return { ...base, empty: rows.length === 0, rows };
      }
      case "heatmap": {
        const heat = computeHeatmap(site, all);
        const clicks = heat.elements.slice(0, 8).map((e) => ({ label: e.text || e.selector.split(" > ").pop()!, selector: e.selector, clicks: e.clicks, share: e.share, rage: e.rageClicks }));
        return { ...base, empty: clicks.length === 0, clicks };
      }
      case "experiments": {
        const rules = listRules(site);
        const { results } = computeSite(site, rules, all);
        const tests = rules
          .filter((r) => r.status !== "draft")
          .map((r) => {
            const res = results.find((x) => x.ruleId === r.id);
            return {
              name: r.name,
              audience: r.audience.sources?.length ? r.audience.sources.map((s) => TRAFFIC_SOURCE_LABEL[s].split(" (")[0]).join(", ") : "Everyone",
              status: r.status === "running" ? (r.mode === "test" ? "Testing" : "Live") : r.status === "shipped" ? "Shipped" : "Stopped",
              control: res?.control.conversionRate ?? 0,
              treatment: res?.treatment.conversionRate ?? 0,
              probability: res?.probabilityToBeat,
              lift: res?.lift,
            };
          })
          .reverse();
        return { ...base, empty: tests.length === 0, tests };
      }
      case "revenue": {
        const store = minuteSeries(orders.map((e) => ({ t: Date.parse(e.timestamp), v: Number(e.properties?.revenue) || 0 })), now);
        const series = [{ name: "store", label: "Store orders", total: orders.reduce((a, e) => a + (Number(e.properties?.revenue) || 0), 0), points: store }];
        if (plan?.whop) {
          series.push({
            name: "whop",
            label: "Whop payments",
            total: whopPayments.reduce((a, e) => a + (Number(e.properties?.revenue) || 0), 0),
            points: minuteSeries(whopPayments.map((e) => ({ t: Date.parse(e.timestamp), v: Number(e.properties?.revenue) || 0 })), now),
          });
        }
        return { ...base, empty: revenue === 0, series };
      }
      case "events": {
        const series = (d.events ?? []).map((name) => {
          const hits = events.filter((e) => e.event === name);
          return { name, label: label(name), total: hits.length, points: minuteSeries(hits.map((e) => ({ t: Date.parse(e.timestamp), v: 1 })), now) };
        });
        return { ...base, empty: series.every((s) => s.total === 0), series };
      }
      default:
        // trend, number, retention, paths, lifecycle, breakdown, time_to_convert, hourly
        return { ...base, ...(computeInsight(d, { events, now, label }) ?? { empty: true }) };
    }
  };

  return { site, plan, dashboards: specs.map(build), seen, syntheticEvents: synthetic, totalEvents: events.length };
}
