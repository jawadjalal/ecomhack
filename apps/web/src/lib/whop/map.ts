/**
 * Map Whop webhook purchase-funnel events → Darwin AnalyticsEventInput(s).
 * Official event names: https://docs.whop.com/developer/guides/webhooks
 */
import type { AnalyticsEventInput, EventProperties, VisitorKind } from "@/lib/contracts";
import { EVENTS } from "@/lib/contracts";
import type { WhopWebhookEnvelope } from "./verify";

/** Currencies where Whop's decimal amount is already the minor unit (no *100). */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

export function toMinorUnits(amount: number, currency: string | undefined): number {
  const c = (currency ?? "usd").toLowerCase();
  if (!Number.isFinite(amount)) return 0;
  if (ZERO_DECIMAL.has(c)) return Math.round(amount);
  return Math.round(amount * 100);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function nestedId(obj: unknown, ...keys: string[]): string | undefined {
  let cur: unknown = obj;
  for (const k of keys) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[k];
  }
  return asString(cur);
}

function resolveVisitor(meta: Record<string, unknown> | undefined): {
  visitor_kind: VisitorKind;
  agent_name?: string;
} {
  const kindRaw = asString(meta?.visitor_kind)?.toLowerCase();
  const agentName = asString(meta?.agent_name) ?? asString(meta?.agentName);
  if (kindRaw === "agent" || agentName) {
    return { visitor_kind: "agent", ...(agentName ? { agent_name: agentName } : {}) };
  }
  return { visitor_kind: "human" };
}

function paymentFields(data: Record<string, unknown>) {
  const meta = asRecord(data.metadata);
  const currency = asString(data.currency);
  const total = asNumber(data.total) ?? asNumber(data.usd_total) ?? asNumber(data.subtotal) ?? asNumber(data.amount);
  const productId =
    nestedId(data, "product", "id") ?? asString(data.product_id) ?? asString(data.productId);
  const planId = nestedId(data, "plan", "id") ?? asString(data.plan_id) ?? asString(data.planId);
  const userId = nestedId(data, "user", "id") ?? nestedId(data, "member", "id") ?? asString(data.user_id);
  const paymentId = asString(data.id);
  const visitor = resolveVisitor(meta);

  const props: EventProperties = {
    ...visitor,
    source: "whop",
    whop_payment_id: paymentId,
    whop_product_id: productId,
    whop_plan_id: planId,
    product_id: productId ?? planId,
    currency,
    ...(total !== undefined ? { revenue: toMinorUnits(total, currency), price: toMinorUnits(total, currency) } : {}),
    ...(meta ? { whop_metadata: meta } : {}),
  };

  return { paymentId, userId, props, visitor };
}

function refundFields(data: Record<string, unknown>) {
  const payment = asRecord(data.payment) ?? {};
  const currency = asString(data.currency) ?? asString(payment.currency);
  const amount = asNumber(data.amount);
  const paymentId = asString(payment.id) ?? asString(data.payment_id);
  const productId = nestedId(payment, "product", "id");
  const planId = nestedId(payment, "plan", "id");
  const userId = nestedId(payment, "user", "id") ?? nestedId(payment, "member", "id");
  const meta = asRecord(payment.metadata);
  const visitor = resolveVisitor(meta);
  const refundId = asString(data.id);

  const props: EventProperties = {
    ...visitor,
    source: "whop",
    whop_refund_id: refundId,
    whop_payment_id: paymentId,
    whop_product_id: productId,
    whop_plan_id: planId,
    product_id: productId ?? planId,
    currency,
    whop_refund_status: asString(data.status),
    ...(amount !== undefined ? { revenue: -toMinorUnits(amount, currency), price: toMinorUnits(amount, currency) } : {}),
  };

  return { refundId, paymentId, userId, props };
}

const CHECKOUT_STARTED = new Set([
  "payment.created",
  "payment.pending",
  "payment.authorized",
  "payment.requires_action",
]);

const CHECKOUT_ABANDONED = new Set(["payment.failed", "payment.canceled"]);

/**
 * Map one Whop envelope to zero or more Darwin events.
 * Returns null when the event type is outside the purchase funnel (ignored).
 */
export function mapWhopEvent(envelope: WhopWebhookEnvelope): AnalyticsEventInput[] | null {
  const { type, data, timestamp } = envelope;
  const distinctFallback = `whop:${envelope.account_id ?? envelope.company_id ?? "unknown"}`;

  if (CHECKOUT_STARTED.has(type)) {
    const { paymentId, userId, props } = paymentFields(data);
    return [
      {
        event: EVENTS.checkoutStarted,
        distinct_id: userId ?? paymentId ?? distinctFallback,
        timestamp,
        uuid: `whop:${type}:${paymentId ?? envelope.webhook_id}`,
        properties: { ...props, whop_event: type },
      },
    ];
  }

  if (type === "payment.succeeded") {
    const { paymentId, userId, props } = paymentFields(data);
    const distinct = userId ?? paymentId ?? distinctFallback;
    // Funnel: checkout_started then order_completed (idempotent uuids).
    return [
      {
        event: EVENTS.checkoutStarted,
        distinct_id: distinct,
        timestamp,
        uuid: `whop:payment.created:${paymentId ?? envelope.webhook_id}`,
        properties: { ...props, whop_event: type, inferred: true },
      },
      {
        event: EVENTS.orderCompleted,
        distinct_id: distinct,
        timestamp,
        uuid: `whop:order_completed:${paymentId ?? envelope.webhook_id}`,
        properties: { ...props, whop_event: type },
      },
    ];
  }

  if (CHECKOUT_ABANDONED.has(type)) {
    const { paymentId, userId, props } = paymentFields(data);
    return [
      {
        event: EVENTS.checkoutAbandoned,
        distinct_id: userId ?? paymentId ?? distinctFallback,
        timestamp,
        uuid: `whop:${type}:${paymentId ?? envelope.webhook_id}`,
        properties: {
          ...props,
          whop_event: type,
          reason: type === "payment.failed" ? "payment_failed" : "payment_canceled",
          failure_message: asString(data.failure_message),
          decline_code: asString(data.decline_code),
        },
      },
    ];
  }

  if (type === "refund.created" || type === "refund.updated") {
    const status = asString(data.status);
    // Only count terminal / in-flight refunds that matter for analytics.
    if (type === "refund.updated" && status && status !== "succeeded" && status !== "pending") {
      return [];
    }
    const { refundId, paymentId, userId, props } = refundFields(data);
    return [
      {
        event: "order_refunded",
        distinct_id: userId ?? paymentId ?? refundId ?? distinctFallback,
        timestamp,
        uuid: `whop:order_refunded:${refundId ?? envelope.webhook_id}`,
        properties: { ...props, whop_event: type },
      },
    ];
  }

  // membership.activated without a payment is access grant, not a purchase — skip.
  return null;
}
