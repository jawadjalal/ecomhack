/**
 * Whop webhook signature verification (Standard Webhooks headers).
 * Docs: https://docs.whop.com/developer/guides/webhooks
 *
 * Headers: webhook-id, webhook-timestamp, webhook-signature (v1,<base64>)
 * Signed content: `{webhook-id}.{webhook-timestamp}.{raw body}`
 * HMAC-SHA256 → base64; reject if |now - timestamp| > 5 minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SEC = 5 * 60;

export class WhopWebhookError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Derive HMAC key bytes from WHOP_WEBHOOK_SECRET (`ws_…` as-is; `whsec_…` Standard Webhooks). */
export function webhookKeyBytes(secret: string): Buffer {
  const s = secret.trim();
  if (s.startsWith("whsec_")) {
    return Buffer.from(s.slice("whsec_".length), "base64");
  }
  // Official "Verify without an SDK": key is the ws_… secret string itself.
  return Buffer.from(s, "utf8");
}

function header(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(name.toLowerCase());
}

/** Verify signature and return parsed JSON envelope. Throws WhopWebhookError. */
export function unwrapWhopWebhook(rawBody: string, headers: Headers, secret: string): WhopWebhookEnvelope {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader) {
    throw new WhopWebhookError("missing webhook-id, webhook-timestamp, or webhook-signature", 400);
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new WhopWebhookError("invalid webhook-timestamp", 400);
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > MAX_SKEW_SEC) throw new WhopWebhookError("webhook timestamp outside allowed skew", 401);

  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", webhookKeyBytes(secret)).update(signed, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected);

  const candidates = signatureHeader.split(/\s+/).flatMap((part) => {
    const [version, sig] = part.split(",", 2);
    return version === "v1" && sig ? [sig] : [];
  });
  if (!candidates.length) throw new WhopWebhookError("no v1 webhook-signature", 401);

  let ok = false;
  for (const sig of candidates) {
    const got = Buffer.from(sig);
    if (got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new WhopWebhookError("invalid webhook signature", 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WhopWebhookError("body is not valid JSON", 400);
  }
  if (!parsed || typeof parsed !== "object") throw new WhopWebhookError("invalid envelope", 400);
  const env = parsed as Record<string, unknown>;
  if (typeof env.type !== "string") throw new WhopWebhookError("envelope missing type", 400);

  return {
    id: typeof env.id === "string" ? env.id : id,
    type: env.type,
    timestamp: typeof env.timestamp === "string" ? env.timestamp : new Date(ts * 1000).toISOString(),
    account_id: typeof env.account_id === "string" ? env.account_id : undefined,
    company_id: typeof env.company_id === "string" ? env.company_id : undefined,
    data: (env.data && typeof env.data === "object" ? env.data : {}) as Record<string, unknown>,
    webhook_id: id,
  };
}

export interface WhopWebhookEnvelope {
  id: string;
  type: string;
  timestamp: string;
  account_id?: string;
  company_id?: string;
  data: Record<string, unknown>;
  /** Delivery id from the webhook-id header (use for idempotency). */
  webhook_id: string;
}
