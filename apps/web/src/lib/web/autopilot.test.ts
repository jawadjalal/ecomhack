import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebRuleResult } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { AUTOPILOT, getAutopilot, judge, listRules, resetAutopilot, resetWebRules, setAutopilot, simulateWebTraffic, stepAutopilot, webState } from ".";

const SITE = "north-trail";

beforeEach(() => {
  resetWebRules();
  resetAutopilot();
  eventStore().clear();
});
afterEach(() => {
  resetWebRules();
  resetAutopilot();
});

const arm = (visitors: number, conversions: number) => ({ visitors, conversions, conversionRate: conversions / visitors });
const result = (c: [number, number], t: [number, number], p: number, lift = 0.3): WebRuleResult => ({
  ruleId: "wr_x",
  control: arm(...c),
  treatment: arm(...t),
  probabilityToBeat: p,
  lift,
  bySource: {},
  synthetic: true,
});

describe("autopilot decisions", () => {
  it("ships clear winners, stops losers and endless tests, and waits otherwise", () => {
    expect(judge(result([400, 10], [400, 22], 0.98))).toMatchObject({ decision: "shipped", reason: expect.stringContaining("98% chance better") });
    expect(judge(result([400, 10], [400, 22], 0.96))).toBeUndefined(); // 96%: not yet, with peeking every few seconds
    expect(judge(result([400, 24], [400, 9], 0.03, -0.6))).toMatchObject({ decision: "stopped", reason: expect.stringMatching(/^losing/) });
    expect(judge(result([400, 4], [400, 1], 0.03, -0.75))).toBeUndefined(); // 5 orders: luck, not evidence
    expect(judge(result([3000, 90], [3000, 92], 0.55))).toMatchObject({ decision: "stopped", reason: expect.stringMatching(/^no clear winner/) });
    expect(judge(result([100, 2], [100, 8], 0.99))).toBeUndefined(); // too few visitors yet
    expect(judge(result([400, 12], [400, 14], 0.6))).toBeUndefined();
    expect(judge(undefined)).toBeUndefined();
  });
});

describe("autopilot loop", () => {
  it("waits for traffic, then starts one test per source where the gap is biggest", () => {
    setAutopilot(SITE, true);
    expect(stepAutopilot(SITE).actions.map((a) => a.kind)).toEqual(["waiting"]);
    expect(stepAutopilot(SITE).actions).toEqual([]); // doesn't repeat itself

    simulateWebTraffic({ site: SITE, visitors: 1500, rules: [], url: "https://n.example/", seed: 3 });
    const { actions, state } = stepAutopilot(SITE);
    const started = actions.filter((a) => a.kind === "started");
    expect(started).toHaveLength(AUTOPILOT.maxRunning);
    expect(new Set(started.map((a) => a.source)).size).toBe(AUTOPILOT.maxRunning);
    const running = listRules(SITE).filter((r) => r.status === "running");
    expect(running.every((r) => r.author === "autopilot" && r.mode === "test" && r.audience.sources?.length === 1)).toBe(true);
    expect(state.tried).toHaveLength(3);
    expect(state.log[0].kind).toBe("started");
    expect(webState(SITE).autopilot.on).toBe(true);
  });

  it("keeps its invariants over many rounds: ≤3 tests, one per source, no idea retried, every ended test says why", () => {
    setAutopilot(SITE, true);
    for (let round = 0; round < 25; round++) {
      simulateWebTraffic({ site: SITE, visitors: 2000, rules: listRules(SITE), url: "https://n.example/", seed: 100 + round });
      stepAutopilot(SITE);
      const rules = listRules(SITE);
      const running = rules.filter((r) => r.status === "running");
      expect(running.length).toBeLessThanOrEqual(AUTOPILOT.maxRunning);
      const sources = running.flatMap((r) => r.audience.sources ?? []);
      expect(new Set(sources).size).toBe(sources.length);
    }
    const state = getAutopilot(SITE);
    expect(new Set(state.tried).size).toBe(state.tried.length);
    const ended = listRules(SITE).filter((r) => r.status === "shipped" || r.status === "paused");
    expect(ended.length).toBeGreaterThan(0);
    expect(ended.every((r) => r.outcome?.by === "autopilot" && r.outcome.reason.includes("visitors"))).toBe(true);
    expect(state.log.some((e) => e.kind === "shipped" || e.kind === "stopped")).toBe(true);
    expect(state.log.length).toBeLessThanOrEqual(AUTOPILOT.maxLog);
  }, 60_000); // 25 rounds of 2,000 simulated visitors (~7 s alone; slower when the machine is busy)

  it("turns on and off with a log line each way", () => {
    expect(setAutopilot(SITE, true).log[0].kind).toBe("on");
    expect(setAutopilot(SITE, true).log).toHaveLength(1); // idempotent
    expect(setAutopilot(SITE, false).log.map((e) => e.kind)).toEqual(["off", "on"]);
  });
});
