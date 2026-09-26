/**
 * The store's own AI agent (agent-to-agent commerce) for the connected Whop business.
 * Public API of lib/store-agent: /a2a/whop, the demo checkout, and /console/agents use it.
 */
import type { AnalyticsEvent } from "@/lib/contracts";
import { eventStore, track } from "@/lib/analytics/store";
import { conversationLevers, replyTo, STORE_SITE } from "./agent";
import { agentTestResults, getAgentTests, type Lever } from "./experiments";
import { DEMO_CATALOG, getCatalog } from "./catalog";

export { handleA2a, storeAgentCard } from "./a2a";
export { replyTo, rankOffers, pickOffer, budgetOf, resetStoreAgent, STORE_SITE, type AgentTurn } from "./agent";
export {
  AGENT_TEST_RULES,
  LEVERS,
  LEVER_ORDER,
  agentTestResults,
  getAgentTests,
  pitchFor,
  resetAgentTests,
  runningTest,
  setAgentAutopilot,
  shipAgentTest,
  startAgentTest,
  stepAgentTests,
  stopAgentTest,
  type AgentArm,
  type AgentTest,
  type AgentTestDecision,
  type AgentTestResult,
  type AgentTestState,
  type Lever,
} from "./experiments";
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
    if (p.darwin_site === STORE_SITE && ["a2a", "acp", "mcp"].includes(String(p.channel)) && ref) {
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
  recordDemoPayment(checkout.offerId, checkout.ref, true, { exclusive: true });
  transcript.push({ from: "store", text: `Payment received (demo, simulated) for ${checkout.title}.` });
  return { transcript, checkoutUrl: checkout.url, paid: true };
}

/** The paid order already recorded for a checkout reference: a demo payment, or a Whop payment tagged with the ref. */
export function paidOrderFor(ref: string): AnalyticsEvent | undefined {
  if (!ref) return undefined;
  const events = eventStore().all();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event !== "order_completed") continue;
    const meta = e.properties?.whop_metadata as Record<string, unknown> | undefined;
    if (e.properties?.darwin_ref === ref || meta?.darwin_ref === ref) return e;
  }
  return undefined;
}

/** The checkout the store agent opened for this reference and offer (chat, MCP or ACP), newest first. */
export function checkoutFor(ref: string, offerId: string): AnalyticsEvent | undefined {
  if (!ref || !offerId) return undefined;
  const events = eventStore().all();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event !== "checkout_started" || e.properties?.darwin_site !== STORE_SITE || e.properties.darwin_ref !== ref) continue;
    // ACP / MCP sessions list their plans comma-separated.
    if (String(e.properties.product_id ?? "").split(",").includes(offerId)) return e;
  }
  return undefined;
}

/** Refs being paid right now, with the units recorded so far (ACP completes an order line by line, synchronously). */
const paying = new Map<string, number>();

/**
 * The demo checkout's "Pay" button: a labelled, simulated payment credited to the conversation.
 * Only a checkout the store agent opened can be paid: the ref must have a `checkout_started` for this offer (or
 * the caller holds the checkout record itself, `opts.checkout`: an ACP session), else nothing is recorded and
 * `error` is "no_checkout". The payment carries that conversation's agent and channel, so it's credited to it.
 * One paid order per checkout reference: paying a ref that already has an order (demo or Whop) records nothing
 * and answers `alreadyPaid`. Calls in the same synchronous turn are units of the same payment (an ACP order with
 * quantity 2), unless `exclusive` (one request = one payment attempt, e.g. the checkout page's Pay button).
 */
export function recordDemoPayment(
  offerId: string,
  ref: string,
  simulatedBuyer = false,
  opts: { exclusive?: boolean; checkout?: { agentName: string; channel: string } } = {},
): { ok: boolean; title?: string; alreadyPaid?: boolean; error?: "unknown_offer" | "no_checkout" } {
  const offer = DEMO_OFFERS().find((o) => o.id === offerId);
  if (!offer || !/^[\w-]{4,80}$/.test(ref)) return { ok: false, error: "unknown_offer" };
  const started = opts.checkout ? undefined : checkoutFor(ref, offerId);
  if (!opts.checkout && !started) return { ok: false, error: "no_checkout" };
  const agentName = opts.checkout?.agentName ?? (typeof started?.properties.agent_name === "string" ? started.properties.agent_name : undefined);
  const channel = opts.checkout?.channel ?? (typeof started?.properties.channel === "string" ? started.properties.channel : "a2a");
  let unit = opts.exclusive ? undefined : paying.get(ref);
  if (unit === undefined) {
    if (paying.has(ref) || paidOrderFor(ref)) return { ok: true, alreadyPaid: true, title: offer.title };
    unit = 0;
    queueMicrotask(() => paying.delete(ref));
  }
  paying.set(ref, unit + 1);
  track({
    event: "order_completed",
    distinct_id: `agent_${ref}`,
    // Deterministic, so a replay is dropped by the event store and the Supabase mirror (upsert on uuid).
    uuid: `darwin:demo-pay:${ref}:${unit}`,
    properties: {
      darwin_site: STORE_SITE,
      visitor_kind: "agent",
      darwin_ref: ref,
      channel,
      product_id: offer.id,
      revenue: offer.price,
      currency: offer.currency,
      synthetic: true,
      demo_checkout: true,
      ...(agentName ? { agent_name: agentName } : simulatedBuyer ? { agent_name: "darwin-buyer (simulated)" } : {}),
    },
  });
  return { ok: true, title: offer.title };
}

const DEMO_OFFERS = () => DEMO_CATALOG.offers;

/* ------------------------------------------------------------------ simulated buyer agents */

/**
 * Buyer-agent personas and how each pitch lever moves their chance to ask for a checkout link (a toy model: it's
 * how the demo shows the loop working, and every conversation it creates is labelled simulated). `base` is the
 * chance to ask for the link; then only SIM_CHECKOUT_PAID of links get paid, like a real checkout's drop-off.
 */
export const BUYER_PERSONAS: { id: string; share: number; base: number; briefs: string[]; effect: Partial<Record<Lever, number>> }[] = [
  { id: "decisive", share: 0.3, base: 0.46, briefs: ["Trail running coaching under £40 a month", "Best marathon plan"], effect: { "one-pick": 1.5, facts: 1.05, upsell: 0.85 } },
  { id: "cautious", share: 0.3, base: 0.28, briefs: ["Coaching membership under £40 I can cancel any time", "Something one-off under £20"], effect: { facts: 1.9, "one-pick": 1.1, upsell: 0.7 } },
  { id: "api", share: 0.25, base: 0.4, briefs: ["trail running coaching", "gear guide"], effect: { structured: 1.6, facts: 1.1, upsell: 0.9 } },
  { id: "price", share: 0.15, base: 0.34, briefs: ["Cheapest trail running plan", "Something under £10"], effect: { upsell: 0.6, facts: 1.1 } },
];

/** Share of simulated checkout links that get paid (~65%): the rest abandon at checkout. Seeded like the rest. */
export const SIM_CHECKOUT_PAID = 0.65;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n simulated buyer agents shop the store agent (each through the real conversation logic). Labelled synthetic. */
export async function runSimulatedBuyers(n: number, origin: string, seed = Date.now()): Promise<{ buyers: number; paid: number }> {
  const rand = mulberry32(seed);
  let paid = 0;
  const count = Math.max(1, Math.min(500, Math.floor(n)));
  for (let i = 0; i < count; i++) {
    let r = rand();
    const persona = BUYER_PERSONAS.find((p) => (r -= p.share) < 0) ?? BUYER_PERSONAS[0];
    const brief = persona.briefs[Math.floor(rand() * persona.briefs.length)];
    const agentName = `simulated ${persona.id} buyer`;
    // Seeded conversation ids: the same seed gives the same arms, so runs are reproducible.
    const first = await replyTo(brief, { contextId: `ctx_sim_${(seed >>> 0).toString(36)}_${i}`, agentName, origin, synthetic: true });
    const levers = conversationLevers(first.contextId) ?? [];
    const p = Math.min(0.95, levers.reduce((acc, l) => acc * (persona.effect[l] ?? 1), persona.base));
    if (!first.data.offers?.length || rand() >= p) continue;
    const buy = await replyTo(first.data.buy?.reply ?? "buy the first one", { contextId: first.contextId, agentName, origin, synthetic: true });
    const checkout = buy.data.checkout;
    if (!checkout || rand() >= SIM_CHECKOUT_PAID) continue;
    const catalog = await getCatalog();
    const offer = catalog.offers.find((o) => o.id === checkout.offerId);
    track({
      event: "order_completed",
      distinct_id: `agent_${checkout.ref}`,
      properties: { darwin_site: STORE_SITE, visitor_kind: "agent", agent_name: agentName, darwin_ref: checkout.ref, channel: "a2a", product_id: checkout.offerId, revenue: offer?.price ?? 0, currency: offer?.currency, synthetic: true },
    });
    paid++;
  }
  return { buyers: count, paid };
}

/** Tests on the agent's pitch, with their results. */
export function agentTestsView(events: readonly AnalyticsEvent[]) {
  const state = getAgentTests();
  return { state, results: agentTestResults(events, state) };
}
