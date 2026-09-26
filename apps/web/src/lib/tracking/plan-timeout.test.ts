import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/client")>()),
  llmAvailable: () => true,
  // A provider that never answers.
  generateJson: () => new Promise(() => {}),
}));

afterEach(() => vi.unstubAllEnvs());

describe("buildPlan with a stuck AI provider", () => {
  it("falls back to the rules plan instead of hanging onboarding", async () => {
    vi.stubEnv("PLAN_AI_TIMEOUT_MS", "50");
    const { buildPlan } = await import("./plan");
    const started = Date.now();
    const plan = await buildPlan({ site: "stuck-shop", prompt: "We sell candles; checkout feels slow on mobile" });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(plan.site).toBe("stuck-shop");
    expect(plan.events.length).toBeGreaterThan(0);
  });
});
