import { describe, expect, it } from "vitest";
import { compareArms, MockEngine } from "./mock";
import { createConsoleApi } from "./api";
import { describeEvent, findPullRequest, parseDiffLine, prsByGeneration, sourceBadge, withStatusPrs } from "./format";

describe("mock engine", () => {
  it("walks the full loop and ships a winner with a PR", async () => {
    const engine = new MockEngine({ latency: 0 });
    let s = await engine.stepLoop();
    expect(s.phase).toBe("observe");
    expect(s.history[0]).toMatchObject({ generation: 0, humanConversionRate: 0.023, agentConversionRate: 0.18 });

    s = await engine.stepLoop();
    expect(s.phase).toBe("diagnose");
    expect(s.insights.length).toBeGreaterThan(1);
    expect(s.insights[0].impactScore).toBeGreaterThanOrEqual(s.insights[1].impactScore);

    s = await engine.stepLoop();
    expect(s.phase).toBe("propose");
    expect(s.proposal?.diff).toContain("cart.showShippingUpfront: false → true");

    s = await engine.stepLoop();
    expect(s.phase).toBe("experiment");
    const { experiments } = await engine.getExperiments();
    expect(experiments[0].result?.control.visitors).toBeGreaterThan(0);

    // P(beat) rises round after round, then the loop decides
    const ps: number[] = [experiments[0].result!.probabilityToBeat];
    while (s.phase === "experiment") {
      s = await engine.stepLoop();
      const e = (await engine.getExperiments()).experiments[0];
      ps.push(e.result!.probabilityToBeat);
    }
    expect(s.phase).toBe("decide");
    expect(ps.at(-1)).toBeGreaterThanOrEqual(0.965);
    expect(ps[0]).toBeLessThan(ps.at(-1)!);
    const decided = (await engine.getExperiments()).experiments[0];
    expect(decided.result?.decision).toBe("ship");
    expect(decided.status).toBe("completed");

    s = await engine.stepLoop();
    expect(s.phase).toBe("ship");
    expect(s.generation).toBe(1);
    expect(s.liveSpec.cart.showShippingUpfront).toBe(true);
    expect(s.history.map((h) => h.humanConversionRate)).toEqual([0.023, 0.031]);
    const pr = findPullRequest(s);
    expect(pr?.dryRun).toBe(true);
    expect(pr?.title).toMatch(/Gen 1/);

    s = await engine.stepLoop();
    expect(s.phase).toBe("observe");
  });

  it("tells the 4-generation story with one honest reject", async () => {
    const engine = new MockEngine({ latency: 0 });
    const decisions: string[] = [];
    let s = await engine.getLoop();
    for (let i = 0; i < 80 && s.generation < 4; i++) {
      s = await engine.stepLoop();
      if (s.phase === "decide") {
        const exps = (await engine.getExperiments()).experiments;
        decisions.push(exps.at(-1)!.result!.decision);
      }
    }
    expect(s.generation).toBe(4);
    expect(decisions).toEqual(["ship", "ship", "ship", "reject", "ship"]);
    expect(s.history.map((h) => h.humanConversionRate)).toEqual([0.023, 0.031, 0.038, 0.046, 0.05]);
    expect(s.history.map((h) => h.agentConversionRate)).toEqual([0.18, 0.34, 0.52, 0.63, 0.66]);
  });

  it("simulates traffic with events, sessions and a summary", async () => {
    const engine = new MockEngine({ latency: 0 });
    for (let i = 0; i < 20; i++) await engine.simulate({ humans: 12, agents: 3, spreadMinutes: 0 });
    const { events, cursor } = await engine.getEvents(undefined, 100);
    expect(events.length).toBe(100);
    expect(events.every((e) => e.properties.synthetic === true)).toBe(true);
    const next = await engine.getEvents(cursor);
    expect(next.events).toHaveLength(0);

    const summary = await engine.getSummary();
    expect(summary.byKind.human.visitors).toBe(240);
    expect(summary.byKind.agent.visitors).toBe(60);
    expect(summary.byKind.human.funnel[0].rateFromStart).toBe(1);
    expect(summary.friction.length).toBeGreaterThan(0);

    const { sessions } = await engine.getSessions(10);
    expect(sessions.length).toBe(10);
    expect(sessions[0].toolCalls[0].tool).toBe("search_products");
  });

  it("connects a repo as a dry-run PR", async () => {
    const engine = new MockEngine({ latency: 0 });
    const pr = await engine.connectRepo("https://github.com/acme/storefront");
    expect(pr.dryRun).toBe(true);
    expect(pr.files.length).toBeGreaterThan(0);
    expect((await engine.getGithubStatus()).repo).toBe("acme/storefront");
    await expect(engine.connectRepo("nope")).rejects.toThrow();
  });
});

describe("stats", () => {
  it("computes P(beat) sensibly", () => {
    expect(compareArms(50, 1000, 50, 1000).probabilityToBeat).toBeCloseTo(0.5, 1);
    expect(compareArms(50, 1000, 90, 1000).probabilityToBeat).toBeGreaterThan(0.99);
    expect(compareArms(90, 1000, 50, 1000).probabilityToBeat).toBeLessThan(0.01);
  });
});

describe("api client", () => {
  it("serves everything from the mock engine in mock mode", async () => {
    const api = createConsoleApi("mock", new MockEngine({ latency: 0 }));
    expect(api.mockedGroups()).toContain("optimizer");
    const s = await api.stepLoop();
    expect(s.phase).toBe("observe");
  });
});

describe("format", () => {
  it("maps proposal sources to chips", () => {
    // No model or provider names in the UI: AI-written vs built-in rules is all the merchant needs.
    expect(sourceBadge("llm:grok-4")).toEqual({ label: "Darwin AI", ai: true });
    expect(sourceBadge("llm:claude-opus-5")?.label).toBe("Darwin AI");
    expect(sourceBadge("llm:deepseek/deepseek-chat")?.label).toBe("Darwin AI");
    expect(sourceBadge("heuristic")).toEqual({ label: "Built-in rules", ai: false });
    expect(sourceBadge(undefined)).toBeUndefined();
  });

  it("maps optimizer PR payloads (full or partial) to generations", () => {
    const at = new Date().toISOString();
    const loop = {
      generation: 2,
      history: [
        { generation: 0, specVersion: 0, label: "Baseline", humanConversionRate: 0.02, agentConversionRate: 0.4, overallConversionRate: 0.06, shippedAt: at },
        { generation: 1, specVersion: 1, label: "Gen 1: A", humanConversionRate: 0.03, agentConversionRate: 0.6, overallConversionRate: 0.08, shippedAt: at },
        { generation: 2, specVersion: 2, label: "Gen 2: B", humanConversionRate: 0.04, agentConversionRate: 0.7, overallConversionRate: 0.1, shippedAt: at },
      ],
      log: [
        { at, phase: "ship" as const, actor: "shipper" as const, message: "Shipped v1", data: { specVersion: 1, diff: [] } },
        { at, phase: "ship" as const, actor: "shipper" as const, message: "PR queued (dry run): no token", data: { pr: { dryRun: true, queued: true, repo: "a/b" } } },
        { at, phase: "ship" as const, actor: "shipper" as const, message: "Shipped v2", data: { specVersion: 2 } },
        {
          at,
          phase: "ship" as const,
          actor: "shipper" as const,
          message: "PR opened",
          data: { pr: { dryRun: false, url: "https://github.com/a/b/pull/7", number: 7, branch: "darwin/gen-2-b", title: "Darwin Gen 2: B" } },
        },
      ],
    };
    const prs = prsByGeneration(loop);
    expect(prs.get(1)).toMatchObject({ dryRun: true, queued: true, note: "PR queued (dry run): no token" });
    expect(prs.get(2)).toMatchObject({ number: 7, url: "https://github.com/a/b/pull/7" });
    expect(findPullRequest(loop)?.number).toBe(7);
    const merged = withStatusPrs(prs, { recentPullRequests: [{ kind: "spec", specVersion: 1, url: "https://github.com/a/b/pull/5", number: 5, dryRun: false }] }, loop.history);
    expect(merged.get(1)).toMatchObject({ number: 5, dryRun: false });
  });

  it("parses diff lines", () => {
    expect(parseDiffLine("cart.showShippingUpfront: false → true")).toMatchObject({
      path: "cart.showShippingUpfront",
      before: "false",
      after: "true",
    });
  });

  it("describes events as friendly rows", () => {
    const row = describeEvent({
      uuid: "u1",
      event: "agent_abandoned",
      distinct_id: "agent_1",
      timestamp: new Date().toISOString(),
      properties: { visitor_kind: "agent", agent_name: "grok-shopper", reason: "no delivery ETA exposed", synthetic: true },
    });
    expect(row).toMatchObject({ kind: "agent", actor: "grok-shopper", tone: "bad", synthetic: true });
    expect(row.text).toBe("abandoned: no delivery ETA exposed");
  });
});
