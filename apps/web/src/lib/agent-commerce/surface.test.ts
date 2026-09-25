import { beforeEach, describe, expect, it } from "vitest";
import type { AgentProduct } from "@/lib/contracts";
import { getProduct, PRODUCTS, SHIPPING_FEE } from "@/lib/catalog/products";
import { callAgentTool, listAgentSessions, type AgentOrder, type CartView, type NegotiationOutcome } from "./index";
import { merchantFloor, negotiateRound, type NegotiationState } from "./negotiation";
import { ctx, eventsNamed, OPEN_SURFACE, resetWorld, useSpec } from "./test-utils";

const ALL_WANT = ["sizes", "deliveryEtaDays", "returnPolicy", "landedPrice"];

beforeEach(resetWorld);

describe("agent surface gating", () => {
  it("hides optional fields on Gen 0 and reports wanted-but-hidden ones as missing", async () => {
    const res = await callAgentTool("search_products", { category: "trail", want: ALL_WANT }, ctx(1));
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual(ALL_WANT);
    const products = res.data as AgentProduct[];
    expect(products.map((p) => p.id)).toEqual(["p_ridge", "p_summit"]);
    for (const p of products) {
      expect(p.sizes).toBeUndefined();
      expect(p.deliveryEtaDays).toBeUndefined();
      expect(p.returnPolicy).toBeUndefined();
      expect(p.landedPrice).toBeUndefined();
      expect(p.price.currency).toBe("GBP");
    }
  });

  it("exposes each field when its flag is on", async () => {
    useSpec({ agentSurface: { exposeDeliveryEta: true } });
    const res = await callAgentTool("get_product", { id: "p_ridge", want: ["eta", "returns"] }, ctx(2));
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual(["returnPolicy"]);
    expect((res.data as AgentProduct).deliveryEtaDays).toBe(3);
    expect((res.data as AgentProduct).returnPolicy).toBeUndefined();
  });

  it("computes landed price with the spec's free-shipping threshold", async () => {
    useSpec({ ...OPEN_SURFACE, cart: { freeShippingThreshold: 10000 } });
    const res = await callAgentTool("search_products", { want: ALL_WANT }, ctx(3));
    expect(res.missing).toBeUndefined();
    for (const p of res.data as AgentProduct[]) {
      const shipping = p.price.amount >= 10000 ? 0 : SHIPPING_FEE;
      expect(p.landedPrice).toEqual({ amount: p.price.amount + shipping, currency: "GBP", shipping });
      expect(p.sizes?.length).toBeGreaterThan(0);
    }
  });

  it("filters by maxPrice (pence, or pounds when < 1000), size and category", async () => {
    const pence = await callAgentTool("search_products", { category: "shoes", maxPrice: 10000, size: "UK 12" }, ctx(4));
    const pounds = await callAgentTool("search_products", { category: "shoes", maxPrice: 100, size: "12" }, ctx(4));
    expect((pence.data as AgentProduct[]).map((p) => p.id).sort()).toEqual(["p_city", "p_tempo"]);
    expect(pounds.data).toEqual(pence.data);
  });

  it("check_availability needs exposeStock", async () => {
    const hidden = await callAgentTool("check_availability", { id: "p_ridge", size: "10" }, ctx(5));
    expect(hidden).toMatchObject({ ok: false, missing: ["stock"], code: "not_exposed" });

    useSpec(OPEN_SURFACE);
    const shown = await callAgentTool("check_availability", { id: "p_aurora", size: "12" }, ctx(5));
    expect(shown).toMatchObject({ ok: true, data: { productId: "p_aurora", size: "12", inStock: false, quantity: 0 } });
  });

  it("negotiate needs negotiation.enabled", async () => {
    const res = await callAgentTool("negotiate", { id: "p_ridge", offer: 12000 }, ctx(6));
    expect(res).toMatchObject({ ok: false, missing: ["negotiation"] });
  });

  it("validates arguments and unknown products", async () => {
    expect(await callAgentTool("get_product", {}, ctx(7))).toMatchObject({ ok: false, code: "invalid_args" });
    expect(await callAgentTool("get_product", { id: "nope" }, ctx(7))).toMatchObject({ ok: false, code: "not_found" });
    expect(await callAgentTool("add_to_cart", { id: "p_aurora", size: "12" }, ctx(7))).toMatchObject({ ok: false, code: "out_of_stock" });
    expect(await callAgentTool("checkout", {}, ctx(7))).toMatchObject({ ok: false, code: "empty_cart" });
  });
});

describe("tracking", () => {
  it("tracks every call as agent_request with attribution and funnel events", async () => {
    const c = ctx(10, { persona: "deadline-driven" });
    await callAgentTool("search_products", { query: "trail", want: ["deliveryEtaDays"] }, c);
    await callAgentTool("get_product", { id: "p_ridge" }, c);
    await callAgentTool("add_to_cart", { id: "p_ridge", size: "10" }, c);
    const order = await callAgentTool("checkout", {}, c);
    expect(order.ok).toBe(true);

    const requests = eventsNamed("agent_request");
    expect(requests.map((e) => e.properties.tool)).toEqual(["search_products", "get_product", "add_to_cart", "checkout"]);
    expect(requests[0].properties).toMatchObject({
      visitor_kind: "agent",
      agent_name: "test-agent",
      $session_id: "ses_test_10",
      synthetic: true,
      persona: "deadline-driven",
      spec_version: 0,
      ok: true,
      missing: ["deliveryEtaDays"],
    });
    expect(requests.every((e) => e.distinct_id === "agt_test_10")).toBe(true);
    expect(eventsNamed("product_viewed")).toHaveLength(1);
    expect(eventsNamed("product_added")[0].properties).toMatchObject({ product_id: "p_ridge", price: 13500, quantity: 1 });
    expect(eventsNamed("checkout_started")).toHaveLength(1);
    const total = 13500 + SHIPPING_FEE;
    expect(eventsNamed("order_completed")[0].properties).toMatchObject({ revenue: total, visitor_kind: "agent", spec_version: 0 });
    expect((order.data as AgentOrder).total).toBe(total);

    const [session] = listAgentSessions(1);
    expect(session).toMatchObject({ sessionId: "ses_test_10", outcome: "purchased", orderTotal: total, synthetic: true });
    expect(session.toolCalls[0]).toMatchObject({ tool: "search_products", ok: true, missing: ["deliveryEtaDays"] });
  });

  it("checkout refuses orders above maxTotal (agent shipping shock)", async () => {
    const c = ctx(11);
    await callAgentTool("add_to_cart", { id: "p_ridge", size: "10" }, c);
    const res = await callAgentTool("checkout", { maxTotal: 13500 }, c);
    expect(res).toMatchObject({ ok: false, code: "over_budget", data: { total: 13500 + SHIPPING_FEE } });
    expect(eventsNamed("checkout_started")).toHaveLength(1);
    expect(eventsNamed("order_completed")).toHaveLength(0);
    expect((await callAgentTool("get_cart", {}, c)).data).toMatchObject({ subtotal: 13500 });
  });
});

describe("merchant negotiation", () => {
  it("never goes below the floor or max discount, and counters converge within 3 rounds", () => {
    for (const product of PRODUCTS) {
      for (const pct of [0, 5, 10, 15, 30]) {
        const floor = merchantFloor(product, pct);
        expect(floor).toBeGreaterThanOrEqual(product.floorPrice);
        expect(floor).toBeGreaterThanOrEqual(Math.ceil(product.price * (1 - pct / 100)));
        expect(floor).toBeLessThanOrEqual(product.price);

        for (const offer of [1, Math.round(product.price * 0.5), floor - 1]) {
          if (offer >= floor) continue;
          let state: NegotiationState = { round: 0 };
          let last = Infinity;
          for (let round = 1; round <= 5; round++) {
            const r = negotiateRound(product, offer, state, pct);
            state = r.state;
            expect(r.outcome.status).not.toBe("accepted");
            const counter = r.outcome.counterOffer!;
            expect(counter).toBeGreaterThanOrEqual(floor);
            expect(counter).toBeLessThanOrEqual(product.price);
            expect(counter).toBeLessThanOrEqual(last);
            last = counter;
            if (round >= 3) {
              expect(counter).toBe(floor);
              expect(r.outcome.status).toBe("final");
            }
          }
        }
      }
    }
  });

  it("accepts offers at or above the counter, but never charges below the floor", () => {
    const ridge = getProduct("p_ridge")!;
    const floor = merchantFloor(ridge, 15); // max(11500, 11475) = 11500
    expect(floor).toBe(11500);
    const r1 = negotiateRound(ridge, 10000, { round: 0 }, 15);
    expect(r1.outcome.status).toBe("counter");
    const r2 = negotiateRound(ridge, r1.outcome.counterOffer!, r1.state, 15);
    expect(r2.outcome).toMatchObject({ status: "accepted", agreedPrice: r1.outcome.counterOffer });
    expect(r2.outcome.bundle).toMatchObject({ productId: "p_socks" });
    expect(r2.outcome.bundle!.price).toBeGreaterThanOrEqual(getProduct("p_socks")!.floorPrice);
  });

  it("honours the agreed price at checkout and records the transcript", async () => {
    useSpec(OPEN_SURFACE);
    const c = ctx(20);
    let offer = 10000;
    let outcome: NegotiationOutcome | undefined;
    for (let i = 0; i < 4 && outcome?.status !== "accepted"; i++) {
      const res = await callAgentTool("negotiate", { id: "p_ridge", offer, message: "Best price?" }, c);
      outcome = res.data as NegotiationOutcome;
      offer = outcome.counterOffer ?? offer;
    }
    expect(outcome?.status).toBe("accepted");
    const agreed = outcome!.agreedPrice!;
    expect(agreed).toBeLessThan(13500);
    expect(agreed).toBeGreaterThanOrEqual(11500);

    const cart = (await callAgentTool("add_to_cart", { id: "p_ridge", size: "10" }, c)).data as CartView;
    expect(cart.items[0].unitPrice).toBe(agreed);
    await callAgentTool("add_to_cart", { id: "p_socks" }, c); // bundle sweetener price applies
    const order = (await callAgentTool("checkout", {}, c)).data as AgentOrder;
    expect(order.subtotal).toBe(agreed + outcome!.bundle!.price);
    expect(order.discount).toBe(13500 - agreed + (1800 - outcome!.bundle!.price));
    expect(eventsNamed("agent_negotiation").length).toBeGreaterThanOrEqual(2);

    const [session] = listAgentSessions(1);
    expect(session.negotiation?.[0]).toMatchObject({ from: "buyer", message: "Best price?", offer: 10000 });
    expect(session.negotiation?.at(-1)).toMatchObject({ from: "merchant", offer: agreed });
  });
});
