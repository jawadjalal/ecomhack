import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, DashboardSpec } from "@/lib/contracts";
import { askForChart, computeDashboards, heuristicPlan } from ".";
import { TrackingPlanSchema } from "./schema";

const SITE = "insight-shop";
const NOW = Date.parse("2026-09-26T12:00:00Z"); // a Saturday
let n = 0;
const ev = (event: string, who: string, at: string, props: Record<string, unknown> = {}): AnalyticsEvent => ({
  uuid: `u${n++}`,
  event,
  distinct_id: who,
  timestamp: new Date(at).toISOString(),
  properties: { darwin_site: SITE, visitor_kind: "human", ...props },
});

/** Three days, four people and an AI agent. Bob is simulated. */
const EVENTS: AnalyticsEvent[] = [
  ev("$pageview", "alice", "2026-09-24T10:00:00Z", { $device_type: "Mobile", $current_url: "https://shop.example/" }),
  ev("product_viewed", "alice", "2026-09-24T10:01:00Z", { $device_type: "Mobile" }),
  ev("product_added", "alice", "2026-09-24T10:02:00Z", { $device_type: "Mobile", size: "9" }),
  ev("$pageview", "alice", "2026-09-25T11:00:00Z", { $device_type: "Mobile", $current_url: "https://shop.example/" }),
  ev("order_completed", "alice", "2026-09-25T11:05:00Z", { $device_type: "Mobile", revenue: 12000 }),
  ev("$pageview", "bob", "2026-09-25T09:00:00Z", { $device_type: "Desktop", $current_url: "https://shop.example/products/p1", synthetic: true }),
  ev("product_viewed", "bob", "2026-09-25T09:00:30Z", { $device_type: "Desktop", synthetic: true }),
  ev("$pageleave", "bob", "2026-09-25T09:02:00Z", { $device_type: "Desktop", synthetic: true }),
  ev("$pageview", "carol", "2026-09-26T11:30:00Z", { $device_type: "Mobile", $current_url: "https://shop.example/" }),
  ev("product_viewed", "carol", "2026-09-26T11:31:00Z", { $device_type: "Mobile" }),
  ev("product_added", "carol", "2026-09-26T11:32:00Z", { $device_type: "Mobile", size: "10" }),
  ev("checkout_started", "carol", "2026-09-26T11:33:00Z", { $device_type: "Mobile" }),
  ev("order_completed", "carol", "2026-09-26T11:40:00Z", { $device_type: "Mobile", revenue: 9000 }),
  ev("$pageview", "agent", "2026-09-26T11:50:00Z", { visitor_kind: "agent", $current_url: "https://shop.example/" }),
  ev("order_completed", "agent", "2026-09-26T11:51:00Z", { visitor_kind: "agent", revenue: 5000 }),
  ev("product_added", "dave", "2026-09-26T11:45:00Z", { $device_type: "Tablet", size: "9" }),
];

function card(spec: Omit<DashboardSpec, "id" | "title" | "why">) {
  const plan = { ...heuristicPlan({ site: SITE }), dashboards: [{ id: "x", title: "X", why: "Y", ...spec }] };
  return computeDashboards(SITE, plan, EVENTS, NOW).dashboards[0];
}

describe("insight charts compute from the events", () => {
  it("trend: orders per day split by device, with the period before", () => {
    const d = card({ kind: "trend", events: ["order_completed"], interval: "day", breakdown: "device" });
    expect(d.empty).toBe(false);
    expect(d.trend).toMatchObject({ interval: "day", display: "bars", total: 3, previousTotal: 0 });
    expect(d.trend!.buckets).toHaveLength(14);
    expect(Object.fromEntries(d.trend!.series.map((s) => [s.key, s.total]))).toEqual({ Mobile: 2, "AI agents": 1 });
    expect(d.trend!.series.find((s) => s.key === "Mobile")!.values.slice(-2)).toEqual([1, 1]);
    const money = card({ kind: "trend", events: ["order_completed"], interval: "day", property: "revenue" });
    expect(money.trend).toMatchObject({ total: 26000, money: true });
  });

  it("number: today vs yesterday by now, with a sparkline", () => {
    const d = card({ kind: "number", events: ["order_completed"], period: "today" });
    expect(d.number).toMatchObject({ value: 2, previous: 1, change: 1, period: "today" });
    expect(d.number!.spark).toHaveLength(12);
    expect(card({ kind: "number", events: ["order_completed"], property: "revenue" }).number).toMatchObject({ value: 14000, previous: 12000, money: true });
    expect(card({ kind: "number", events: ["$pageview"], property: "distinct_id" }).number).toMatchObject({ label: "Visitors", value: 2 });
  });

  it("retention: people by first day, and who came back (agents left out, simulated share labelled)", () => {
    const d = card({ kind: "retention" });
    expect(d.retention!.cohorts).toEqual([
      { day: "2026-09-24", size: 1, returned: [1, 1, 0] },
      { day: "2026-09-25", size: 1, returned: [1, 0] },
      { day: "2026-09-26", size: 2, returned: [2] },
    ]);
    expect(d.simulated).toBeCloseTo(3 / 14);
  });

  it("lifecycle: new, returning and gone quiet per day", () => {
    const rows = card({ kind: "lifecycle", interval: "day" }).lifecycle!.rows.slice(-3);
    expect(rows.map(({ new: nw, returning, resurrecting, dormant }) => [nw, returning, resurrecting, dormant])).toEqual([
      [1, 0, 0, 0],
      [1, 1, 0, 0],
      [2, 0, 0, 2],
    ]);
  });

  it("paths: where people go after viewing a product", () => {
    const p = card({ kind: "paths", from: "product_viewed" }).paths!;
    expect(p).toMatchObject({ from: "product_viewed", fromLabel: "Viewed a product", total: 3 });
    expect(p.paths.map((x) => x.steps)).toEqual(
      expect.arrayContaining([["Added to cart", "/", "Placed an order"], ["Left the store"], ["Added to cart", "Started checkout", "Placed an order"]]),
    );
  });

  it("breakdown: which sizes are added to cart", () => {
    const b = card({ kind: "breakdown", events: ["product_added"], property: "size" }).bars!;
    expect(b).toMatchObject({ property: "size", propertyLabel: "Size", total: 3 });
    expect(b.items.map((x) => [x.key, x.count])).toEqual([
      ["9", 2],
      ["10", 1],
    ]);
    const none = card({ kind: "breakdown", events: ["product_added"], property: "colour" });
    expect(none.empty).toBe(true);
    expect(none.note).toMatch(/none with a colour/);
  });

  it("time to convert: first visit to order, with the typical wait", () => {
    const h = card({ kind: "time_to_convert" }).histogram!;
    expect(h.total).toBe(3);
    expect(h.medianMs).toBe(10 * 60_000);
    const by = Object.fromEntries(h.bins.map((b) => [b.label, b.count]));
    expect(by).toMatchObject({ "1 – 5 min": 1, "5 – 30 min": 1, "1 – 7 days": 1 });
  });

  it("hourly: a day × hour grid with the busiest slot", () => {
    const g = card({ kind: "hourly", events: ["$pageview"] }).grid!;
    expect(g.total).toBe(5);
    expect(g.peak).toEqual({ day: "Sat", hour: 11, count: 2 });
    expect(g.cells[3][10]).toBe(1); // Thursday 10:00
  });

  it("waits for data instead of inventing it", () => {
    const plan = { ...heuristicPlan({ site: SITE }), dashboards: (["trend", "number", "retention", "paths", "lifecycle", "breakdown", "time_to_convert", "hourly"] as const).map((kind) => ({ id: kind, kind, title: kind, why: "" })) };
    expect(computeDashboards(SITE, plan, [], NOW).dashboards.every((d) => d.empty)).toBe(true);
  });
});

describe("asking for a chart in plain words", () => {
  const plan = heuristicPlan({ site: SITE, prompt: "sizing matters" });
  const ask = (q: string) => {
    const out = askForChart(plan, q);
    return { ...out, spec: out.plan.dashboards.find((d) => d.id === out.id)! };
  };

  it.each([
    ["show add to cart over time", { kind: "trend", events: ["product_added"] }],
    ["orders per day by device", { kind: "trend", events: ["order_completed"], interval: "day", breakdown: "device" }],
    ["revenue per day", { kind: "trend", events: ["order_completed"], property: "revenue" }],
    ["people vs AI agents over time", { kind: "trend", events: ["$pageview"], breakdown: "visitor_kind" }],
    ["how many coupon codes today", { kind: "number", events: ["coupon_applied"], period: "today" }],
    ["how many visitors this week", { kind: "number", events: ["$pageview"], period: "week", property: "distinct_id" }],
    ["do shoppers come back", { kind: "retention" }],
    ["where do people go after the product page", { kind: "paths", from: "product_viewed" }],
    ["new vs returning shoppers", { kind: "lifecycle" }],
    ["which sizes are added to cart most", { kind: "breakdown", events: ["product_added"], property: "size" }],
    ["how long do people take to buy", { kind: "time_to_convert" }],
    ["when do people shop", { kind: "hourly", events: ["$pageview"] }],
  ])("%s", (q, want) => {
    const { spec } = ask(q);
    expect(spec).toMatchObject({ ...want, custom: true });
    // The plan (with the new fields) still passes the schema the browser copy is checked against.
    expect(TrackingPlanSchema.safeParse(askForChart(plan, q).plan).success).toBe(true);
  });

  it("adds tracking the store doesn't send yet", () => {
    const out = ask("how many coupon codes today");
    expect(out.plan.events.find((e) => e.name === "coupon_applied")).toMatchObject({ enabled: true, fromPrompt: true });
    expect(out.reply).toMatch(/doesn't send coupon_applied yet/);
  });

  it("keeps the older asks as they were", () => {
    expect(ask("mobile vs desktop conversion").spec.kind).toBe("devices");
    expect(askForChart(plan, "where do shoppers come from").id).toBe("sources");
    expect(ask("funnel from product view to order").spec.kind).toBe("funnel");
  });
});
