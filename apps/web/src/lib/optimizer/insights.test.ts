import { describe, expect, it } from "vitest";
import { FUNNEL_STEPS, type AnalyticsSummary, type SegmentKpis } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { diagnose, insightKind } from "./insights";

/** Build KPIs from visitor counts at each funnel step. */
function kpis(counts: number[]): SegmentKpis {
  const first = Math.max(1, counts[0]);
  const funnel = FUNNEL_STEPS.map((step, i) => ({
    step,
    visitors: counts[i] ?? 0,
    rateFromStart: (counts[i] ?? 0) / first,
    rateFromPrevious: i === 0 ? 1 : counts[i - 1] ? (counts[i] ?? 0) / counts[i - 1] : 0,
  }));
  const orders = counts[4] ?? 0;
  return {
    visitors: counts[0],
    sessions: counts[0],
    orders,
    revenue: orders * 11500,
    conversionRate: counts[0] ? orders / counts[0] : 0,
    averageOrderValue: 11500,
    funnel,
  };
}

function summary(human: number[], agent: number[], extra: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  const h = kpis(human);
  const a = kpis(agent);
  const all = kpis(human.map((n, i) => n + (agent[i] ?? 0)));
  return {
    from: new Date().toISOString(),
    to: new Date().toISOString(),
    totalEvents: 1,
    overall: all,
    byKind: { human: h, agent: a },
    friction: [],
    agentTools: [],
    ...extra,
  };
}

// 1,200 humans: 60% browse, 18% add, 65% reach checkout, 34% of those order. 150 agents, 8% buy.
const BASELINE = summary([1200, 720, 130, 85, 29], [150, 40, 15, 13, 12]);

describe("diagnose", () => {
  it("falls back to a labelled spec audit when there is no traffic", () => {
    const insights = diagnose(summary([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), DEFAULT_SPEC);
    expect(insights.length).toBeGreaterThan(0);
    expect(insightKind(insights[0])).toBe("shipping_shock");
    for (const i of insights) {
      expect(i.evidence).toContainEqual({ label: "Basis", value: "Spec audit (not enough traffic yet)" });
      expect(i.severity).toBe("low");
    }
  });

  it("finds shipping shock from funnel shape + spec when friction data is empty", () => {
    const insights = diagnose(BASELINE, DEFAULT_SPEC);
    const kinds = insights.map(insightKind);
    expect(kinds[0]).toBe("shipping_shock");
    expect(kinds).toContain("weak_add_to_cart");
    expect(kinds).toContain("checkout_friction");
    expect(kinds).toContain("agent_blind");
    const top = insights[0];
    expect(top.title).toContain("66%"); // 1 - 29/85
    expect(top.detail).toContain("29 of 85");
    expect(top.impactScore).toBeGreaterThan(0);
    // sorted by impact
    for (let i = 1; i < insights.length; i++) expect(insights[i - 1].impactScore).toBeGreaterThanOrEqual(insights[i].impactScore);
  });

  it("stops blaming shipping once shipping is shown upfront", () => {
    const fixed = applyPatch(DEFAULT_SPEC, { cart: { showShippingUpfront: true } });
    const kinds = diagnose(BASELINE, fixed).map(insightKind);
    expect(kinds).not.toContain("shipping_shock");
  });

  it("uses real friction signals and agent tool stats when present", () => {
    const s = summary([1200, 720, 130, 85, 29], [150, 40, 15, 13, 12], {
      friction: [
        { kind: "shipping_shock", audience: "human", location: "/store/checkout", count: 49, share: 49 / 1200 },
        { kind: "rage_click", audience: "human", location: "/store/p/aurora", count: 22, share: 22 / 1200, detail: "Add to bag" },
        { kind: "agent_abandoned", audience: "agent", location: "checkout", count: 30, share: 0.2, detail: "no delivery ETA" },
      ],
      agentTools: [{ tool: "get_product", calls: 400, errors: 0, missing: { deliveryEtaDays: 180, landedPrice: 60 } }],
    });
    const insights = diagnose(s, DEFAULT_SPEC);
    const byKind = new Map(insights.map((i) => [insightKind(i), i]));
    const shock = byKind.get("shipping_shock")!;
    expect(shock.title).toBe("58% of checkouts die the moment shipping appears"); // 49 / 85
    expect(shock.evidence).toContainEqual({ label: "Left at shipping reveal", value: "49" });
    expect(byKind.get("cta_rage_clicks")?.title).toContain("22 shoppers rage-clicked");
    const eta = byKind.get("agent_missing_eta")!;
    expect(eta.audience).toBe("agent");
    expect(eta.evidence).toContainEqual({ label: "Abandoned over it", value: "30" });
    expect(byKind.has("agent_missing_landed_price")).toBe(true);
    expect(byKind.has("agent_blind")).toBe(false); // real telemetry replaces the fallback
  });

  it("does not report agent gaps the spec already covers", () => {
    const s = summary([1200, 720, 130, 85, 29], [150, 40, 15, 13, 12], {
      agentTools: [{ tool: "get_product", calls: 400, errors: 0, missing: { deliveryEtaDays: 180 } }],
    });
    const exposed = applyPatch(DEFAULT_SPEC, { agentSurface: { exposeDeliveryEta: true } });
    expect(diagnose(s, exposed).map(insightKind)).not.toContain("agent_missing_eta");
  });
});
