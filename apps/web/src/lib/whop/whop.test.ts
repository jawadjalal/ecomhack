import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapWhopEvent, toMinorUnits } from "./map";
import { unwrapWhopWebhook, webhookKeyBytes, WhopWebhookError } from "./verify";

function sign(id: string, ts: string, body: string, secret: string) {
  const signed = `${id}.${ts}.${body}`;
  const dig = createHmac("sha256", webhookKeyBytes(secret)).update(signed, "utf8").digest("base64");
  return `v1,${dig}`;
}

describe("whop verify", () => {
  it("accepts a valid signed envelope", () => {
    const secret = "ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const body = JSON.stringify({
      id: "msg_test",
      type: "payment.succeeded",
      timestamp: "2026-08-10T17:03:24.291Z",
      account_id: "biz_x",
      data: { id: "pay_1", total: 10.5, currency: "usd", product: { id: "prod_1" } },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const id = "msg_delivery_1";
    const headers = new Headers({
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sign(id, ts, body, secret),
      "content-type": "application/json",
    });
    const env = unwrapWhopWebhook(body, headers, secret);
    expect(env.type).toBe("payment.succeeded");
    expect(env.data.id).toBe("pay_1");
  });

  it("rejects a bad signature", () => {
    const secret = "ws_abcdef";
    const body = '{"type":"payment.succeeded","data":{}}';
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({
      "webhook-id": "msg_x",
      "webhook-timestamp": ts,
      "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    expect(() => unwrapWhopWebhook(body, headers, secret)).toThrow(WhopWebhookError);
  });
});

describe("whop map", () => {
  it("maps payment.succeeded to checkout_started + order_completed", () => {
    const events = mapWhopEvent({
      id: "msg_1",
      type: "payment.succeeded",
      timestamp: "2026-01-01T00:00:00.000Z",
      account_id: "biz_x",
      webhook_id: "msg_1",
      data: {
        id: "pay_abc",
        total: 19.99,
        currency: "usd",
        product: { id: "prod_1" },
        plan: { id: "plan_1" },
        user: { id: "user_1" },
        metadata: { visitor_kind: "agent", agent_name: "grok-shopper" },
      },
    });
    expect(events).toHaveLength(2);
    expect(events![0].event).toBe("checkout_started");
    expect(events![1].event).toBe("order_completed");
    expect(events![1].distinct_id).toBe("user_1");
    expect(events![1].properties.visitor_kind).toBe("agent");
    expect(events![1].properties.agent_name).toBe("grok-shopper");
    expect(events![1].properties.revenue).toBe(1999);
    expect(events![1].properties.whop_payment_id).toBe("pay_abc");
  });

  it("maps payment.failed to checkout_abandoned", () => {
    const events = mapWhopEvent({
      id: "msg_2",
      type: "payment.failed",
      timestamp: "2026-01-01T00:00:00.000Z",
      webhook_id: "msg_2",
      data: { id: "pay_fail", currency: "usd", total: 5 },
    });
    expect(events![0].event).toBe("checkout_abandoned");
    expect(events![0].properties.visitor_kind).toBe("human");
  });

  it("maps refund.created to order_refunded", () => {
    const events = mapWhopEvent({
      id: "msg_3",
      type: "refund.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      webhook_id: "msg_3",
      data: {
        id: "rf_1",
        amount: 6.9,
        currency: "usd",
        status: "pending",
        payment: { id: "pay_1", product: { id: "prod_1" } },
      },
    });
    expect(events![0].event).toBe("order_refunded");
    expect(events![0].properties.revenue).toBe(-690);
  });

  it("ignores non-funnel events", () => {
    expect(
      mapWhopEvent({
        id: "msg_4",
        type: "membership.activated",
        timestamp: "2026-01-01T00:00:00.000Z",
        webhook_id: "msg_4",
        data: { id: "mem_1" },
      }),
    ).toBeNull();
  });

  it("converts minor units", () => {
    expect(toMinorUnits(10.5, "usd")).toBe(1050);
    expect(toMinorUnits(1000, "jpy")).toBe(1000);
  });
});
