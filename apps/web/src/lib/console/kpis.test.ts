import { describe, expect, it } from "vitest";
import type { AnalyticsFilter, AnalyticsSummary, SegmentKpis } from "@/lib/contracts";
import { compareRevenuePerVisitor, mixWeights, sameScope, standardizedRevenuePerVisitor } from "./kpis";

type Seg = { visitors: number; orders: number; revenue: number };

const kpis = (s: Seg): SegmentKpis => ({
  visitors: s.visitors,
  sessions: s.visitors,
  orders: s.orders,
  revenue: s.revenue,
  conversionRate: s.visitors ? s.orders / s.visitors : 0,
  averageOrderValue: s.orders ? s.revenue / s.orders : 0,
  funnel: [],
});

function summary(human: Seg, agent: Seg, filter: AnalyticsFilter = {}): AnalyticsSummary {
  const overall = { visitors: human.visitors + agent.visitors, orders: human.orders + agent.orders, revenue: human.revenue + agent.revenue };
  return {
    from: "2026-09-26T10:00:00.000Z",
    to: "2026-09-26T11:00:00.000Z",
    totalEvents: 0,
    overall: kpis(overall),
    byKind: { human: kpis(human), agent: kpis(agent) },
    friction: [],
    agentTools: [],
    filter,
  };
}

/** What the tile used to compute: pooled revenue over pooled visitors. */
const pooled = (s: AnalyticsSummary) => s.overall.revenue / s.overall.visitors;

// Gen 0 window: 7.8% of visitors are agents (console traffic driver mix). Humans 2.2%, agents 50%.
const gen0 = summary({ visitors: 9220, orders: 203, revenue: 203 * 12300 }, { visitors: 780, orders: 390, revenue: 390 * 12500 }, { specVersion: 0 });
// Gen 2 window: humans convert better (3.0%) and so do agents (53%), but only 2.1% of visitors are agents
// (observe batch + a human-only experiment's control arm).
const gen2 = summary({ visitors: 11354, orders: 341, revenue: 341 * 12300 }, { visitors: 245, orders: 130, revenue: 130 * 12500 }, { specVersion: 2 });

describe("revenue per visitor (console KPI)", () => {
  it("reproduces the bug: pooled revenue/visitor falls ~30% while both audiences convert better", () => {
    expect(gen2.byKind.human.conversionRate).toBeGreaterThan(gen0.byKind.human.conversionRate);
    expect(gen2.byKind.agent.conversionRate).toBeGreaterThan(gen0.byKind.agent.conversionRate);
    const old = (pooled(gen2) - pooled(gen0)) / pooled(gen0);
    expect(old).toBeLessThan(-0.25);
  });

  it("compares like with like: same mix on both sides, so better conversion shows as a rise", () => {
    const k = compareRevenuePerVisitor({ current: gen2, baseline: gen0, mix: { human: 9220, agent: 780 } });
    expect(k.basis).toBe("generation");
    expect(k.delta).toBeDefined();
    expect(k.delta!).toBeGreaterThan(0.1);
    // Gen 0 at its own mix is exactly its pooled revenue per visitor.
    expect(k.baseline).toBeCloseTo(pooled(gen0), 6);
    expect(k.note).toBe("vs Gen 0");
  });

  it("uses the baseline's own mix when the loop has no recorded Gen 0 sample sizes", () => {
    const k = compareRevenuePerVisitor({ current: gen2, baseline: gen0 });
    expect(k.weights!.agent).toBeCloseTo(0.078, 3);
    expect(k.delta!).toBeGreaterThan(0.1);
  });

  it("an unchanged store reads flat whatever the traffic mix", () => {
    const agentHeavy = summary({ visitors: 1000, orders: 22, revenue: 22 * 12300 }, { visitors: 500, orders: 250, revenue: 250 * 12500 }, { specVersion: 3 });
    const humanHeavy = summary({ visitors: 10000, orders: 220, revenue: 220 * 12300 }, { visitors: 100, orders: 50, revenue: 50 * 12500 }, { specVersion: 0 });
    const k = compareRevenuePerVisitor({ current: agentHeavy, baseline: humanHeavy });
    expect(Math.abs(pooled(agentHeavy) / pooled(humanHeavy) - 1)).toBeGreaterThan(1); // pooled: +100% or more
    expect(k.delta).toBeCloseTo(0, 10);
  });

  it("shows no delta when either side is below the sample floor", () => {
    const tinyGen0 = summary({ visitors: 80, orders: 2, revenue: 24600 }, { visitors: 10, orders: 5, revenue: 62500 }, { specVersion: 0 });
    const k = compareRevenuePerVisitor({ current: gen2, baseline: tinyGen0, mix: { human: 9220, agent: 780 } });
    expect(k.value).toBeDefined();
    expect(k.delta).toBeUndefined();
    expect(k.note).toMatch(/too small/);

    const tinyNow = summary({ visitors: 60, orders: 2, revenue: 24600 }, { visitors: 5, orders: 3, revenue: 37500 }, { specVersion: 2 });
    const k2 = compareRevenuePerVisitor({ current: tinyNow, baseline: gen0 });
    expect(k2.delta).toBeUndefined();
    expect(k2.basis).toBe("none");
  });

  it("falls back to all-time for display only, never comparing all-time with one generation", () => {
    const tinyNow = summary({ visitors: 60, orders: 2, revenue: 24600 }, { visitors: 5, orders: 3, revenue: 37500 }, { specVersion: 2 });
    const all = summary({ visitors: 40000, orders: 1100, revenue: 1100 * 12300 }, { visitors: 3000, orders: 1500, revenue: 1500 * 12500 });
    const k = compareRevenuePerVisitor({ current: tinyNow, baseline: gen0, all });
    expect(k.basis).toBe("all");
    expect(k.value).toBeDefined();
    expect(k.delta).toBeUndefined();
  });

  it("refuses to compare summaries from different filters (e.g. real-only vs with synthetic)", () => {
    const realOnly = { ...gen0, filter: { specVersion: 0, includeSynthetic: false } };
    expect(sameScope(gen2, realOnly)).toBe(false);
    expect(sameScope(gen2, gen0)).toBe(true);
    const k = compareRevenuePerVisitor({ current: gen2, baseline: realOnly });
    expect(k.delta).toBeUndefined();
  });

  it("ignores segments with zero weight and skips undefined inputs", () => {
    const humansOnly = summary({ visitors: 500, orders: 10, revenue: 123000 }, { visitors: 0, orders: 0, revenue: 0 });
    expect(standardizedRevenuePerVisitor(humansOnly, mixWeights({ human: 1, agent: 0 }))).toBeCloseTo(246, 6);
    expect(standardizedRevenuePerVisitor(humansOnly, mixWeights({ human: 1, agent: 1 }))).toBeUndefined();
    expect(mixWeights({ human: 0, agent: 0 })).toBeUndefined();
    expect(compareRevenuePerVisitor({}).basis).toBe("none");
  });
});
