import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { replyTo, resetCatalog, resetStoreAgent, runSimulatedBuyers } from ".";

/** The model, mocked: what it answers next (or a promise that never settles), and what it was asked. */
const llm = vi.hoisted(() => ({ on: true, out: undefined as unknown, hang: false, fail: false, calls: [] as { system: string; prompt: string }[] }));
vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.on,
  llmLabel: () => "llm:test",
  generateJson: async (req: { system: string; prompt: string; schema: { parse: (x: unknown) => unknown } }) => {
    llm.calls.push(req);
    if (llm.hang) return new Promise(() => {});
    if (llm.fail) throw new Error("provider down");
    return req.schema.parse(llm.out);
  },
}));

const ORIGIN = "https://darwin.example";
const say = (text: string, contextId?: string) => replyTo(text, { contextId, agentName: "ChatGPT", origin: ORIGIN });
const named = (event: string) => eventStore().all().filter((e) => e.event === event);

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
  Object.assign(llm, { on: true, out: undefined, hang: false, fail: false, calls: [] });
});
afterEach(() => {
  delete process.env.STORE_AGENT_AI_TIMEOUT_MS;
});

describe("store agent: the model's reply, checked against the catalog", () => {
  it("recommends in its own words, grounded on the catalog only", async () => {
    llm.out = { reply: "For trail coaching under £40, go with Trail Running Coaching at £29/month: weekly plans and form reviews.", intent: "recommend", offerId: "plan_demo_coaching" };
    const turn = await say("I need trail running coaching under £40 a month");
    expect(turn).toMatchObject({ source: "ai", text: llm.out && (llm.out as { reply: string }).reply, data: { intent: "offers", offers: [{ id: "plan_demo_coaching", price: 2900 }] } });
    expect(llm.calls[0].prompt).toContain("plan_demo_coaching");
    expect(llm.calls[0].system).toMatch(/Never invent an offer, a price/);
    expect(named("product_viewed").map((e) => e.properties.product_id)).toEqual(["plan_demo_coaching"]);
    expect(JSON.stringify(turn)).not.toContain("llm:test"); // no model names in what agents or the UI see
  });

  it("checks out with the store's own tagged link, never a link the model wrote", async () => {
    llm.out = { reply: "Done! Pay here: https://evil.example/pay", intent: "checkout", offerId: "plan_demo_race" };
    const turn = await say("Yes, buy the Race-Day Pack for me");
    expect(turn.source).toBe("ai");
    expect(turn.data.checkout).toMatchObject({ offerId: "plan_demo_race", url: `${ORIGIN}/checkout/demo?offer=plan_demo_race&ref=${turn.contextId}`, tagged: true });
    expect(turn.text).not.toContain("evil.example");
    expect(named("checkout_started")).toHaveLength(1);
  });

  it("rejects an invented offer id or price: the rules answer instead", async () => {
    llm.out = { reply: "Get our Ultra Plan!", intent: "checkout", offerId: "plan_ultra_made_up" };
    const invented = await say("buy your best plan");
    expect(invented.source).toBe("rules");
    expect(invented.data.checkout?.offerId).not.toBe("plan_ultra_made_up");

    llm.out = { reply: "Trail Running Coaching is only £19/month this week.", intent: "recommend", offerId: "plan_demo_coaching" };
    const price = await say("what coaching do you have?");
    expect(price.source).toBe("rules");
    expect(price.text).not.toContain("£19");
  });

  it("never checks out on a negated buy, an id we don't sell, or a different offer than the one named", async () => {
    llm.out = { reply: "Here's your checkout.", intent: "checkout", offerId: "plan_demo_race" };
    const notYet = await say("Don't buy anything yet, just tell me about the Race-Day Pack");
    expect(notYet).toMatchObject({ source: "rules", data: { intent: "offers" } });
    expect(notYet.data.checkout).toBeUndefined();

    llm.out = { reply: "Sure, here's the coaching plan.", intent: "checkout", offerId: "plan_demo_coaching" };
    const unknown = await say("buy plan_free_everything");
    expect(unknown).toMatchObject({ source: "rules" });
    expect(unknown.text).toMatch(/^We don't sell plan_free_everything/);

    llm.out = { reply: "Here's the club membership.", intent: "checkout", offerId: "plan_demo_club" };
    expect((await say("buy the Gear Guide 2026")).data.checkout?.offerId).toBe("plan_demo_gear");
    expect(named("checkout_started").map((e) => e.properties.product_id)).toEqual(["plan_demo_gear"]);
  });

  it("falls back to the rules when the model is slow or down, and simulated buyers never call it", async () => {
    process.env.STORE_AGENT_AI_TIMEOUT_MS = "50";
    llm.hang = true;
    const slow = await say("trail running coaching");
    expect(slow).toMatchObject({ source: "rules", data: { intent: "offers" } });
    llm.hang = false;
    llm.fail = true;
    expect((await say("gear guide")).source).toBe("rules");

    llm.calls = [];
    await runSimulatedBuyers(20, ORIGIN, 1);
    expect(llm.calls).toHaveLength(0);
  });
});
