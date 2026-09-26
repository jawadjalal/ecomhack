import { describe, expect, it } from "vitest";
import { FUNNEL_STEPS, type AgentSessionSummary, type AnalyticsSummary, type Experiment, type LoopState, type SegmentKpis } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { ask, brandOf, buildContext, heuristicAnswer, intentOf, type AskContext } from "./index";

function kpis(counts: number[]): SegmentKpis {
  const first = Math.max(1, counts[0]);
  const funnel = FUNNEL_STEPS.map((step, i) => ({
    step,
    visitors: counts[i] ?? 0,
    rateFromStart: (counts[i] ?? 0) / first,
    rateFromPrevious: i === 0 ? 1 : counts[i - 1] ? (counts[i] ?? 0) / counts[i - 1] : 0,
  }));
  const orders = counts[4] ?? 0;
  return { visitors: counts[0], sessions: counts[0], orders, revenue: orders * 11500, conversionRate: counts[0] ? orders / counts[0] : 0, averageOrderValue: 11500, funnel };
}

function summary(human: number[], agent: number[]): AnalyticsSummary {
  const h = kpis(human);
  const a = kpis(agent);
  const overall = kpis(human.map((v, i) => v + (agent[i] ?? 0)));
  return { from: "", to: "", totalEvents: 0, overall, byKind: { human: h, agent: a }, friction: [], agentTools: [] };
}

function loop(extra: Partial<LoopState> = {}): LoopState {
  return {
    phase: "experiment",
    autopilot: false,
    generation: 1,
    liveSpec: DEFAULT_SPEC,
    insights: [
      { id: "i1", title: "Agents can't see a delivery date", audience: "agent", severity: "high", stage: "agent: catalog", detail: "", evidence: [], impactScore: 9.5 },
      { id: "i2", title: "Shipping shown late", audience: "human", severity: "medium", stage: "checkout", detail: "", evidence: [], impactScore: 5.9 },
    ],
    history: [],
    log: [],
    updatedAt: "",
    ...extra,
  };
}

function experiment(p: number, a = 0.054, b = 0.092): Experiment {
  const arm = (variant: string, rate: number) => ({
    variant,
    visitors: 1000,
    conversions: Math.round(rate * 1000),
    revenue: 0,
    conversionRate: rate,
    byKind: { human: { visitors: 900, conversions: 20, conversionRate: 0.022 }, agent: { visitors: 100, conversions: 19, conversionRate: variant === "control" ? 0.19 : 0.33 } },
  });
  return {
    id: "exp_1",
    name: "Shipping in the bag",
    status: "running",
    createdAt: "",
    proposalId: "p1",
    controlVersion: 1,
    treatmentSpec: DEFAULT_SPEC,
    allocation: 0.5,
    primaryMetric: "order_completed",
    result: { control: arm("control", a), treatment: arm("treatment", b), lift: (b - a) / a, probabilityToBeat: p, liftInterval: [0, 1], decision: "running" },
  };
}

function session(agentName: string, outcome: AgentSessionSummary["outcome"], reason?: string): AgentSessionSummary {
  return { sessionId: `s_${Math.random()}`, agentName, startedAt: "", outcome, reason, toolCalls: [], synthetic: true };
}

function ctx(p = 0.95, extra: Partial<Parameters<typeof buildContext>[0]> = {}): AskContext {
  return buildContext({
    summary: summary([552, 350, 105, 56, 12], [138, 110, 44, 34, 24]),
    loop: loop({ experimentId: "exp_1" }),
    experiment: experiment(p),
    sessions: [
      ...Array.from({ length: 7 }, () => session("perplexity-shop", "purchased")),
      ...Array.from({ length: 19 }, () => session("perplexity-shop", "abandoned", "no delivery ETA exposed")),
      ...Array.from({ length: 9 }, () => session("gpt-shopping-agent", "purchased")),
      ...Array.from({ length: 32 }, () => session("gpt-shopping-agent", "abandoned", "too expensive")),
      session("gemini-shopper", "abandoned", "no delivery ETA exposed — can't guarantee delivery by Friday"),
      session("gemini-shopper", "abandoned", "no delivery ETA exposed"),
      session("grok-shopper", "in_progress"),
    ],
    shipThreshold: 0.975,
    ...extra,
  });
}

describe("ask: context", () => {
  it("groups agent sessions by brand and ranks them by conversion", () => {
    const c = ctx();
    expect(brandOf("gpt-shopping-agent")).toBe("ChatGPT");
    expect(c.brands.map((b) => b.name)).toEqual(["Perplexity", "ChatGPT", "Gemini"]);
    expect(c.brands[0]).toMatchObject({ shoppers: 26, bought: 7 });
    // in-progress sessions are not counted yet
    expect(c.brands.find((b) => b.name === "Grok")).toBeUndefined();
  });

  it("reads the running test on its audience and the store funnel", () => {
    const c = ctx(0.95);
    expect(c.test).toMatchObject({ a: 0.054, b: 0.092, chance: 0.95, shipAt: 0.975, audience: "all" });
    expect(c.funnel).toHaveLength(4);
    expect(c.funnel[3].step).toBe("Checkout → buy");
    expect(c.issues[0].n).toBe(1);
    expect(c.simulated).toBe(true);
  });
});

describe("ask: intents", () => {
  it.each([
    ["Is test B safe to ship?", "test"],
    ["What should we test after this?", "next"],
    ["What should I do next?", "next"],
    ["Which agents buy most?", "best-agent"],
    ["Do agents convert better than people?", "versus"],
    ["What's my conversion rate?", "conversion"],
    ["What's the biggest problem?", "issue"],
    ["hello", "overview"],
  ] as const)("%s → %s", (q, intent) => {
    expect(intentOf(q)).toBe(intent);
  });

  it("recognises a named shopper", () => {
    expect(intentOf("Why did gemini-shopper leave?", ctx())).toBe("leaver");
  });
});

describe("ask: heuristic answers", () => {
  it("answers conversion with real numbers and says the shoppers are simulated", () => {
    const res = heuristicAnswer("How well does my store convert?", ctx());
    expect(res.source).toBe("heuristic");
    expect(res.answer).toContain("5.2%");
    expect(res.answer).toContain("36 of 690");
    expect(res.answer).toMatch(/simulated/);
    expect(res.cards?.[0]).toEqual({ label: "Converts", value: "5.2%" });
  });

  it("says nearly when B is close to the ship bar", () => {
    const res = heuristicAnswer("Is test B safe to ship?", ctx(0.95));
    expect(res.answer).toMatch(/^Nearly/);
    expect(res.answer).toContain("97.5%");
    expect(res.cards).toEqual([
      { label: "A", value: "5.4%" },
      { label: "B", value: "9.2%" },
      { label: "Chance B wins", value: "95%" },
    ]);
  });

  it("says yes once B passes the bar, and recommends shipping", () => {
    expect(heuristicAnswer("Is test B safe to ship?", ctx(0.99)).answer).toMatch(/^Yes/);
    expect(heuristicAnswer("What should I do next?", ctx(0.99)).answer).toMatch(/^Ship B/);
  });

  it("compares agents and people and names the biggest funnel gap", () => {
    const res = heuristicAnswer("agents vs people?", ctx());
    expect(res.answer).toContain("17%");
    expect(res.answer).toContain("2.2%");
    expect(res.answer).toContain("checkout → buy");
  });

  it("names the best agent", () => {
    const res = heuristicAnswer("Which agents buy the most?", ctx());
    expect(res.answer).toMatch(/^Perplexity buys most often: 7 of its last 26/);
    expect(res.cards?.map((c) => c.label)).toEqual(["Perplexity", "ChatGPT", "Gemini"]);
  });

  it("points at the top issue", () => {
    const res = heuristicAnswer("What's the biggest leak?", ctx());
    expect(res.answer).toContain("issue 1: Agents can't see a delivery date");
    expect(res.cards?.[0].label).toBe("Issue 1");
  });

  it("explains why a named agent left and links the issue", () => {
    const res = heuristicAnswer("Why did gemini-shopper leave?", ctx());
    expect(res.answer).toContain("no delivery ETA exposed");
    expect(res.answer).toContain("issue 1");
  });

  it("copes with an empty store and no test", () => {
    const empty = buildContext({ summary: summary([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), loop: loop({ phase: "observe", insights: [] }), sessions: [], shipThreshold: 0.975 });
    expect(heuristicAnswer("conversion?", empty).answer).toMatch(/No shoppers yet/);
    expect(heuristicAnswer("is B safe to ship?", empty).answer).toMatch(/No test is running/);
    expect(heuristicAnswer("which agent is best?", empty).answer).toMatch(/No AI shoppers/);
    expect(heuristicAnswer("biggest issue?", empty).answer).toMatch(/still watching/);
  });
});

describe("ask: entry point", () => {
  it("falls back to the heuristic with no LLM configured", async () => {
    const prev = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "none";
    try {
      const res = await ask({ question: "Is test B safe to ship?" }, ctx(0.95));
      expect(res.source).toBe("heuristic");
      expect(res.cards).toHaveLength(3);
    } finally {
      if (prev === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = prev;
    }
  });
});
