import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore, track } from "@/lib/analytics/store";
import { connectWhop } from "@/lib/whop";
import { agentFunnel, budgetOf, DEMO_CATALOG, getCatalog, handleA2a, offerFromPlan, pickOffer, rankOffers, recordDemoPayment, resetCatalog, resetStoreAgent, runSimulatedBuyer, storeAgentCard } from ".";

const ORIGIN = "https://darwin.example";
const offers = DEMO_CATALOG.offers;

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
});

describe("Whop catalog", () => {
  it("replaces a cached demo catalog as soon as Whop connects", async () => {
    expect((await getCatalog()).source).toBe("demo");
    process.env.WHOP_API_KEY = "whop_test";
    process.env.WHOP_COMPANY_ID = "biz_test";
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/companies/")) return Response.json({ id: "biz_test", title: "Connected store" });
      if (String(url).includes("/products?")) {
        expect(new URL(url).searchParams.get("account_id")).toBe("biz_test");
        return Response.json({ data: [{ id: "prod_real", title: "Coaching", account: { id: "biz_test" } }] });
      }
      if (String(url).includes("/plans?")) {
        expect(new URL(url).searchParams.get("account_id")).toBe("biz_test");
        return Response.json({ data: [{ id: "plan_real", title: "Coaching", plan_type: "one_time", initial_price: 29, currency: "gbp", visibility: "visible" }] });
      }
      throw new Error(`Unexpected Whop request: ${url}`);
    });
    try {
      expect((await connectWhop()).products).toEqual([{ id: "prod_real", title: "Coaching" }]);
      const catalog = await getCatalog();
      expect(catalog.source).toBe("whop");
      expect(catalog.offers[0].id).toBe("plan_real");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("turns Whop plans into offers: price in minor units, billing, checkout link", () => {
    expect(
      offerFromPlan({
        id: "plan_123",
        plan_type: "renewal",
        renewal_price: 29,
        initial_price: 0,
        billing_period: 30,
        currency: "gbp",
        visibility: "visible",
        product: { id: "prod_1", title: "Coaching" },
        purchase_url: "https://whop.com/checkout/plan_123",
      }),
    ).toEqual({ id: "plan_123", productId: "prod_1", title: "Coaching", description: undefined, price: 2900, currency: "gbp", billing: "month", checkoutUrl: "https://whop.com/checkout/plan_123", available: true });
    expect(offerFromPlan({ id: "plan_9", plan_type: "one_time", initial_price: "49.99", currency: "usd", title: "Race pack" })).toMatchObject({ price: 4999, billing: "one_time", checkoutUrl: "https://whop.com/checkout/plan_9" });
    expect(offerFromPlan({ id: "plan_h", visibility: "hidden", initial_price: 5 })?.available).toBe(false);
    expect(offerFromPlan({ title: "no id" })).toBeUndefined();
  });
});

describe("store agent", () => {
  it("ranks by need, budget and one-off vs membership", () => {
    expect(budgetOf("coaching under £40 a month")).toBe(4000);
    expect(rankOffers(offers, "trail running coaching under £40").map((o) => o.id)).toEqual(["plan_demo_coaching"]);
    expect(rankOffers(offers, "something one-off under £20").map((o) => o.id)).toEqual(["plan_demo_gear"]);
    expect(rankOffers(offers, "a membership").every((o) => o.billing !== "one_time")).toBe(true);
    const shown = ["plan_demo_race", "plan_demo_gear"];
    expect(pickOffer("buy the second one", offers, shown)?.id).toBe("plan_demo_gear");
    expect(pickOffer("buy the cheapest", offers, shown)?.id).toBe("plan_demo_gear");
    expect(pickOffer("buy Race-Day Pack", offers, [])?.id).toBe("plan_demo_race");
  });

  it("sells over A2A v1.0: offers, then a checkout link credited to the conversation, then the payment", async () => {
    const ask = await handleA2a(
      { jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { role: "ROLE_USER", messageId: "m1", parts: [{ text: "Trail running coaching under £40 a month" }] } } },
      { origin: ORIGIN, agentName: "ChatGPT" },
    );
    const msg = (ask.result as { message: { role: string; contextId: string; parts: { text?: string; data?: { offers: { id: string }[] } }[] } }).message;
    expect(msg.role).toBe("ROLE_AGENT");
    expect(msg.parts[0].text).toMatch(/Trail Running Coaching \(monthly\): £29\/month/);
    expect(msg.parts[1].data?.offers.map((o) => o.id)).toEqual(["plan_demo_coaching"]);

    const buy = await handleA2a(
      { jsonrpc: "2.0", id: 2, method: "SendMessage", params: { message: { role: "ROLE_USER", contextId: msg.contextId, parts: [{ text: "Buy it" }] } } },
      { origin: ORIGIN, agentName: "ChatGPT" },
    );
    const checkout = (buy.result as { message: { parts: { data?: { checkout: { url: string; ref: string } } }[] } }).message.parts[1].data!.checkout;
    expect(checkout.url).toBe(`${ORIGIN}/checkout/demo?offer=plan_demo_coaching&ref=${msg.contextId}`);
    expect(checkout.ref).toBe(msg.contextId);

    expect(recordDemoPayment("plan_demo_coaching", msg.contextId).ok).toBe(true);
    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, offersShown: 1, checkouts: 1, paid: 1, revenue: 2900, conversion: 1, simulated: 0 });
    expect(funnel.byAgent).toEqual([{ agent: "ChatGPT", conversations: 1, checkouts: 1, paid: 1 }]);
    expect(eventStore().all().every((e) => e.properties.visitor_kind === "agent" && e.properties.darwin_site === "whop")).toBe(true);
  });

  it("speaks A2A v0.3 too, and answers bad requests with JSON-RPC errors", async () => {
    const res = await handleA2a(
      { jsonrpc: "2.0", id: "a", method: "message/send", params: { message: { kind: "message", role: "user", parts: [{ kind: "text", text: "what do you sell?" }] } } },
      { origin: ORIGIN },
    );
    expect(res.result).toMatchObject({ kind: "message", role: "agent", parts: [{ kind: "text" }, { kind: "data", data: { intent: "info", catalog: "demo" } }] });
    expect(await handleA2a({ jsonrpc: "2.0", id: 3, method: "tasks/get" }, { origin: ORIGIN })).toMatchObject({ error: { code: -32601 } });
    expect(await handleA2a({ id: 4 }, { origin: ORIGIN })).toMatchObject({ error: { code: -32600 } });
    expect(await handleA2a({ jsonrpc: "2.0", id: 5, method: "SendMessage", params: { message: { parts: [] } } }, { origin: ORIGIN })).toMatchObject({ error: { code: -32602 } });
  });

  it("credits Whop webhook payments by the ref in their metadata, and labels simulated buyers", async () => {
    const run = await runSimulatedBuyer("Something one-off under £20", ORIGIN);
    expect(run.paid).toBe(true);
    expect(run.transcript.map((t) => t.from)).toEqual(["buyer", "store", "buyer", "store", "store"]);
    // A real payment from Whop's webhook for a conversation (metadata.darwin_ref), mapped by lib/whop/map.ts.
    track({ event: "order_completed", distinct_id: "whop_user", properties: { whop_event: "payment.succeeded", visitor_kind: "agent", agent_name: "Claude", revenue: 4900, whop_metadata: { darwin_ref: "ctx_unknown" }, synthetic: false } });
    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, paid: 2, simulated: 1 });
    const card = await storeAgentCard(ORIGIN);
    expect(card).toMatchObject({ url: `${ORIGIN}/a2a/whop`, supportedInterfaces: [{ protocolVersion: "1.0" }, { protocolVersion: "0.3" }] });
    expect(card.description).toMatch(/Demo catalog/);
  });
});
