import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopState, PageSpec } from "@/lib/contracts";
import type { PullRequestResult, RepoRef } from "@/lib/github";
import { getExperiment, getRunningExperiment } from "@/lib/experiments/store";
import { getLiveSpec, getSpecVersion } from "@/lib/spec/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { describeDiff } from "@/lib/spec/patch";
import { getLoopState, resetLoop, rollbackTo, RollbackError, stepLoop, type LoopOverrides } from "./loop";
import { createFakeSimulator } from "./testing/fake-simulator";

const ids = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/ids", () => ({
  id: (prefix: string) => `${prefix}_r${(ids.n++).toString(36).padStart(8, "0")}`,
  uuid: () => `00000000-0000-4000-8000-${(ids.n++).toString(16).padStart(12, "0")}`,
}));

function makeDeps() {
  const prs: { repo: RepoRef; spec: PageSpec; previous?: PageSpec; generation?: number }[] = [];
  const deps: LoopOverrides = {
    simulate: createFakeSimulator(),
    useLlm: false,
    openSpecPR: async (repo, spec, ctx): Promise<PullRequestResult> => {
      prs.push({ repo, spec, previous: ctx.previousSpec, generation: ctx.generation });
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
    config: {
      observeHumans: 1000,
      observeAgents: 150,
      roundHumans: 800,
      roundAgents: 120,
      minVisitors: 400,
      maxRounds: 4,
      exploreEvery: 3,
      targetRepo: "acme/storefront",
    },
  };
  return { deps, prs };
}

async function runUntil(deps: LoopOverrides, done: (s: LoopState) => boolean, maxSteps = 120) {
  let state = getLoopState();
  for (let i = 0; i < maxSteps && !done(state); i++) state = await stepLoop(deps);
  return state;
}

const sameSettings = (a: PageSpec, b: PageSpec) => describeDiff(a, b).length === 0;

describe("rollbackTo", () => {
  beforeEach(async () => {
    ids.n = 0;
    await resetLoop();
  });

  it("restores an old generation as a new live version, stops the running test and records it", async () => {
    const { deps, prs } = makeDeps();
    await runUntil(deps, (s) => s.generation >= 1);
    // Start the next test so there is something running to stop.
    const testing = await runUntil(deps, (s) => s.phase === "experiment" && Boolean(s.experimentId));
    const runningId = testing.experimentId!;
    expect(getRunningExperiment()?.id).toBe(runningId);
    const liveBefore = getLiveSpec();
    const prsBefore = prs.length;

    const state = await rollbackTo(0, { ...deps, openPr: false });

    // The Gen 0 settings are live again, under a new (higher) version.
    const live = getLiveSpec();
    expect(sameSettings(live, DEFAULT_SPEC)).toBe(true);
    expect(live.version).toBeGreaterThan(liveBefore.version);
    expect(live.label).toBe("Rolled back to Gen 0");
    expect(getSpecVersion(live.version)).toBeDefined();
    expect(state.liveSpec.version).toBe(live.version);

    // The running test is stopped honestly, with no verdict.
    expect(getExperiment(runningId)?.status).toBe("stopped");
    expect(getRunningExperiment()).toBeUndefined();
    expect(state.experimentId).toBeUndefined();
    expect(state.proposal).toBeUndefined();

    // History gets its own record (no lift, Gen 0's rates) and the log says what happened.
    const rec = state.history.at(-1)!;
    expect(rec).toMatchObject({ generation: testing.generation + 1, specVersion: live.version, label: "Rolled back to Gen 0" });
    expect(rec.lift).toBeUndefined();
    expect(rec.experimentId).toBeUndefined();
    expect(rec.overallConversionRate).toBe(state.history[0].overallConversionRate);
    expect(state.generation).toBe(rec.generation);
    const entry = state.log.findLast((e) => e.actor === "shipper")!;
    expect(entry.message).toMatch(/Rolled back to Gen 0/);
    expect(entry.data).toMatchObject({ specVersion: live.version, rollback: { toGeneration: 0, fromVersion: liveBefore.version } });
    expect(state.log.some((e) => e.actor === "experimenter" && /Stopped/.test(e.message))).toBe(true);

    // No GitHub → no PR; the loop goes back to watching the restored store.
    expect(prs.length).toBe(prsBefore);
    expect(state.phase).toBe("idle");
    const next = await stepLoop(deps);
    expect(next.phase).toBe("observe");
  });

  it("opens a revert PR when GitHub is involved", async () => {
    const { deps, prs } = makeDeps();
    await runUntil(deps, (s) => s.generation >= 1);
    const before = getLiveSpec();
    const state = await rollbackTo(0, { ...deps, openPr: true });
    const pr = prs.at(-1)!;
    expect(pr.repo).toMatchObject({ owner: "acme", repo: "storefront" });
    expect(pr.generation).toBe(state.generation);
    expect(pr.previous?.version).toBe(before.version);
    expect(sameSettings(pr.spec, DEFAULT_SPEC)).toBe(true);
    expect(state.history.at(-1)?.prUrl).toBe(`https://github.com/acme/storefront/pull/${prs.length}`);
  });

  it("rejects unknown generations and no-op rollbacks", async () => {
    const { deps } = makeDeps();
    await expect(rollbackTo(0, deps)).rejects.toMatchObject({ status: 400 }); // nothing shipped yet
    await runUntil(deps, (s) => s.generation >= 1);
    for (const bad of [99, -1, 1.5]) {
      await expect(rollbackTo(bad, deps)).rejects.toBeInstanceOf(RollbackError);
    }
    await expect(rollbackTo(getLoopState().generation, deps)).rejects.toMatchObject({ status: 409 });
    // A failed rollback changes nothing.
    expect(getLoopState().history.at(-1)?.label).not.toMatch(/Rolled back/);
  });
});
