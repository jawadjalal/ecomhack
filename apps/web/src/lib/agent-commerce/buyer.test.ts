import { beforeEach, describe, expect, it } from "vitest";
import type { ShoppingGoal } from "@/lib/contracts";
import { callAgentTool, listAgentSessions, parseGoalBrief, runBuyerAgent, sampleShoppingGoal, PROCEED_ANYWAY } from "./index";
import { runLlmBuyer, type BuyerAction } from "./buyer-llm";
import { unitHash } from "./buyer";
import { ctx, eventsNamed, OPEN_SURFACE, resetWorld, useSpec } from "./test-utils";

beforeEach(resetWorld);

const FRIDAY_GOAL: ShoppingGoal = {
  brief: "Trail shoes, UK 10, under £140, delivered by Friday",
  category: "trail",
  size: "10",
  maxBudget: 14000,
  deadlineDays: 3,
};

/** Session ids whose deterministic "gamble on a hidden ETA" roll says abandon / proceed. */
function sessionWhere(pred: (roll: number) => boolean): string {
  for (let i = 0; i < 500; i++) if (pred(unitHash(`ses_b${i}:eta`))) return `ses_b${i}`;
  throw new Error("no session found");
}

describe("parseGoalBrief", () => {
  it("extracts category, size, budget, deadline and requirements", () => {
    const saturday = new Date("2026-09-26T10:00:00Z");
    expect(parseGoalBrief("trail shoes UK 10 under £140 by Friday, free returns, happy to negotiate", saturday)).toEqual({
      brief: "trail shoes UK 10 under £140 by Friday, free returns, happy to negotiate",
      category: "trail",
      size: "10",
      maxBudget: 14000,
      deadlineDays: 6,
      requiresFreeReturns: true,
      negotiates: true,
    });
    expect(parseGoalBrief("road shoes size 9 within 2 days")).toMatchObject({ category: "road", size: "9", deadlineDays: 2 });
  });
});

describe("buyer agent (scripted)", () => {
  it("buys when the agent surface is complete", async () => {
    useSpec(OPEN_SURFACE);
    const session = await runBuyerAgent(FRIDAY_GOAL, ctx("full", { sessionId: "ses_full" }));
    expect(session.outcome).toBe("purchased");
    expect(session.goal).toEqual(FRIDAY_GOAL);
    expect(session.orderTotal).toBe(13500 + 495); // Ridge Trail Pro + shipping = £139.95 ≤ £140
    expect(session.toolCalls.map((t) => t.tool)).toEqual([
      "search_products",
      "get_product",
      "check_availability",
      "add_to_cart",
      "checkout",
    ]);
    expect(eventsNamed("order_completed")).toHaveLength(1);
    expect(eventsNamed("agent_abandoned")).toHaveLength(0);
  });

  it("abandons with a clear reason when delivery ETA is hidden", async () => {
    const sessionId = sessionWhere((r) => r >= PROCEED_ANYWAY.deliveryEtaDays);
    const session = await runBuyerAgent(FRIDAY_GOAL, ctx("eta", { sessionId }));
    expect(session.outcome).toBe("abandoned");
    expect(session.reason).toBe("no delivery ETA exposed — can't guarantee delivery by Friday");
    const [abandoned] = eventsNamed("agent_abandoned");
    expect(abandoned.properties).toMatchObject({ reason: session.reason, visitor_kind: "agent", $session_id: sessionId });
    // The miss is visible to analytics on the agent_request events too.
    expect(eventsNamed("agent_request")[0].properties.missing).toContain("deliveryEtaDays");
  });

  it("some buyers gamble on hidden info (deterministic per session)", async () => {
    useSpec({ agentSurface: { exposeStock: true, exposeLandedPrice: true } });
    const sessionId = sessionWhere((r) => r < PROCEED_ANYWAY.deliveryEtaDays);
    const session = await runBuyerAgent(FRIDAY_GOAL, ctx("gamble", { sessionId }));
    expect(session.outcome).toBe("purchased");
  });

  it("buys once the optimizer exposes the ETA", async () => {
    const sessionId = sessionWhere((r) => r >= PROCEED_ANYWAY.deliveryEtaDays);
    useSpec({ agentSurface: { exposeDeliveryEta: true, exposeStock: true, exposeLandedPrice: true } });
    const session = await runBuyerAgent(FRIDAY_GOAL, ctx("eta-on", { sessionId }));
    expect(session.outcome).toBe("purchased");
  });

  it("abandons when the known ETA misses the deadline", async () => {
    useSpec(OPEN_SURFACE);
    const session = await runBuyerAgent({ ...FRIDAY_GOAL, deadlineDays: 2 }, ctx("late"));
    expect(session.outcome).toBe("abandoned");
    expect(session.reason).toMatch(/takes 3 days to deliver — can't make it by Friday/);
  });

  it("negotiates into budget when negotiation is on, abandons when it is off", async () => {
    const tight: ShoppingGoal = { ...FRIDAY_GOAL, maxBudget: 12000, negotiates: true, deadlineDays: 5 };
    useSpec({ agentSurface: { exposeDeliveryEta: true, exposeStock: true, exposeLandedPrice: true } });
    const off = await runBuyerAgent(tight, ctx("neg-off"));
    expect(off.outcome).toBe("abandoned");
    expect(off.reason).toBe("£135.00 is over the £120.00 budget and the store won't negotiate");

    useSpec(OPEN_SURFACE);
    const on = await runBuyerAgent(tight, ctx("neg-on"));
    expect(on.outcome).toBe("purchased");
    expect(on.orderTotal).toBeLessThanOrEqual(12000);
    expect(on.negotiation?.length).toBeGreaterThanOrEqual(2);
    expect(on.negotiation!.length).toBeLessThanOrEqual(8);
  });

  it("abandons with the out-of-budget reason", async () => {
    useSpec(OPEN_SURFACE);
    const session = await runBuyerAgent({ brief: "carbon racing shoes UK 9 under £150", category: "racing", size: "9", maxBudget: 15000 }, ctx("budget"));
    expect(session.outcome).toBe("abandoned");
    expect(session.reason).toBe("no racing in UK 9 within £150.00");
  });

  it("abandons when the size is out of stock", async () => {
    useSpec(OPEN_SURFACE);
    const session = await runBuyerAgent({ brief: "carbon racing shoes UK 12", category: "racing", size: "12" }, ctx("oos"));
    expect(session.outcome).toBe("abandoned");
    expect(session.reason).toBe("Velocity Carbon is out of stock in UK 12");
  });

  it("is fast enough for the simulator and reproducible", async () => {
    const started = performance.now();
    const outcomes: string[] = [];
    for (let i = 0; i < 300; i++) {
      const s = await runBuyerAgent(FRIDAY_GOAL, ctx(`perf${i}`));
      outcomes.push(s.outcome);
    }
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000);
    const purchased = outcomes.filter((o) => o === "purchased").length;
    // Gen 0 hides the ETA: ~20% gamble, and of those some bail on hidden stock / landed price.
    expect(purchased).toBeGreaterThan(0);
    expect(purchased).toBeLessThan(120);
    expect(listAgentSessions(1000)).toHaveLength(300);

    resetWorld();
    const replay: string[] = [];
    for (let i = 0; i < 300; i++) replay.push((await runBuyerAgent(FRIDAY_GOAL, ctx(`perf${i}`))).outcome);
    expect(replay).toEqual(outcomes);
  });
});

describe("sampled agent population", () => {
  async function conversion(tag: string, n = 300) {
    const reasons = new Map<string, number>();
    let bought = 0;
    for (let i = 0; i < n; i++) {
      const { goal, persona } = sampleShoppingGoal(`ses_pop${i}`);
      const s = await runBuyerAgent(goal, ctx(`${tag}${i}`, { sessionId: `ses_pop${i}`, persona }));
      if (s.outcome === "purchased") bought++;
      else reasons.set(s.reason!.split(" — ")[0], (reasons.get(s.reason!.split(" — ")[0]) ?? 0) + 1);
    }
    return { rate: bought / n, reasons };
  }

  it("converts far better once the agent surface is open", async () => {
    const gen0 = await conversion("g0");
    resetWorld();
    useSpec(OPEN_SURFACE);
    const open = await conversion("g1");
    expect(gen0.reasons.get("no delivery ETA exposed")).toBeGreaterThan(20);
    expect(open.reasons.get("no delivery ETA exposed")).toBeUndefined();
    expect(open.rate).toBeGreaterThan(gen0.rate + 0.25);
  });

  it("never converts worse when the store starts negotiating (same shoppers)", async () => {
    const surface = OPEN_SURFACE.agentSurface!;
    resetWorld();
    useSpec({ agentSurface: { ...surface, negotiation: { enabled: false, maxDiscountPct: 0 } } });
    const off = await conversion("noneg");
    resetWorld();
    useSpec({ agentSurface: { ...surface, negotiation: { enabled: true, maxDiscountPct: 10 } } });
    const on = await conversion("neg");
    expect(on.rate).toBeGreaterThanOrEqual(off.rate);
  });
});

describe("buyer agent (LLM policy)", () => {
  it("follows the model's actions and enforces maxTotal on checkout", async () => {
    useSpec(OPEN_SURFACE);
    const script: BuyerAction[] = [
      { tool: "search_products", args: { category: "trail", size: "10", want: ["deliveryEtaDays"] } },
      { tool: "add_to_cart", args: { id: "p_ridge", size: "10" } },
      { tool: "checkout", args: {} },
    ];
    const c = ctx("llm");
    const result = await runLlmBuyer(FRIDAY_GOAL, (tool, args) => callAgentTool(tool, args, c), {
      decide: async (_goal, _tools, history) => script[history.length],
    });
    expect(result).toMatchObject({ outcome: "purchased", policy: "llm" });
    expect(result.steps[2].args).toEqual({ maxTotal: 14000 });
  });

  it("falls back to the scripted policy when no LLM is configured", async () => {
    useSpec(OPEN_SURFACE);
    const session = await runBuyerAgent(FRIDAY_GOAL, ctx("fallback"), { useLlm: true });
    expect(session.outcome).toBe("purchased");
  });
});
