import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, EventProperties } from "@/lib/contracts";
import { brandRates, storeSnapshot } from "./snapshot";

let seq = 0;
function ev(event: string, id: string, props: EventProperties = {}): AnalyticsEvent {
  seq++;
  return {
    uuid: `snap_${seq}`,
    event,
    distinct_id: id,
    timestamp: new Date(Date.parse("2026-09-26T12:00:00.000Z") + seq * 1000).toISOString(),
    properties: props,
  };
}

function shopper(id: string, kind: "human" | "agent", buy: boolean, extra: EventProperties = {}): AnalyticsEvent[] {
  const base = { visitor_kind: kind, $session_id: `s_${id}`, ...extra };
  const rows = [ev("$pageview", id, base), ev("product_viewed", id, base)];
  if (buy) rows.push(ev("order_completed", id, { ...base, revenue: 1000 }));
  return rows;
}

describe("storeSnapshot", () => {
  it("uses simulated shoppers in demo mode and labels them", () => {
    const events = [...shopper("h1", "human", true, { synthetic: true }), ...shopper("a1", "agent", true, { synthetic: true, agent_name: "chatgpt-shopper" })];
    const snap = storeSnapshot({ simulatedOk: true }, events);
    expect(snap.kind).toBe("simulated");
    expect(snap.simulated).toBe(true);
    expect(snap.summary.overall.visitors).toBe(2);
    expect(snap.summary.byKind.agent.conversionRate).toBe(1);
    expect(snap.brands.map((b) => b.name)).toContain("ChatGPT");
  });

  it("drops simulated events on a connected store and does not mix them into the rate", () => {
    const events = [
      ...shopper("real-h", "human", true, { synthetic: false }),
      ...shopper("real-a", "agent", false, { synthetic: false, agent_name: "Claude" }),
      ...shopper("sim-a", "agent", true, { synthetic: true, agent_name: "chatgpt-shopper" }),
      ...shopper("sim-h", "human", true, { synthetic: true }),
    ];
    const snap = storeSnapshot({ simulatedOk: false }, events);
    expect(snap.kind).toBe("real");
    expect(snap.simulated).toBe(false);
    expect(snap.summary.overall.visitors).toBe(2);
    expect(snap.summary.byKind.agent.visitors).toBe(1);
    expect(snap.summary.byKind.agent.conversionRate).toBe(0);
    expect(snap.summary.byKind.human.conversionRate).toBe(1);
    expect(snap.brands).toEqual([{ name: "Claude", shoppers: 1, bought: 0, rate: 0 }]);
    const people = snap.summary.byKind.human.conversionRate;
    const agents = snap.summary.byKind.agent.conversionRate;
    expect(people).not.toBe(agents);
    expect(snap.brands[0].rate).toBe(agents);
  });

  it("says there is no real data instead of citing simulated shoppers", () => {
    const events = shopper("sim", "agent", true, { synthetic: true, agent_name: "grok-shopper" });
    const snap = storeSnapshot({ simulatedOk: false }, events);
    expect(snap.kind).toBe("empty");
    expect(snap.emptyLine).toBe("No real shoppers yet.");
    expect(snap.summary.overall.visitors).toBe(0);
    expect(snap.brands).toEqual([]);
    expect(brandRates(events, false)).toEqual([]);
  });
});
