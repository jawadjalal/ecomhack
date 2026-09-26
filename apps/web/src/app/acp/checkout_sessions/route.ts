import { acpHttp, acpPreflight } from "@/lib/store-agent/acp";

export const dynamic = "force-dynamic";

/**
 * POST /acp/checkout_sessions — ACP (Agentic Commerce Protocol) create: { items: [{ id, quantity }], buyer? }
 * → 201 CheckoutSession. Items are the Whop store's plan ids. Public (any buyer agent), rate-limited.
 */
export function POST(req: Request) {
  return acpHttp(req, "create");
}

export const OPTIONS = acpPreflight;
