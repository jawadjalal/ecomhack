/**
 * The store's own AI agent (agent-to-agent commerce) for the connected Whop business.
 * Public API of lib/store-agent: /a2a/whop, the demo checkout, and /console/agents use it.
 */
import type { AnalyticsEvent } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { replyTo, STORE_SITE } from "./agent";
import { DEMO_CATALOG, getCatalog } from "./catalog";

export { handleA2a, storeAgentCard } from "./a2a";
export { replyTo, rankOffers, pickOffer, budgetOf, resetStoreAgent, STORE_SITE, type AgentTurn } from "./agent";
export { getCatalog, createCheckout, offerFromPlan, formatPrice, resetCatalog, companyId, DEMO_CATALOG, type Catalog, type Offer } from "./catalog";

export interface AgentFunnel {
  conversations: number;
  offersShown: number;
  checkouts: number;
  paid: number;
  revenue: number;
  /** Paid conversations / conversations. */
  conversion: number;
  byAgent: { agent: string; conversations: number; checkouts: number; paid: number }[];
  recent: { at: string; agent: string; ref: string; step: string; title?: string; price?: number }[];
  /** How many of the counted conversations were simulated buyers. */
  simulated: number;
}

/**
 * The agent funnel from events: conversations → offers → checkout links → payments. A payment counts when
 * its darwin_ref (Whop metadata, or the demo checkout) matches a conversation, or it's an agent payment.
 */
export function agentFunnel(events: readonly AnalyticsEvent[]): AgentFunnel {
  const convs = new Map<string, { agent: string; offers: boolean; checkout: boolean; paid: boolean; simulated: boolean }>();
  const recent: AgentFunnel["recent"] = [];
  let revenue = 0;
  let unlinkedAgentPaid = 0;
  for (const e of events) {
    const p = e.properties ?? {};
    const meta = (p.whop_metadata ?? {}) as Record<string, unknown>;
    const ref = typeof p.darwin_ref === "string" ? p.darwin_ref : typeof meta.darwin_ref === "string" ? meta.darwin_ref : undefined;
    const agent = String(p.agent_name ?? meta.agent_name ?? "agent");
    if (p.darwin_site === STORE_SITE && p.channel === "a2a" && ref) {
      let c = convs.get(ref);
      if (!c) convs.set(ref, (c = { agent, offers: false, checkout: false, paid: false, simulated: p.synthetic === true }));
      if (e.event === "product_viewed") c.offers = true;
      if (e.event === "checkout_started") {
        c.checkout = true;
        recent.push({ at: e.timestamp, agent, ref, step: "checkout link", title: String(p.product_id ?? ""), price: Number(p.price) || undefined });
      }
    }
    if (e.event === "order_completed" && (ref || p.visitor_kind === "agent") && (p.darwin_site === STORE_SITE || typeof p.whop_event === "string")) {
      const c = ref ? convs.get(ref) : undefined;
      if (c) c.paid = true;
      else unlinkedAgentPaid++;
      revenue += Number(p.revenue) || 0;
      recent.push({ at: e.timestamp, agent, ref: ref ?? "", step: "paid", price: Number(p.revenue) || undefined });
    }
  }
  const all = [...convs.values()];
  const byAgent = new Map<string, { agent: string; conversations: number; checkouts: number; paid: number }>();
  for (const c of all) {
    const a = byAgent.get(c.agent) ?? { agent: c.agent, conversations: 0, checkouts: 0, paid: 0 };
    a.conversations++;
    if (c.checkout) a.checkouts++;
    if (c.paid) a.paid++;
    byAgent.set(c.agent, a);
  }
  const paid = all.filter((c) => c.paid).length + unlinkedAgentPaid;
  return {
    conversations: all.length,
    offersShown: all.filter((c) => c.offers).length,
    checkouts: all.filter((c) => c.checkout).length,
    paid,
    revenue,
    conversion: all.length ? all.filter((c) => c.paid).length / all.length : 0,
    byAgent: [...byAgent.values()].sort((a, b) => b.conversations - a.conversations),
    recent: recent.slice(-12).reverse(),
    simulated: all.filter((c) => c.simulated).length,
  };
}

/** A simulated buyer agent's whole purchase, for demos: ask → offers → buy → (demo) pay. Labelled synthetic. */
export async function runSimulatedBuyer(brief: string, origin: string): Promise<{ transcript: { from: "buyer" | "store"; text: string }[]; checkoutUrl?: string; paid: boolean }> {
  const transcript: { from: "buyer" | "store"; text: string }[] = [];
  const say = async (text: string, contextId?: string) => {
    transcript.push({ from: "buyer", text });
    const turn = await replyTo(text, { contextId, agentName: "darwin-buyer (simulated)", origin, synthetic: true });
    transcript.push({ from: "store", text: turn.text });
    return turn;
  };
  const first = await say(brief);
  if (!first.data.offers?.length) return { transcript, paid: false };
  const buy = await say("Buy the first one", first.contextId);
  const checkout = buy.data.checkout;
  if (!checkout) return { transcript, paid: false };
  // Only the demo checkout can be "paid" here; a real Whop checkout needs a real payment.
  const catalog = await getCatalog();
  if (catalog.source !== "demo") return { transcript, checkoutUrl: checkout.url, paid: false };
  recordDemoPayment(checkout.offerId, checkout.ref, true);
  transcript.push({ from: "store", text: `Payment received (demo, simulated) for ${checkout.title}.` });
  return { transcript, checkoutUrl: checkout.url, paid: true };
}

/** The demo checkout's "Pay" button: a labelled, simulated payment credited to the conversation. */
export function recordDemoPayment(offerId: string, ref: string, simulatedBuyer = false): { ok: boolean; title?: string } {
  const offer = DEMO_OFFERS().find((o) => o.id === offerId);
  if (!offer || !/^[\w-]{4,80}$/.test(ref)) return { ok: false };
  track({
    event: "order_completed",
    distinct_id: `agent_${ref}`,
    properties: {
      darwin_site: STORE_SITE,
      visitor_kind: "agent",
      darwin_ref: ref,
      channel: "a2a",
      product_id: offer.id,
      revenue: offer.price,
      currency: offer.currency,
      synthetic: true,
      demo_checkout: true,
      ...(simulatedBuyer ? { agent_name: "darwin-buyer (simulated)" } : {}),
    },
  });
  return { ok: true, title: offer.title };
}

const DEMO_OFFERS = () => DEMO_CATALOG.offers;
