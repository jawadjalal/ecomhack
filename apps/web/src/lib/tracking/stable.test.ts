// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// An LLM that suggests a different extra event every time: exactly what made regenerated plans unstable.
let calls = 0;
vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => true,
  llmLabel: () => "llm:test",
  generateJson: async () => {
    calls++;
    return { events: [{ name: `idea_${calls}`, label: `Idea ${calls}`, why: "Because.", properties: [] }] };
  },
}));

const { POST } = await import("@/app/api/onboarding/plan/route");
const { getPlan, planCacheKey, resetPlanCache, resetPlans } = await import(".");

type Out = { plan: { site: string; events: { name: string }[]; createdAt: string }; cached: boolean };
const post = async (body: unknown): Promise<Out> => {
  const res = await POST(new Request("http://localhost/api/onboarding/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect(res.status).toBe(200);
  return (await res.json()) as Out;
};
const names = (o: Out) => o.plan.events.map((e) => e.name);

beforeEach(() => {
  calls = 0;
  resetPlans();
  resetPlanCache();
});

describe("POST /api/onboarding/plan is stable", () => {
  it("returns the same plan for the same store, description and answers", async () => {
    const first = await post({ siteUrl: "www.eastfork.com", prompt: "Handmade pottery. Checkout feels slow on mobile.", answers: { track: ["checkout", "mobile"], where: ["web"] } });
    expect(first.cached).toBe(false);
    expect(names(first)).toContain("idea_1");

    // Same words with different case and spacing, answers in a different key order.
    const again = await post({ siteUrl: "https://www.eastfork.com", prompt: "  handmade   pottery. checkout feels SLOW on mobile. ", answers: { where: ["web"], track: ["checkout", "mobile"] } });
    expect(again.cached).toBe(true);
    expect(again.plan).toEqual(first.plan);
    expect(calls).toBe(1);
    expect(getPlan("eastfork-com")).toEqual(first.plan);
  });

  it("makes a new plan when the inputs change, or when asked to regenerate", async () => {
    const first = await post({ siteUrl: "eastfork.com", prompt: "pottery" });
    const other = await post({ siteUrl: "eastfork.com", prompt: "pottery", answers: { track: ["sizing"] } });
    expect(other.cached).toBe(false);
    expect(names(other)).not.toEqual(names(first));

    const fresh = await post({ siteUrl: "eastfork.com", prompt: "pottery", regenerate: true });
    expect(fresh.cached).toBe(false);
    expect(names(fresh)).toContain(`idea_${calls}`);
    // …and the regenerated plan is the one returned from then on.
    expect((await post({ siteUrl: "eastfork.com", prompt: "pottery" })).plan).toEqual(fresh.plan);
  });

  it("keys on the site, the normalised description and the answers", () => {
    const k = (o: Partial<Parameters<typeof planCacheKey>[0]>) => planCacheKey({ site: "a", source: "url", ...o });
    expect(k({ prompt: "Hello  World" })).toBe(k({ prompt: " hello world " }));
    expect(k({ prompt: "hello" })).not.toBe(k({ prompt: "hello", site: "b" }));
    expect(k({ answers: { a: 1, b: [1, 2] } })).toBe(k({ answers: { b: [1, 2], a: 1 } }));
    expect(k({ answers: { a: 1 } })).not.toBe(k({ answers: { a: 2 } }));
  });
});
