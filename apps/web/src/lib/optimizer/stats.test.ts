import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, VariantStats } from "@/lib/contracts";
import { comparePosteriors, decide, evaluateArms, metricAudience, variantStatsFromEvents, DEFAULT_DECISION } from "./stats";

function arm(variant: string, visitors: number, conversions: number): VariantStats {
  const k = { visitors, conversions, conversionRate: visitors ? conversions / visitors : 0 };
  return {
    variant,
    visitors,
    conversions,
    revenue: conversions * 10000,
    conversionRate: k.conversionRate,
    byKind: { human: k, agent: { visitors: 0, conversions: 0, conversionRate: 0 } },
  };
}

describe("posterior comparison", () => {
  it("is ~50/50 with no data and with identical arms", () => {
    expect(comparePosteriors({ visitors: 0, conversions: 0 }, { visitors: 0, conversions: 0 }).probabilityToBeat).toBeCloseTo(0.5, 1);
    const same = comparePosteriors({ visitors: 2000, conversions: 100 }, { visitors: 2000, conversions: 100 });
    expect(same.probabilityToBeat).toBeGreaterThan(0.4);
    expect(same.probabilityToBeat).toBeLessThan(0.6);
    expect(same.liftInterval[0]).toBeLessThan(0);
    expect(same.liftInterval[1]).toBeGreaterThan(0);
  });

  it("is confident about a clear winner and brackets the true lift", () => {
    const res = comparePosteriors({ visitors: 1000, conversions: 50 }, { visitors: 1000, conversions: 100 });
    expect(res.probabilityToBeat).toBeGreaterThan(0.99);
    expect(res.liftInterval[0]).toBeGreaterThan(0.2);
    expect(res.liftInterval[1]).toBeGreaterThan(1);
    expect(res.medianLift).toBeGreaterThan(0.7);
    expect(res.medianLift).toBeLessThan(1.3);
  });

  it("is deterministic for a given seed", () => {
    const a = comparePosteriors({ visitors: 500, conversions: 20 }, { visitors: 500, conversions: 27 }, { seed: 7 });
    const b = comparePosteriors({ visitors: 500, conversions: 20 }, { visitors: 500, conversions: 27 }, { seed: 7 });
    expect(a).toEqual(b);
  });
});

describe("decisions", () => {
  it("ships a clear winner once both arms have enough visitors", () => {
    const res = evaluateArms(arm("control", 800, 40), arm("treatment", 800, 80), 1);
    expect(res.decision).toBe("ship");
    expect(res.lift).toBeCloseTo(1, 5);
  });

  it("never ships identical arms: keeps running, then inconclusive", () => {
    for (let round = 1; round <= DEFAULT_DECISION.maxRounds; round++) {
      const res = evaluateArms(arm("control", 400 * round, 20 * round), arm("treatment", 400 * round, 20 * round), round);
      expect(res.decision).not.toBe("ship");
      expect(res.decision).toBe(round < DEFAULT_DECISION.maxRounds ? "running" : "inconclusive");
    }
  });

  it("rejects a clear loser", () => {
    expect(evaluateArms(arm("control", 800, 80), arm("treatment", 800, 40), 1).decision).toBe("reject");
  });

  it("waits for the minimum sample size even when the signal looks strong", () => {
    expect(decide({ probabilityToBeat: 0.999, controlVisitors: 120, treatmentVisitors: 130, round: 1 })).toBe("running");
    expect(decide({ probabilityToBeat: 0.999, controlVisitors: 400, treatmentVisitors: 400, round: 1 })).toBe("ship");
    expect(decide({ probabilityToBeat: 0.02, controlVisitors: 400, treatmentVisitors: 399, round: 1 })).toBe("running");
  });

  it("handles a zero-conversion control without dividing by zero", () => {
    const res = evaluateArms(arm("control", 500, 0), arm("treatment", 500, 12), 1);
    expect(Number.isFinite(res.lift)).toBe(true);
    expect(res.probabilityToBeat).toBeGreaterThan(0.99);
  });
});

describe("audience-scoped (triggered) analysis", () => {
  it("measures agentSurface-only patches on agents", () => {
    expect(metricAudience({ agentSurface: { exposeDeliveryEta: true } })).toBe("agent");
    expect(metricAudience({ agentSurface: { exposeReturnPolicy: true }, productPage: { showReturnsPolicy: true } })).toBe("all");
    expect(metricAudience({ cart: { showShippingUpfront: true } })).toBe("all");
    expect(metricAudience({})).toBe("all");
  });

  it("finds an agent effect that the all-visitor metric would dilute", () => {
    const withAgents = (humans: number, humanConv: number, agents: number, agentConv: number, variant: string): VariantStats => {
      const h = { visitors: humans, conversions: humanConv, conversionRate: humanConv / humans };
      const a = { visitors: agents, conversions: agentConv, conversionRate: agentConv / agents };
      const visitors = humans + agents;
      const conversions = humanConv + agentConv;
      return { variant, visitors, conversions, revenue: 0, conversionRate: conversions / visitors, byKind: { human: h, agent: a } };
    };
    const control = withAgents(1000, 200, 110, 11, "control");
    const treatment = withAgents(1000, 190, 110, 38, "treatment");
    const all = evaluateArms(control, treatment, 2);
    const agents = evaluateArms(control, treatment, 2, DEFAULT_DECISION, 1, "agent");
    expect(all.decision).toBe("running");
    expect(agents.decision).toBe("ship");
    expect(agents.audience).toBe("agent");
    expect(agents.lift).toBeCloseTo(38 / 11 - 1, 5);
  });
});

describe("variant stats from events", () => {
  it("counts distinct visitors and buyers, split by kind", () => {
    const ev = (event: string, id: string, kind: "human" | "agent", revenue?: number): AnalyticsEvent => ({
      uuid: `${id}-${event}-${Math.random()}`,
      event,
      distinct_id: id,
      timestamp: new Date().toISOString(),
      properties: { visitor_kind: kind, ...(revenue ? { revenue } : {}) },
    });
    const stats = variantStatsFromEvents("treatment", [
      ev("$pageview", "h1", "human"),
      ev("product_viewed", "h1", "human"),
      ev("order_completed", "h1", "human", 11500),
      ev("order_completed", "h1", "human", 1800), // repeat buyer counts once for conversion
      ev("$pageview", "h2", "human"),
      ev("agent_request", "a1", "agent"),
      ev("order_completed", "a1", "agent", 9500),
      ev("agent_request", "a2", "agent"),
    ]);
    expect(stats.visitors).toBe(4);
    expect(stats.conversions).toBe(2);
    expect(stats.conversionRate).toBe(0.5);
    expect(stats.revenue).toBe(11500 + 1800 + 9500);
    expect(stats.byKind.human).toEqual({ visitors: 2, conversions: 1, conversionRate: 0.5 });
    expect(stats.byKind.agent).toEqual({ visitors: 2, conversions: 1, conversionRate: 0.5 });
  });
});
