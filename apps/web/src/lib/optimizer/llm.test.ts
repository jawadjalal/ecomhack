/**
 * The LLM paths (Grok / Claude / OpenRouter) with the model mocked: the build sandbox can't reach
 * any LLM host, so these tests are what guarantee a real key works on demo day.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Insight } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";

const llm = vi.hoisted(() => ({
  available: true,
  responses: [] as unknown[],
  calls: [] as { system: string; prompt: string }[],
}));

vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.available,
  llmLabel: () => (llm.available ? "llm:grok-test" : "heuristic"),
  llmProvider: () => (llm.available ? "xai" : "none"),
  llmModel: () => "grok-test",
  generateText: async () => "",
  generateJson: async (req: { system: string; prompt: string; schema: { parse: (v: unknown) => unknown } }) => {
    llm.calls.push({ system: req.system, prompt: req.prompt });
    const next = llm.responses.shift();
    if (next instanceof Error) throw next;
    return req.schema.parse(next);
  },
}));

const { proposeWithLlm } = await import("./proposals");
const { refineInsightsWithLlm } = await import("./insights");
const { resetLoop, stepLoop } = await import("./loop");
const { createFakeSimulator } = await import("./testing/fake-simulator");

const insight = (over: Partial<Insight> = {}): Insight => ({
  id: "ins_shipping_shock",
  title: "23% of checkouts die the moment shipping appears",
  audience: "human",
  severity: "high",
  stage: "checkout",
  detail: "41 of 182 shoppers who started checkout left right after the £4.95 delivery fee was revealed.",
  evidence: [
    { label: "Left at shipping reveal", value: "41" },
    { label: "Checkout → order", value: "58%" },
  ],
  impactScore: 8.6,
  ...over,
});

beforeEach(() => {
  llm.available = true;
  llm.responses = [];
  llm.calls = [];
});

describe("proposeWithLlm", () => {
  it("turns a valid model answer into a validated proposal", async () => {
    llm.responses.push({
      title: "Show delivery upfront and make it free over £60",
      hypothesis: "Surprise costs at the last step drive abandonment.",
      patch: { cart: { showShippingUpfront: true, freeShippingThreshold: 6000 }, version: 99, label: "nope" },
      expectedLift: 12, // models often answer 12 meaning 12%
      insightIds: ["ins_shipping_shock", "ins_made_up"],
    });
    const { proposal, reason } = await proposeWithLlm([insight()], DEFAULT_SPEC, []);
    expect(reason).toBeUndefined();
    expect(proposal).toMatchObject({
      title: "Show delivery upfront and make it free over £60",
      source: "llm:grok-test",
      insightIds: ["ins_shipping_shock"],
      expectedLift: 0.12,
    });
    expect(proposal!.patch).toEqual({ cart: { showShippingUpfront: true, freeShippingThreshold: 6000 } });
    expect(proposal!.diff).toContain("cart.showShippingUpfront: false → true");
    // The model sees the spec schema, the insights and what was already tried.
    const prompt = JSON.parse(llm.calls[0].prompt);
    expect(Object.keys(prompt)).toEqual(expect.arrayContaining(["pageSpecJsonSchema", "currentSpec", "insights", "alreadyTried"]));
  });

  it("rejects invalid, no-op and already-tried patches with a reason", async () => {
    llm.responses.push({ title: "Bad", hypothesis: "Seven steps is better.", patch: { checkout: { steps: 7 } }, expectedLift: 0.1 });
    expect((await proposeWithLlm([insight()], DEFAULT_SPEC, [])).reason).toMatch(/invalid|changed nothing/);

    llm.responses.push({ title: "Noop", hypothesis: "Keep it the same.", patch: { checkout: { steps: 3 } }, expectedLift: 0.1 });
    expect((await proposeWithLlm([insight()], DEFAULT_SPEC, [])).reason).toMatch(/changed nothing/);

    const patch = { cart: { showShippingUpfront: true } };
    llm.responses.push({ title: "Again", hypothesis: "Try it again please.", patch, expectedLift: 0.1 });
    const tried = [{ title: "Shipping", patch, outcome: "rejected" }];
    expect((await proposeWithLlm([insight()], DEFAULT_SPEC, tried)).reason).toMatch(/already tried/);
  });

  it("returns a reason instead of throwing when the model call fails", async () => {
    llm.responses.push(new Error("403 Host not in allowlist"));
    const res = await proposeWithLlm([insight()], DEFAULT_SPEC, []);
    expect(res.proposal).toBeNull();
    expect(res.reason).toMatch(/403/);
  });
});

describe("refineInsightsWithLlm", () => {
  it("keeps honest rewrites and discards ones that invent numbers", async () => {
    const other = insight({
      id: "ins_agent_missing_eta",
      title: "26% of AI shoppers asked for delivery ETA",
      audience: "agent",
      detail: "109 of 418 agents asked for an ETA and got nothing.",
      evidence: [{ label: "Agents asking", value: "109" }],
      impactScore: 5,
    });
    llm.responses.push({
      insights: [
        { id: "ins_agent_missing_eta", title: "26% of agents can't see when it arrives", detail: "109 of 418 agents gave up guessing." },
        { id: "ins_shipping_shock", title: "Shipping shock kills 90% of checkouts", detail: "Invented number." },
      ],
    });
    const out = await refineInsightsWithLlm([insight(), other], {
      overall: { visitors: 5000 },
      byKind: { human: { conversionRate: 0.02 }, agent: { conversionRate: 0.34 } },
    } as never);
    // Re-ranked by the model, honest copy kept, dishonest copy reverted to the original.
    expect(out.map((i) => i.id)).toEqual(["ins_agent_missing_eta", "ins_shipping_shock"]);
    expect(out[0].title).toBe("26% of agents can't see when it arrives");
    expect(out[1].title).toBe(insight().title);
    expect(out[0].impactScore).toBe(5);
  });
});

describe("loop with an LLM designer", () => {
  it("uses the model's proposal and labels it", async () => {
    await resetLoop();
    const deps = { simulate: createFakeSimulator(), useLlm: true, openSpecPR: async () => { throw new Error("offline"); } };
    // observe → diagnose (LLM rewrite fails: silent fallback) → propose (LLM answers)
    llm.responses.push(new Error("timeout"));
    llm.responses.push({
      title: "Guest checkout on one page",
      hypothesis: "Forced accounts are a top abandonment reason.",
      patch: { checkout: { guestCheckout: true, steps: 1 } },
      expectedLift: 0.15,
    });
    let s = await stepLoop(deps);
    s = await stepLoop(deps);
    expect(s.phase).toBe("diagnose");
    s = await stepLoop(deps);
    expect(s.phase).toBe("propose");
    expect(s.proposal).toMatchObject({ title: "Guest checkout on one page", source: "llm:grok-test" });
    expect(s.log.at(-1)?.message).toContain("Guest checkout on one page");
  });

  it("falls back to the playbook with a short message when the model is unreachable", async () => {
    await resetLoop();
    const deps = { simulate: createFakeSimulator(), useLlm: true, openSpecPR: async () => { throw new Error("offline"); } };
    llm.responses.push(new Error("timeout"), new Error("403 Host not in allowlist: api.x.ai"));
    await stepLoop(deps);
    await stepLoop(deps);
    const s = await stepLoop(deps);
    expect(s.proposal?.source).toBe("heuristic");
    expect(s.log.some((l) => l.message.includes("LLM is unreachable"))).toBe(true);
  });
});
