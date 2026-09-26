import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { kvDelete } from "@/lib/db/json-store";
import { POST } from "@/app/api/whop/webhook/route";
import { webhookKeyBytes } from "./verify";

const SECRET = "ws_test_webhook_secret_0123456789abcdef";

/** A signed Whop delivery, as Whop sends it (Standard Webhooks headers). */
function delivery(webhookId: string, envelope: Record<string, unknown>) {
  const body = JSON.stringify(envelope);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", webhookKeyBytes(SECRET)).update(`${webhookId}.${ts}.${body}`, "utf8").digest("base64");
  return new Request("http://localhost/api/whop/webhook", {
    method: "POST",
    headers: { "webhook-id": webhookId, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}`, "content-type": "application/json" },
    body,
  });
}

const paid = (eventId: string, data: Record<string, unknown>) => ({
  id: eventId,
  type: "payment.succeeded",
  timestamp: "2026-09-26T10:00:00.000Z",
  data: { total: 29, currency: "gbp", plan: { id: "plan_1" }, metadata: { darwin_ref: "ctx_whop_1", agent_name: "ChatGPT" }, ...data },
});

const orders = () => eventStore().all().filter((e) => e.event === "order_completed");
const revenue = () => orders().reduce((s, e) => s + Number(e.properties.revenue ?? 0), 0);

beforeEach(() => {
  vi.stubEnv("WHOP_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("WHOP_COMPANY_ID", "");
  kvDelete("whop-webhook-seen");
  eventStore().clear();
});
afterEach(() => vi.unstubAllEnvs());

describe("Whop webhook retries never count revenue twice", () => {
  it("the same delivery retried (same webhook-id) is tracked once", async () => {
    const first = await (await POST(delivery("msg_retry_1", paid("evt_1", { id: "pay_1" })))).json();
    expect(first).toMatchObject({ ok: true, tracked: 2, events: ["checkout_started", "order_completed"] });
    for (let i = 0; i < 3; i++) expect(await (await POST(delivery("msg_retry_1", paid("evt_1", { id: "pay_1" })))).json()).toMatchObject({ ok: true, duplicate: true });
    expect(orders()).toHaveLength(1);
    expect(revenue()).toBe(2900);
  });

  it("a re-delivery under a new webhook-id is deduped by the payment id", async () => {
    await POST(delivery("msg_a", paid("evt_2", { id: "pay_2" })));
    const again = await (await POST(delivery("msg_b", paid("evt_2b", { id: "pay_2" })))).json();
    expect(again).toMatchObject({ ok: true, tracked: 0 });
    expect(orders()).toHaveLength(1);
  });

  it("a re-delivery of the same event (same event id) under a new webhook-id is deduped even without a payment id", async () => {
    await POST(delivery("msg_c", paid("evt_3", {})));
    const again = await (await POST(delivery("msg_d", paid("evt_3", {})))).json();
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(orders()).toHaveLength(1);
  });

  it("stays deduped after the in-memory events are gone (server restart)", async () => {
    await POST(delivery("msg_e", paid("evt_4", { id: "pay_4" })));
    eventStore().clear();
    expect(await (await POST(delivery("msg_e", paid("evt_4", { id: "pay_4" })))).json()).toMatchObject({ duplicate: true });
    expect(await (await POST(delivery("msg_f", paid("evt_4b", { id: "pay_4" })))).json()).toMatchObject({ tracked: 0 });
    expect(orders()).toHaveLength(0);
  });

  it("different payments (a renewal) are separate orders", async () => {
    await POST(delivery("msg_g", paid("evt_5", { id: "pay_5" })));
    await POST(delivery("msg_h", paid("evt_6", { id: "pay_6" })));
    expect(orders()).toHaveLength(2);
    expect(revenue()).toBe(5800);
  });
});
