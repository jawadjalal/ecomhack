import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, TrackingPlan } from "@/lib/contracts";
import { assignBoard, funnelDrill, newBoard } from "./drill";
import { boardNames, boardsFor } from "./boards";

const t0 = Date.parse("2026-09-26T12:00:00Z");
let n = 0;
const ev = (who: string, event: string, props: Record<string, unknown> = {}): AnalyticsEvent => ({
  uuid: `u${n}`,
  event,
  distinct_id: who,
  timestamp: new Date(t0 + n++ * 1000).toISOString(),
  properties: { darwin_site: "shop", visitor_kind: "human", ...props } as AnalyticsEvent["properties"],
});

const plan: TrackingPlan = {
  site: "shop",
  events: [{ name: "product_added", label: "Added to cart", why: "", category: "funnel", automatic: false, enabled: true }],
  dashboards: [{ id: "f", kind: "funnel", title: "Steps", why: "", events: ["$pageview", "product_added", "order_completed"] }],
  author: "heuristic",
  createdAt: "2026-09-26T12:00:00Z",
  updatedAt: "2026-09-26T12:00:00Z",
};

describe("funnelDrill", () => {
  const events = [
    ev("a", "$pageview"), ev("a", "product_added"), ev("a", "order_completed"),
    ev("b", "$pageview"), ev("b", "product_added"), ev("b", "$pageleave"),
    ev("c", "$pageview", { visitor_kind: "agent", synthetic: true }), ev("c", "product_added", { visitor_kind: "agent", synthetic: true, abandon_reason: "no delivery date" }),
    ev("d", "$pageview"),
  ];
  it("counts who left between two steps, people vs agents, with reasons and journeys", () => {
    const d = funnelDrill("shop", plan, "f", 2, events)!;
    expect(d).toMatchObject({ from: "Added to cart", to: "order completed", previous: 3, dropped: 2, humans: 1, agents: 1, simulated: 1 });
    expect(d.reasons.map((r) => r.text)).toEqual(expect.arrayContaining(["AI agent said: no delivery date", "Left after “Added to cart”"]));
    expect(d.journeys[0].steps).toEqual(["Visited", "Added to cart"]);
  });
  it("returns nothing for an unknown card or step", () => {
    expect(funnelDrill("shop", plan, "nope", 1, events)).toBeUndefined();
    expect(funnelDrill("shop", plan, "f", 9, events)).toBeUndefined();
  });
});

describe("dashboard tabs", () => {
  it("puts cards in tabs by kind, and named ones only in their own tab", () => {
    expect(boardsFor({ kind: "funnel" })).toEqual(["Overview", "Checkout"]);
    expect(boardsFor({ kind: "humans-agents" })).toEqual(["Overview", "AI agents"]);
    expect(boardsFor({ kind: "trend", custom: true })).toEqual(["Your charts"]);
    expect(boardsFor({ kind: "trend", custom: true, board: "Launch" })).toEqual(["Launch"]);
    expect(boardNames([{ board: "Launch" }, {}])).toEqual(["Overview", "Checkout", "AI agents", "Your charts", "Launch"]);
  });
  it("makes a named dashboard with 2 to 4 charts, all tagged with the name", () => {
    const out = newBoard(plan, "My coupon launch");
    expect(out.ids.length).toBeGreaterThanOrEqual(2);
    expect(out.ids.length).toBeLessThanOrEqual(4);
    const tagged = out.plan.dashboards.filter((d) => d.board === "My coupon launch");
    expect(tagged.map((d) => d.id).sort()).toEqual([...out.ids].sort());
    expect(assignBoard(out.plan, out.ids[0], "Checkout").dashboards.find((d) => d.id === out.ids[0])?.board).toBe("Checkout");
  });
});
