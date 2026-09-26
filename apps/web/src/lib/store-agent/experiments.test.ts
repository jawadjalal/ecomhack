import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import {
  agentTestResults,
  getAgentTests,
  pitchFor,
  replyTo,
  resetAgentTests,
  resetCatalog,
  resetStoreAgent,
  runSimulatedBuyers,
  setAgentAutopilot,
  startAgentTest,
  stepAgentTests,
} from ".";

const ORIGIN = "https://darwin.example";

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
  resetAgentTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
});

describe("A/B tests on the store agent's pitch", () => {
  it("splits conversations sticky and ~50/50 between the default pitch and default + the lever", () => {
    const test = startAgentTest("facts");
    const arms = Array.from({ length: 1000 }, (_, i) => pitchFor(`ctx_${i}`));
    const treated = arms.filter((a) => a.variant === "treatment");
    expect(treated.length).toBeGreaterThan(450);
    expect(treated.length).toBeLessThan(550);
    expect(treated[0]).toEqual({ levers: ["facts"], testId: test.id, variant: "treatment" });
    expect(pitchFor("ctx_7")).toEqual(pitchFor("ctx_7"));
    expect(() => startAgentTest("one-pick")).toThrow(/already running/);
  });

  it("each lever changes how the agent answers", async () => {
    const ask = async (levers: string[]) => {
      resetAgentTests();
      // Force the pitch by shipping levers into the default.
      const s = getAgentTests();
      s.levers = levers as never;
      return replyTo("Trail running coaching under £40 a month", { origin: ORIGIN });
    };
    const plain = await ask([]);
    expect(plain.data.offers).toHaveLength(1);
    expect(plain.text).toMatch(/^Here's what fits/);
    const pick = await ask(["one-pick"]);
    expect(pick.text).toMatch(/^My pick for you: Trail Running Coaching \(monthly\), £29\/month/);
    const facts = await ask(["facts"]);
    expect(facts.data.facts?.[0]).toBe("Instant access as soon as the payment goes through.");
    const structured = await ask(["structured"]);
    expect(structured.data.buy).toEqual({ reply: "buy plan_demo_coaching", offerIds: ["plan_demo_coaching"] });
    const buy = await replyTo("buy plan_demo_coaching", { contextId: structured.contextId, origin: ORIGIN });
    expect(buy.data.checkout?.offerId).toBe("plan_demo_coaching");
    const upsell = await ask(["upsell"]);
    expect(upsell.data.offers?.[0].id).toBe("plan_demo_club");
  });

  it("autopilot ships winners into the pitch (they stack), stops losers, and never retries a lever", async () => {
    setAgentAutopilot(true);
    expect(stepAgentTests(eventStore().all())[0]).toMatch(/Started testing “Facts up front”/);
    for (let round = 0; round < 60 && getAgentTests().tests.filter((t) => t.status !== "running").length < 4; round++) {
      await runSimulatedBuyers(150, ORIGIN, 1000 + round);
      stepAgentTests(eventStore().all());
    }
    const s = getAgentTests();
    const byLever = Object.fromEntries(s.tests.map((t) => [t.lever, t]));
    expect(byLever.facts.status).toBe("shipped");
    expect(byLever.upsell.status).toBe("stopped");
    expect(s.levers).toContain("facts");
    expect(byLever["one-pick"].base).toContain("facts"); // tested on top of the shipped winner
    expect(new Set(s.tests.map((t) => t.lever)).size).toBe(s.tests.length);
    const factsResult = agentTestResults(eventStore().all()).find((r) => r.testId === byLever.facts.id)!;
    expect(factsResult.treatment.rate).toBeGreaterThan(factsResult.control.rate);
    expect(factsResult.probabilityToBeat).toBeGreaterThanOrEqual(0.97);
    expect(s.log.some((l) => /^Shipped “Facts up front”/.test(l.text))).toBe(true);
    expect(eventStore().all().every((e) => e.properties.synthetic === true)).toBe(true);
  }, 60_000);

  it("simulated buyers never create checkouts in the merchant's real Whop account", async () => {
    process.env.WHOP_API_KEY = "whop_test";
    process.env.WHOP_COMPANY_ID = "biz_test";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/plans")) return Response.json({ data: [{ id: "plan_real", plan_type: "renewal", renewal_price: 29, billing_period: 30, currency: "gbp", title: "Coaching", visibility: "visible" }] });
      return Response.json({ purchase_url: "https://whop.com/checkout/tagged" });
    });
    await runSimulatedBuyers(40, ORIGIN, 7);
    expect(calls.some((u) => u.includes("/plans"))).toBe(true);
    expect(calls.filter((u) => u.includes("/checkout_configurations"))).toHaveLength(0);
    // A real agent's conversation still gets a tagged Whop checkout.
    const ask = await replyTo("coaching", { origin: ORIGIN, agentName: "Claude" });
    const buy = await replyTo("buy it", { contextId: ask.contextId, origin: ORIGIN, agentName: "Claude" });
    expect(buy.data.checkout).toMatchObject({ url: "https://whop.com/checkout/tagged", tagged: true });
  });
});
