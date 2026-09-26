import { describe, expect, it } from "vitest";
import type { Insight, PageSpec, SpecPatch } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch, describeDiff, tryApplyPatch } from "@/lib/spec/patch";
import { INSIGHT_KINDS, insightId } from "./insights";
import { IDEAS, ideaForProposal, propose } from "./proposals";
import { canonicalKey } from "./util";

/** One synthetic insight per kind, with descending impact. */
const ALL_INSIGHTS: Insight[] = INSIGHT_KINDS.map((kind, i) => ({
  id: insightId(kind),
  title: `Synthetic ${kind}`,
  audience: kind.startsWith("agent") ? "agent" : "human",
  severity: "medium",
  stage: "test",
  detail: "test",
  evidence: [],
  impactScore: 40 - i,
}));

function expectValid(spec: PageSpec, patch: SpecPatch) {
  const next = tryApplyPatch(spec, patch);
  expect(next).not.toBeNull();
  expect(describeDiff(spec, next!).length).toBeGreaterThan(0);
}

describe("playbook", () => {
  it("every idea is a valid patch against the baseline", () => {
    for (const idea of Object.values(IDEAS)) expect(tryApplyPatch(DEFAULT_SPEC, idea.patch)).not.toBeNull();
  });

  it("proposes the shipping fix for shipping shock", () => {
    const p = propose(ALL_INSIGHTS.filter((i) => i.id === "ins_shipping_shock"), DEFAULT_SPEC, [])!;
    expect(p.title).toBe(IDEAS.shipping_free_threshold.title);
    expect(p.patch).toEqual(IDEAS.shipping_free_threshold.patch);
    expect(p.diff).toContain("cart.showShippingUpfront: false → true");
    expect(p.insightIds).toEqual(["ins_shipping_shock"]);
    expect(p.source).toBe("heuristic");
    expect(p.expectedLift).toBeGreaterThan(0);
  });

  it("never proposes invalid, no-op or already-tried patches, and eventually runs dry", () => {
    for (const shipEvery of [1, 2, 3]) {
      let spec = DEFAULT_SPEC;
      const tried: SpecPatch[] = [];
      const seen = new Set<string>();
      let n = 0;
      for (; n < 100; n++) {
        const p = propose(ALL_INSIGHTS, spec, tried, { explore: n % 3 === 2 });
        if (!p) break;
        expectValid(spec, p.patch);
        const key = canonicalKey(p.patch);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        tried.push(p.patch);
        if (n % shipEvery === 0) spec = { ...applyPatch(spec, p.patch), version: spec.version + 1 };
      }
      expect(n).toBeGreaterThan(5);
      expect(n).toBeLessThan(100);
    }
  });

  it("strips knobs that are already live from the patch", () => {
    const spec = applyPatch(DEFAULT_SPEC, { announcement: { enabled: true, text: "Free UK delivery over £60" } });
    const p = propose(ALL_INSIGHTS.filter((i) => i.id === "ins_shipping_shock"), spec, [])!;
    expect(p.patch).toEqual({ cart: { showShippingUpfront: true, freeShippingThreshold: 6000 } });
  });

  it("wildcard turns reach for a bold idea", () => {
    const p = propose(ALL_INSIGHTS, DEFAULT_SPEC, [], { explore: true })!;
    const idea = ideaForProposal(p);
    expect(idea?.risky || idea?.creative).toBe(true);
  });

  it("still has something to try with no insights at all", () => {
    const p = propose([], DEFAULT_SPEC, []);
    expect(p).not.toBeNull();
    expectValid(DEFAULT_SPEC, p!.patch);
  });
});
