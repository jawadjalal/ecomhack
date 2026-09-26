import { beforeEach, describe, expect, it } from "vitest";
import type { LoopPhase, LoopState, PageSpec } from "@/lib/contracts";
import type { PullRequestResult, RepoRef } from "@/lib/github";
import { eventStore } from "@/lib/analytics/store";
import { getLiveSpec, promoteSpec } from "@/lib/spec/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { getRunningExperiment, listExperiments } from "@/lib/experiments/store";
import { candidateVersion, getLoopMemory, getLoopState, parseRepo, resetLoop, setAutopilot, stepLoop, type LoopOverrides } from "./loop";
import { createFakeSimulator } from "./testing/fake-simulator";
import { canonicalKey } from "./util";

function makeDeps(overrides: LoopOverrides = {}) {
  const prs: { repo: RepoRef; spec: PageSpec; summary: string }[] = [];
  const deps: LoopOverrides = {
    simulate: createFakeSimulator(),
    useLlm: false,
    openSpecPR: async (repo, spec, ctx): Promise<PullRequestResult> => {
      prs.push({ repo, spec, summary: ctx.summary });
      return {
        dryRun: false,
        url: `https://github.com/${repo.owner}/${repo.repo}/pull/${prs.length}`,
        number: prs.length,
        branch: `darwin/v${spec.version}`,
        title: spec.label,
        body: ctx.summary,
        files: [],
      };
    },
    ...overrides,
    config: {
      observeHumans: 1000,
      observeAgents: 150,
      roundHumans: 800,
      roundAgents: 120,
      exploreEvery: 3,
      targetRepo: "acme/storefront",
      ...overrides.config,
    },
  };
  return { deps, prs };
}

async function runUntil(deps: LoopOverrides, done: (s: LoopState) => boolean, maxSteps = 120) {
  let state = getLoopState();
  const phases: LoopPhase[] = [];
  for (let i = 0; i < maxSteps && !done(state); i++) {
    state = await stepLoop(deps);
    phases.push(state.phase);
  }
  return { state, phases };
}

describe("self-improvement loop", () => {
  beforeEach(async () => {
    await resetLoop();
  });

  it("walks the phases in order and records a Gen 0 baseline", async () => {
    // Small rounds (~150 visitors per arm) so round 1 can't reach a verdict yet.
    const { deps } = makeDeps({ config: { roundHumans: 280, roundAgents: 20 } });
    const seen: LoopPhase[] = [];
    let s = getLoopState();
    expect(s.phase).toBe("idle");
    for (let i = 0; i < 4; i++) {
      s = await stepLoop(deps);
      seen.push(s.phase);
    }
    expect(seen).toEqual(["observe", "diagnose", "propose", "experiment"]);
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ generation: 0, specVersion: 0 });
    expect(s.history[0].overallConversionRate).toBeGreaterThan(0);
    expect(s.insights.length).toBeGreaterThan(0);
    expect(s.proposal?.diff.length).toBeGreaterThan(0);
    const exp = getRunningExperiment()!;
    expect(exp.id).toBe(s.experimentId);
    expect(exp.controlVersion).toBe(0);
    expect(exp.treatmentSpec.version).toBe(candidateVersion(0, 1));
    expect(exp.result?.control.visitors).toBeGreaterThan(0);
    expect(exp.result?.treatment.visitors).toBeGreaterThan(0);
    const actors = new Set(s.log.map((l) => l.actor));
    for (const a of ["observer", "analyst", "designer", "experimenter"]) expect(actors.has(a as never)).toBe(true);
  });

  it("evolves the store over several generations, ships PRs and never retries a loser", async () => {
    const { deps, prs } = makeDeps();
    const { state } = await runUntil(deps, (s) => s.generation >= 4);

    expect(state.generation).toBeGreaterThanOrEqual(4);
    expect(getLiveSpec().version).toBe(state.generation);
    expect(state.liveSpec.version).toBe(state.generation);

    // One history record per generation, conversion improving overall.
    expect(state.history.map((h) => h.generation)).toEqual([0, 1, 2, 3, 4]);
    const [gen0, ...later] = state.history;
    const last = later.at(-1)!;
    expect(last.overallConversionRate).toBeGreaterThan(gen0.overallConversionRate * 1.5);
    for (const h of later) {
      expect(h.lift).toBeGreaterThan(0);
      expect(h.prUrl).toMatch(/^https:\/\/github\.com\/acme\/storefront\/pull\/\d+$/);
      expect(h.experimentId).toBeTruthy();
    }

    // The biggest leak gets fixed first.
    expect(getLiveSpec().cart.showShippingUpfront).toBe(true);

    // PRs carry the winning spec and an honest summary.
    expect(prs).toHaveLength(4);
    expect(prs[0].repo).toEqual({ owner: "acme", repo: "storefront" });
    expect(prs[0].spec.version).toBe(1);
    expect(prs[0].summary).toContain("simulated traffic");
    expect(prs[0].summary).toMatch(/P\(beats control\) = \d+%/);

    // Every tested patch is unique: rejected / inconclusive ideas are never retried.
    const memory = getLoopMemory();
    const keys = memory.tried.map((t) => canonicalKey(t.patch));
    expect(new Set(keys).size).toBe(keys.length);
    const losers = memory.tried.filter((t) => t.outcome !== "shipped");
    expect(losers.length).toBeGreaterThan(0); // the wildcard (urgency) backfires in the fake world
    expect(losers.some((t) => t.title === "Low-stock urgency on product pages" && t.outcome === "rejected")).toBe(true);

    // Experiments: all completed, shipped ones decided "ship", losers never shipped.
    const exps = listExperiments();
    expect(exps.every((e) => e.status === "completed")).toBe(true);
    expect(exps.filter((e) => e.result?.decision === "ship")).toHaveLength(4);
    expect(new Set(exps.map((e) => e.treatmentSpec.version)).size).toBe(exps.length);

    // Log is capped and tells the story.
    expect(state.log.length).toBeLessThanOrEqual(200);
    const text = state.log.map((l) => l.message).join("\n");
    expect(text).toMatch(/Verdict: SHIP/);
    expect(text).toMatch(/Verdict: REJECT/);
    expect(text).toMatch(/Pull request #1 opened/);
  }, 60_000);

  it("fixes the agent surface once humans are happy, judged on AI shoppers", async () => {
    // Start from a store whose human UX is already fixed, so the agent gap is the biggest leak.
    promoteSpec(
      applyPatch(DEFAULT_SPEC, {
        hero: { showSocialProof: true },
        productGrid: { showRatings: true, showQuickAdd: true },
        productPage: { ctaPosition: "sticky", showReviews: true, showDeliveryEstimate: true, showReturnsPolicy: true, trustBadges: true },
        cart: { showShippingUpfront: true, freeShippingThreshold: 6000 },
        checkout: { steps: 1, guestCheckout: true, expressPay: true },
      }),
      "Human UX fixed",
    );
    const { deps } = makeDeps();
    const { state } = await runUntil(deps, (s) => s.generation >= 1, 40);
    expect(state.generation).toBe(1);
    expect(getLiveSpec().agentSurface.exposeDeliveryEta).toBe(true);
    const shipped = listExperiments().find((e) => e.result?.decision === "ship")!;
    expect(shipped.result?.audience).toBe("agent");
    expect(state.history[1].agentConversionRate).toBeGreaterThan(state.history[0].agentConversionRate);
    expect(state.log.some((l) => l.message.includes("judge it on AI shoppers only"))).toBe(true);
  }, 30_000);

  it("keeps going when GitHub is unavailable (dry-run message)", async () => {
    const { deps } = makeDeps({
      openSpecPR: async () => {
        throw new Error("not implemented");
      },
    });
    const { state } = await runUntil(deps, (s) => s.generation >= 1);
    expect(state.generation).toBe(1);
    expect(state.history[1].prUrl).toBeUndefined();
    expect(state.log.some((l) => l.actor === "shipper" && l.message.startsWith("PR queued (dry run)"))).toBe(true);
  }, 30_000);

  it("survives a simulator with no traffic (spec audit, inconclusive tests)", async () => {
    const { deps } = makeDeps({
      simulate: async (o) => ({ humans: o.humans, agents: o.agents, events: 0, orders: 0, revenue: 0, byVariant: {} }),
    });
    const { state, phases } = await runUntil(deps, () => false, 12);
    expect(state.generation).toBe(0);
    expect(phases).toContain("decide");
    expect(state.log.some((l) => l.message.includes("audited the spec"))).toBe(true);
    expect(listExperiments().some((e) => e.result?.decision === "inconclusive")).toBe(true);
    expect(getLiveSpec().version).toBe(0);
  }, 30_000);

  it("ignores concurrent steps and a failing simulator", async () => {
    const { deps } = makeDeps();
    const [a, b] = await Promise.all([stepLoop(deps), stepLoop(deps)]);
    expect([a.phase, b.phase].sort()).toEqual(["idle", "observe"]);

    const broken = makeDeps({
      simulate: async () => {
        throw new Error("simulator exploded");
      },
    }).deps;
    await stepLoop(deps); // → diagnose
    await stepLoop(deps); // → propose
    const s = await stepLoop(broken); // experiment round fails
    expect(s.log.at(-1)?.message).toContain("simulator exploded");
    const next = await stepLoop(deps); // retries the round
    expect(next.phase === "experiment" || next.phase === "decide").toBe(true);
  }, 30_000);

  it("persists autopilot and resets everything", async () => {
    const { deps } = makeDeps();
    expect(setAutopilot(true).autopilot).toBe(true);
    await runUntil(deps, (s) => s.generation >= 1);
    expect(getLoopState().autopilot).toBe(true);
    expect(eventStore().all().length).toBeGreaterThan(0);

    const s = await resetLoop();
    expect(s).toMatchObject({ phase: "idle", generation: 0, autopilot: false, history: [], insights: [] });
    expect(s.liveSpec.version).toBe(0);
    expect(eventStore().all()).toHaveLength(0);
    expect(listExperiments()).toHaveLength(0);
    expect(getLoopMemory().tried).toHaveLength(0);
  }, 30_000);

  it("parses target repos", () => {
    expect(parseRepo("acme/store")).toEqual({ owner: "acme", repo: "store" });
    expect(parseRepo("https://github.com/acme/store.git")).toEqual({ owner: "acme", repo: "store" });
    expect(parseRepo("nope")).toBeUndefined();
  });
});
