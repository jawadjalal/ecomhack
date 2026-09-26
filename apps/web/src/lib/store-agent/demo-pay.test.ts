import { beforeEach, describe, expect, it } from "vitest";
import { eventStore, track } from "@/lib/analytics/store";
import { resetIngestRate } from "@/lib/analytics/trust";
import { POST } from "@/app/api/store-agent/demo-pay/route";
import { agentFunnel, DEMO_CATALOG, paidOrderFor, recordDemoPayment, resetCatalog, resetStoreAgent, runSimulatedBuyer } from ".";

const offer = DEMO_CATALOG.offers[0];
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
  it("records one paid order per ref, however many times Pay is pressed", () => {
    expect(paidOrderFor("ctx_pay_once")).toBeUndefined();
    expect(recordDemoPayment(offer.id, "ctx_pay_once")).toEqual({ ok: true, title: offer.title });
    expect(recordDemoPayment(offer.id, "ctx_pay_once")).toEqual({ ok: true, alreadyPaid: true, title: offer.title });
    expect(recordDemoPayment(offer.id, "ctx_pay_once")).toEqual({ ok: true, alreadyPaid: true, title: offer.title });
    expect(orders("ctx_pay_once")).toHaveLength(1);
    expect(paidOrderFor("ctx_pay_once")?.properties.revenue).toBe(offer.price);
    expect(agentFunnel(eventStore().all()).revenue).toBe(offer.price);
  });

  it("counts a ref already paid through Whop (metadata darwin_ref) as paid", () => {
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

  it("a simulated buyer's paid checkout can't be paid again from the checkout page", async () => {
    const run = await runSimulatedBuyer("Trail running coaching under £40 a month", "https://darwin.example");
    expect(run.paid).toBe(true);
    const ref = new URL(run.checkoutUrl!).searchParams.get("ref")!;
    expect(recordDemoPayment(offer.id, ref)).toMatchObject({ ok: true, alreadyPaid: true });
    expect(orders(ref)).toHaveLength(1);
  });

  it("still rejects unknown offers and malformed refs", () => {
    expect(recordDemoPayment("plan_nope", "ctx_valid_ref")).toEqual({ ok: false });
    expect(recordDemoPayment(offer.id, "x")).toEqual({ ok: false });
    expect(eventStore().all()).toHaveLength(0);
  });

  it("POST /api/store-agent/demo-pay answers 200 with alreadyPaid the second time", async () => {
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
});
