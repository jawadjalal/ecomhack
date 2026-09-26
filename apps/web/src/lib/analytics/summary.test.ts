import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsEvent, EventProperties, FrictionSignal } from "@/lib/contracts";
import { compareVariants, getAnalyticsSummary, getAnalyticsSummaryShared, normalizePath, summarize } from "./summary";
import { eventStore, track } from "./store";

let seq = 0;
const T0 = Date.parse("2026-09-26T10:00:00.000Z");

/** Build an event; `ms` is milliseconds after T0. */
function ev(event: string, id: string, props: EventProperties = {}, ms = seq * 10): AnalyticsEvent {
  seq++;
  return {
    uuid: `u${seq}`,
    event,
    distinct_id: id,
    timestamp: new Date(T0 + ms).toISOString(),
    properties: { visitor_kind: id.startsWith("a") ? "agent" : "human", $session_id: `s_${id}`, ...props },
  };
}

const chain = (id: string, text: string) =>
  `button.btn.primary:attr__class="btn primary"attr__id="${id}"attr_id="${id}"nth-child="2"nth-of-type="1"text="${text}";div.flex:nth-child="1"nth-of-type="1"`;

function dataset(): AnalyticsEvent[] {
  seq = 0;
  const pdp = { $pathname: "/store/products/aurora-daily-trainer" };
  const checkout = { $pathname: "/store/checkout" };
  return [
    // h1: full funnel, sees shipping, buys → not shipping shock
    ev("$pageview", "h1", { $pathname: "/store" }),
    ev("product_viewed", "h1", pdp),
    ev("product_added", "h1", pdp),
    ev("checkout_started", "h1", checkout),
    ev("shipping_cost_revealed", "h1", { ...checkout, shipping: 495 }),
    ev("order_completed", "h1", { revenue: 12000 }),
    // h2: dead end on a product page
    ev("$pageview", "h2", { $pathname: "/store" }),
    ev("product_viewed", "h2", pdp),
    ev("$pageleave", "h2", { $current_url: "http://localhost:3000/store/products/aurora-daily-trainer?ref=grid" }),
    // h3: shipping shock via checkout_abandoned
    ev("$pageview", "h3"),
    ev("product_viewed", "h3", { $pathname: "/store/products/trailblazer" }),
    ev("product_added", "h3"),
    ev("checkout_started", "h3", checkout),
    ev("shipping_cost_revealed", "h3", { ...checkout, shipping: 495 }),
    ev("checkout_abandoned", "h3", checkout),
    // h4: shipping shock via no order
    ev("$pageview", "h4"),
    ev("product_viewed", "h4", pdp),
    ev("product_added", "h4", pdp),
    ev("checkout_started", "h4", checkout),
    ev("shipping_cost_revealed", "h4", { ...checkout, shipping: 495 }),
    // h5: 3 autocaptured clicks on one element within 2s → rage click; slow clicks elsewhere → not
    ev("$pageview", "h5", pdp),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("size-guide", "Size guide") }, 5000),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("size-guide", "Size guide") }, 5400),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("size-guide", "Size guide") }, 5800),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("reviews", "Reviews") }, 7000),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("reviews", "Reviews") }, 10000),
    ev("$autocapture", "h5", { ...pdp, $event_type: "click", $elements_chain: chain("reviews", "Reviews") }, 13000),
    // h6: posthog's own $rageclick on the same element as h5
    ev("$pageview", "h6", pdp),
    ev("$rageclick", "h6", { ...pdp, $elements_chain: chain("size-guide", "Size guide") }),
    // h7: synthetic human
    ev("$pageview", "h7", { synthetic: true }),
    // a1: missing fields, abandons
    ev("agent_request", "a1", { tool: "search_products", ok: true }),
    ev("agent_request", "a1", { tool: "get_product", ok: true, missing: ["delivery_eta", "return_policy"] }),
    ev("agent_abandoned", "a1", { reason: "no delivery ETA" }),
    // a2: missing field, an error, then buys
    ev("agent_request", "a2", { tool: "get_product", ok: true, missing: ["delivery_eta"] }),
    ev("agent_request", "a2", { tool: "add_to_cart", ok: true }),
    ev("agent_request", "a2", { tool: "checkout", ok: false, error: "card declined" }),
    ev("agent_request", "a2", { tool: "checkout", ok: true }),
    ev("order_completed", "a2", { revenue: 9000 }),
    // a3: abandons for the same reason after searching
    ev("agent_request", "a3", { tool: "search_products", ok: true, missing: ["delivery_eta"] }),
    ev("agent_abandoned", "a3", { reason: "no delivery ETA" }),
  ];
}

const find = (f: FrictionSignal[], kind: FrictionSignal["kind"], pred: (s: FrictionSignal) => boolean = () => true) =>
  f.filter((s) => s.kind === kind && pred(s));

describe("summarize: KPIs and funnels", () => {
  const s = summarize(dataset());

  it("counts visitors, orders and revenue per kind and overall", () => {
    expect(s.totalEvents).toBe(40);
    expect(s.byKind.human).toMatchObject({ visitors: 7, sessions: 7, orders: 1, revenue: 12000 });
    expect(s.byKind.agent).toMatchObject({ visitors: 3, orders: 1, revenue: 9000 });
    expect(s.overall).toMatchObject({ visitors: 10, sessions: 10, orders: 2, revenue: 21000, averageOrderValue: 10500 });
    expect(s.overall.conversionRate).toBeCloseTo(2 / 10);
    expect(s.from).toBe(new Date(T0).toISOString()); // min timestamp, not first appended
    expect(s.to).toBe(new Date(T0 + 13000).toISOString());
  });

  it("funnel steps (agents enter via agent_request)", () => {
    expect(s.byKind.human.funnel.map((f) => f.visitors)).toEqual([7, 4, 3, 3, 1]);
    expect(s.byKind.agent.funnel.map((f) => f.visitors)).toEqual([3, 0, 0, 0, 1]);
    expect(s.overall.funnel.map((f) => f.visitors)).toEqual([10, 4, 3, 3, 2]);
    const f = s.byKind.human.funnel;
    expect(f[1].rateFromStart).toBeCloseTo(4 / 7);
    expect(f[2].rateFromPrevious).toBeCloseTo(3 / 4);
    expect(f[4].rateFromPrevious).toBeCloseTo(1 / 3);
  });
});

describe("summarize: friction", () => {
  const { friction } = summarize(dataset());

  it("is sorted by count desc", () => {
    for (let i = 1; i < friction.length; i++) expect(friction[i - 1].count).toBeGreaterThanOrEqual(friction[i].count);
  });

  it("shipping shock: revealed then abandoned or never ordered", () => {
    const [shock] = find(friction, "shipping_shock");
    expect(shock).toMatchObject({ audience: "human", location: "/store/checkout", count: 2 });
    expect(shock.share).toBeCloseTo(2 / 7);
    expect(shock.detail).toContain("£4.95");
  });

  it("rage clicks: posthog $rageclick and ≥3 autocaptured clicks within 2s on one element", () => {
    const rage = find(friction, "rage_click");
    expect(rage).toHaveLength(1);
    expect(rage[0]).toMatchObject({ audience: "human", location: '/store/products/[id] button#size-guide "Size guide"', count: 2 });
    expect(rage[0].share).toBeCloseTo(2 / 7);
  });

  it("dead end: left a product page without adding to cart", () => {
    const dead = find(friction, "dead_end");
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ audience: "human", location: "/store/products/[id]", count: 1 });
  });

  it("agent missing fields, grouped by field, with the most common tool as location", () => {
    const [eta] = find(friction, "agent_missing_field", (x) => x.detail === "delivery_eta");
    expect(eta).toMatchObject({ audience: "agent", count: 3, location: "get_product" });
    expect(eta.share).toBe(1);
    expect(find(friction, "agent_missing_field", (x) => x.detail === "return_policy")[0]).toMatchObject({ count: 1 });
  });

  it("agent errors (ok === false) by tool, and abandons grouped by reason", () => {
    expect(find(friction, "agent_error")).toEqual([
      { kind: "agent_error", audience: "agent", location: "checkout", count: 1, share: 1 / 3, detail: "card declined" },
    ]);
    const [abandon] = find(friction, "agent_abandoned");
    expect(abandon).toMatchObject({ audience: "agent", count: 2, detail: "no delivery ETA" });
    expect(["get_product", "search_products"]).toContain(abandon.location);
    expect(abandon.share).toBeCloseTo(2 / 3);
  });

  it("agent tool stats", () => {
    const { agentTools } = summarize(dataset());
    expect(agentTools).toEqual([
      { tool: "checkout", calls: 2, errors: 1, missing: {} },
      { tool: "get_product", calls: 2, errors: 0, missing: { delivery_eta: 2, return_policy: 1 } },
      { tool: "search_products", calls: 2, errors: 0, missing: { delivery_eta: 1 } },
      { tool: "add_to_cart", calls: 1, errors: 0, missing: {} },
    ]);
  });
});

describe("summarize: filters", () => {
  const events = dataset();

  it("includeSynthetic=false drops simulated traffic", () => {
    expect(summarize(events, { includeSynthetic: false }).byKind.human.visitors).toBe(6);
    expect(summarize(events).byKind.human.visitors).toBe(7);
  });

  it("visitorKind, time window", () => {
    const agents = summarize(events, { visitorKind: "agent" });
    expect(agents.overall.visitors).toBe(3);
    expect(agents.byKind.human.visitors).toBe(0);
    expect(agents.friction.every((f) => f.audience === "agent")).toBe(true);
    const early = summarize(events, { to: new Date(T0 + 55).toISOString() });
    expect(early.totalEvents).toBe(6);
    expect(summarize(events, { from: "2030-01-01" }).totalEvents).toBe(0);
  });

  it("experiment / variant / specVersion", () => {
    const tagged = [
      ev("$pageview", "x1", { experiment_id: "e1", variant: "treatment", spec_version: 2 }),
      ev("$pageview", "x2", { experiment_id: "e1", variant: "control", spec_version: 1 }),
      ev("$pageview", "x3", { spec_version: 1 }),
    ];
    expect(summarize(tagged, { experimentId: "e1" }).overall.visitors).toBe(2);
    expect(summarize(tagged, { experimentId: "e1", variant: "control" }).overall.visitors).toBe(1);
    expect(summarize(tagged, { specVersion: 1 }).overall.visitors).toBe(2);
  });
});

describe("compareVariants", () => {
  function experiment(): AnalyticsEvent[] {
    seq = 0;
    const c = { experiment_id: "exp_1", variant: "control" };
    const t = { experiment_id: "exp_1", variant: "treatment" };
    return [
      ev("order_completed", "h9", { revenue: 5000 }), // before any exposure → ignored
      ev("$pageview", "h9", c),
      ev("$pageview", "h10", c),
      ev("order_completed", "h10", { ...c, revenue: 10000 }),
      ev("$pageview", "h11", t),
      ev("order_completed", "h11", { revenue: 11000 }), // no attribution on the order → exposure arm
      ev("$pageview", "h12", t),
      ev("$pageview", "h12", c), // forced preview: stays in first arm (treatment)
      ev("order_completed", "h12", { ...c, revenue: 3000 }),
      ev("order_completed", "h12", { experiment_id: "exp_other", variant: "treatment", revenue: 999 }), // other experiment
      ev("agent_request", "a9", t),
      ev("order_completed", "a9", { ...t, revenue: 8000 }),
      ev("agent_request", "a10", c),
      ev("$pageview", "h13", { ...t, synthetic: true }),
    ];
  }

  it("per-variant visitors / conversions / revenue, overall and by kind", () => {
    const r = compareVariants("exp_1", {}, experiment());
    expect(r.control).toMatchObject({ variant: "control", visitors: 3, conversions: 1, revenue: 10000 });
    expect(r.control.byKind.human).toMatchObject({ visitors: 2, conversions: 1, revenue: 10000 });
    expect(r.control.byKind.agent).toMatchObject({ visitors: 1, conversions: 0, revenue: 0 });
    expect(r.treatment).toMatchObject({ variant: "treatment", visitors: 4, conversions: 3, revenue: 22000 });
    expect(r.treatment.conversionRate).toBeCloseTo(3 / 4);
    expect(r.treatment.byKind.human).toMatchObject({ visitors: 3, conversions: 2, revenue: 14000 });
    expect(r.treatment.byKind.agent).toMatchObject({ visitors: 1, conversions: 1, conversionRate: 1, revenue: 8000 });
  });

  it("respects includeSynthetic and always returns both arms", () => {
    expect(compareVariants("exp_1", { includeSynthetic: false }, experiment()).treatment.visitors).toBe(3);
    const empty = compareVariants("nope", {}, experiment());
    expect(empty.control).toMatchObject({ visitors: 0, conversions: 0, conversionRate: 0 });
    expect(empty.treatment.byKind.agent.visitors).toBe(0);
  });
});

describe("store + getAnalyticsSummary", () => {
  beforeEach(() => eventStore().clear());

  it("reads from the store; dedupes retried uuids; live cursor survives resets", () => {
    const stored = track(dataset());
    expect(stored).toHaveLength(40);
    expect(track(dataset())).toHaveLength(0); // same uuids → deduped
    expect(getAnalyticsSummary().totalEvents).toBe(40);

    const last = eventStore().since(undefined, 1)[0];
    expect(eventStore().since(last.uuid, 10)).toEqual([]);
    const next = track({ event: "$pageview", distinct_id: "h99", properties: { visitor_kind: "human" } });
    expect(eventStore().since(last.uuid, 10)).toEqual(next);
    // Unknown (evicted / reset) cursor → latest events instead of the whole history.
    expect(eventStore().since("gone", 2).map((e) => e.distinct_id)).toEqual(["a3", "h99"]);
  });

  it("shares the summary between polls until an event arrives or the store resets", () => {
    track(dataset());
    const first = getAnalyticsSummaryShared();
    expect(getAnalyticsSummaryShared()).toBe(first);
    expect(getAnalyticsSummaryShared({ visitorKind: "agent" })).not.toBe(first);

    track({ event: "$pageview", distinct_id: "h99", properties: { visitor_kind: "human" } });
    const afterEvent = getAnalyticsSummaryShared();
    expect(afterEvent).not.toBe(first);
    expect(afterEvent.totalEvents).toBe(first.totalEvents + 1);
    expect(afterEvent).toEqual(getAnalyticsSummary());

    eventStore().clear();
    expect(getAnalyticsSummaryShared().totalEvents).toBe(0);
  });
});

describe("normalizePath", () => {
  it.each([
    ["/store/products/aurora-daily-trainer", "/store/products/[id]"],
    ["/store/products/aurora-daily-trainer/", "/store/products/[id]"],
    ["/store/p/p_aurora?x=1#top", "/store/p/[id]"],
    ["/store/orders/12345/confirmation", "/store/orders/[id]/confirmation"],
    ["/store/checkout", "/store/checkout"],
    ["/", "/"],
  ])("%s → %s", (input, out) => expect(normalizePath(input)).toBe(out));
});
