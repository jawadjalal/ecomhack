import { beforeEach, describe, expect, it } from "vitest";
import { eventStore, track } from "@/lib/analytics/store";
import { resetIngestRate } from "@/lib/analytics/trust";
import { POST } from "@/app/api/store-agent/demo-pay/route";
import { agentFunnel, DEMO_CATALOG, paidOrderFor, recordDemoPayment, replyTo, resetCatalog, resetStoreAgent, runSimulatedBuyer, runSimulatedBuyers, SIM_CHECKOUT_PAID } from ".";

const offer = DEMO_CATALOG.offers[0];
/** The store agent opened a checkout for this ref (what the chat, MCP and ACP record). */
const startCheckout = (ref: string, offerId = offer.id, agentName = "claude-buyer") =>
  track({
    event: "checkout_started",
    distinct_id: `agent_${ref}`,
    properties: { darwin_site: "whop", visitor_kind: "agent", agent_name: agentName, darwin_ref: ref, channel: "a2a", product_id: offerId, price: 2900 },
  });
/** Separate requests run in separate turns. */
const nextTurn = () => new Promise((r) => setImmediate(r));
const orders = (ref: string) =>
  eventStore()
    .all()
    .filter((e) => e.event === "order_completed" && e.properties.darwin_ref === ref);

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
  resetIngestRate();
});

describe("demo checkout payments are idempotent per checkout reference", () => {
  it("records one paid order per ref, however many times Pay is pressed", async () => {
    expect(paidOrderFor("ctx_pay_once")).toBeUndefined();
    startCheckout("ctx_pay_once");
    expect(recordDemoPayment(offer.id, "ctx_pay_once")).toEqual({ ok: true, title: offer.title });
    await nextTurn();
    expect(recordDemoPayment(offer.id, "ctx_pay_once")).toEqual({ ok: true, alreadyPaid: true, title: offer.title });
    expect(recordDemoPayment(offer.id, "ctx_pay_once", false, { exclusive: true })).toEqual({ ok: true, alreadyPaid: true, title: offer.title });
    expect(orders("ctx_pay_once")).toHaveLength(1);
    expect(paidOrderFor("ctx_pay_once")?.properties.revenue).toBe(offer.price);
    expect(agentFunnel(eventStore().all()).revenue).toBe(offer.price);
  });

  it("an exclusive payment (one request) never joins another in flight, even in the same turn", () => {
    startCheckout("ctx_same_turn");
    expect(recordDemoPayment(offer.id, "ctx_same_turn", false, { exclusive: true }).alreadyPaid).toBeUndefined();
    expect(recordDemoPayment(offer.id, "ctx_same_turn", false, { exclusive: true })).toMatchObject({ ok: true, alreadyPaid: true });
    expect(orders("ctx_same_turn")).toHaveLength(1);
  });

  it("an order paid unit by unit in one turn (ACP, quantity 2) is one payment: both units count, paying again doesn't", async () => {
    startCheckout("ctx_two_units");
    expect(recordDemoPayment(offer.id, "ctx_two_units").ok).toBe(true);
    expect(recordDemoPayment(offer.id, "ctx_two_units").alreadyPaid).toBeUndefined();
    await nextTurn();
    expect(recordDemoPayment(offer.id, "ctx_two_units")).toMatchObject({ ok: true, alreadyPaid: true });
    expect(orders("ctx_two_units").map((e) => e.uuid)).toEqual(["darwin:demo-pay:ctx_two_units:0", "darwin:demo-pay:ctx_two_units:1"]);
    expect(agentFunnel(eventStore().all()).revenue).toBe(offer.price * 2);
  });

  it("counts a ref already paid through Whop (metadata darwin_ref) as paid", () => {
    startCheckout("ctx_whop_paid");
    track({
      event: "order_completed",
      distinct_id: "user_1",
      uuid: "whop:order_completed:pay_1",
      properties: { visitor_kind: "agent", whop_event: "payment.succeeded", revenue: 2900, whop_metadata: { darwin_ref: "ctx_whop_paid" } },
    });
    expect(paidOrderFor("ctx_whop_paid")?.uuid).toBe("whop:order_completed:pay_1");
    expect(recordDemoPayment(offer.id, "ctx_whop_paid")).toMatchObject({ ok: true, alreadyPaid: true });
    expect(eventStore().all().filter((e) => e.event === "order_completed")).toHaveLength(1);
  });

  it("only pays a checkout the store agent opened: a made-up ref, or another offer than the one checked out, records nothing", async () => {
    expect(recordDemoPayment(offer.id, "ctx_made_up_ref")).toEqual({ ok: false, error: "no_checkout" });
    startCheckout("ctx_cheap", "plan_demo_gear");
    const club = DEMO_CATALOG.offers.find((o) => o.id === "plan_demo_club")!;
    expect(recordDemoPayment(club.id, "ctx_cheap")).toEqual({ ok: false, error: "no_checkout" });
    const res = await POST(
      new Request("http://localhost/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: club.id, ref: "ctx_fabricated" }) }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No checkout was started/);
    expect(eventStore().all().filter((e) => e.event === "order_completed")).toHaveLength(0);
    expect(agentFunnel(eventStore().all()).revenue).toBe(0);
  });

  it("credits the payment to the conversation that got the link (its agent and channel)", async () => {
    const ask = await replyTo("Trail running coaching under £40 a month", { agentName: "console (you)", origin: "https://darwin.example" });
    const buy = await replyTo("buy the first one", { contextId: ask.contextId, origin: "https://darwin.example" });
    const checkout = buy.data.checkout!;
    await nextTurn();
    const pay = () =>
      POST(new Request("http://localhost/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: checkout.offerId, ref: checkout.ref }) }));
    expect(await (await pay()).json()).toMatchObject({ ok: true });
    await nextTurn();
    expect(await (await pay()).json()).toMatchObject({ ok: true, alreadyPaid: true });
    expect(orders(checkout.ref)).toHaveLength(1);
    expect(orders(checkout.ref)[0].properties).toMatchObject({ agent_name: "console (you)", channel: "a2a", synthetic: true });
    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, checkouts: 1, paid: 1 });
    expect(funnel.recent.map((r) => [r.step, r.agent])).toEqual([
      ["paid", "console (you)"],
      ["checkout link", "console (you)"],
    ]);
  });

  it("simulated buyers pay a plausible share of their checkout links, not all of them", async () => {
    await runSimulatedBuyers(400, "https://darwin.example", 42);
    const f = agentFunnel(eventStore().all());
    const rate = f.paid / f.checkouts;
    expect(rate).toBeGreaterThan(SIM_CHECKOUT_PAID - 0.1);
    expect(rate).toBeLessThan(SIM_CHECKOUT_PAID + 0.1);
    expect(eventStore().all().every((e) => e.properties.synthetic === true)).toBe(true);
  });

  it("a simulated buyer's paid checkout can't be paid again from the checkout page", async () => {
    const run = await runSimulatedBuyer("Trail running coaching under £40 a month", "https://darwin.example");
    expect(run.paid).toBe(true);
    const ref = new URL(run.checkoutUrl!).searchParams.get("ref")!;
    expect(recordDemoPayment(offer.id, ref)).toMatchObject({ ok: true, alreadyPaid: true });
    expect(orders(ref)).toHaveLength(1);
  });

  it("still rejects unknown offers and malformed refs", () => {
    expect(recordDemoPayment("plan_nope", "ctx_valid_ref")).toEqual({ ok: false, error: "unknown_offer" });
    expect(recordDemoPayment(offer.id, "x")).toEqual({ ok: false, error: "unknown_offer" });
    expect(eventStore().all()).toHaveLength(0);
  });

  it("POST /api/store-agent/demo-pay answers 200 with alreadyPaid the second time", async () => {
    startCheckout("ctx_route_ref");
    const pay = () =>
      POST(new Request("http://localhost/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: offer.id, ref: "ctx_route_ref" }) }));
    const first = await pay();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, title: offer.title });
    const second = await pay();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, alreadyPaid: true, title: offer.title });
    expect(orders("ctx_route_ref")).toHaveLength(1);
  });

  it("a double click (two requests at once) pays once", async () => {
    startCheckout("ctx_double_click");
    const pay = () =>
      POST(new Request("http://localhost/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: offer.id, ref: "ctx_double_click" }) }));
    const bodies = await Promise.all([pay(), pay(), pay()].map(async (r) => (await r).json()));
    expect(bodies.filter((b) => b.alreadyPaid)).toHaveLength(2);
    expect(orders("ctx_double_click")).toHaveLength(1);
  });
});
