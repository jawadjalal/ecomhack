/**
 * Whop → Darwin analytics webhook.
 *
 * Dashboard setup (https://whop.com/dashboard → Developer → Webhooks → Create webhook):
 * 1. URL: https://darwin-storefront.vercel.app/api/whop/webhook  (HTTPS; ngrok for local)
 * 2. API version: v1
 * 3. Events: payment.created, payment.pending, payment.authorized, payment.requires_action,
 *    payment.succeeded, payment.failed, payment.canceled, refund.created, refund.updated
 * 4. Copy signing secret (ws_…) → WHOP_WEBHOOK_SECRET (shown once / Secret column)
 * 5. Account API key (Developer → Account API Keys) → WHOP_API_KEY
 * 6. Account id from GET /api/v1/accounts/me (biz_…) → WHOP_COMPANY_ID
 *
 * Docs: https://docs.whop.com/developer/guides/webhooks
 * Signature: Standard Webhooks headers; verified with node:crypto (no SDK — unwrap helper
 * ships in a future @whop/sdk release per Whop docs).
 */
import { NextResponse } from "next/server";
import { track } from "@/lib/analytics/store";
import { alreadySeen, markSeen } from "@/lib/whop/dedupe";
import { mapWhopEvent } from "@/lib/whop/map";
import { unwrapWhopWebhook, WhopWebhookError } from "@/lib/whop/verify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "WHOP_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  let envelope;
  try {
    envelope = unwrapWhopWebhook(rawBody, req.headers, secret);
  } catch (err) {
    if (err instanceof WhopWebhookError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // Optional company filter when WHOP_COMPANY_ID is set (biz_…).
  const expectedCompany = process.env.WHOP_COMPANY_ID?.trim();
  if (expectedCompany) {
    const got = envelope.account_id ?? envelope.company_id;
    if (got && got !== expectedCompany) {
      return NextResponse.json({ ok: true, ignored: "company_mismatch" });
    }
  }

  // Idempotent: same webhook-id on retries.
  if (alreadySeen(envelope.webhook_id)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const mapped = mapWhopEvent(envelope);
  if (mapped === null) {
    markSeen(envelope.webhook_id);
    return NextResponse.json({ ok: true, ignored: envelope.type });
  }

  // Drop events whose uuid we already stored (payment-id dedupe via deterministic uuids).
  const fresh = mapped.filter((e) => !(e.uuid && alreadySeen(e.uuid)));
  const stored = fresh.length ? track(fresh) : [];
  for (const e of fresh) {
    if (e.uuid) markSeen(e.uuid);
  }
  markSeen(envelope.webhook_id);

  return NextResponse.json({
    ok: true,
    type: envelope.type,
    tracked: stored.length,
    events: stored.map((e) => e.event),
  });
}
