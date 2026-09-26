/**
 * The store's own agent: what a shopper's agent (ChatGPT, Claude, Perplexity, a custom buyer) talks to.
 *
 *   "trail running coaching under £40 a month"  → up to 3 offers, with price and billing, as text + data
 *   "buy the first one" / "buy Race-Day Pack"    → a checkout link tagged with this conversation (ref)
 *
 * Every step is an event (visitor_kind "agent", darwin_site "whop"), so the agent funnel is measurable:
 * conversation → offers shown → checkout link → payment (Whop webhook, credited by the ref in metadata).
 */
import type { AnalyticsEventInput } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { id } from "@/lib/ids";
import { createCheckout, formatPrice, getCatalog, type Catalog, type Offer } from "./catalog";
import { pitchFor, type Lever } from "./experiments";

export const STORE_SITE = "whop";

export interface AgentTurn {
  contextId: string;
  text: string;
  /** Structured payload for agents that read data parts. */
  data: {
    intent: "offers" | "checkout" | "info" | "none";
    business: string;
    catalog: Catalog["source"];
    offers?: { id: string; title: string; description?: string; price: number; currency: string; billing: string; priceLabel: string }[];
    /** Structured pitch: exactly how to buy (lever "structured"). */
    buy?: { reply: string; offerIds: string[] };
    /** Policy facts (lever "facts"). */
    facts?: string[];
    checkout?: { url: string; offerId: string; title: string; ref: string; tagged: boolean };
  };
}

interface Conversation {
  shown: string[];
  agentName: string;
  synthetic: boolean;
  startedAt: string;
  /** How this conversation is pitched (its arm in the running A/B test, else the default). */
  levers: Lever[];
}

const g = globalThis as unknown as { __darwinStoreAgent?: Map<string, Conversation> };
const conversations = () => (g.__darwinStoreAgent ??= new Map());

const STOP = new Set([
  ...["i", "a", "an", "the", "for", "and", "or", "to", "of", "me", "my", "we", "want", "need", "looking", "find", "show", "some", "something", "anything"],
  ...["any", "with", "under", "below", "less", "than", "per", "month", "monthly", "year", "yearly", "please", "can", "you", "do", "have", "is", "are"],
  ...["it", "that", "this", "what", "which", "one", "off", "time", "buy", "get", "cheap", "cheapest", "best", "good", "thing", "stuff", "max", "budget"],
]);

/** Words that describe what they want (not prices, budgets or filler). */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** "under £40", "max $50", "less than 30" → minor units. */
export function budgetOf(text: string): number | undefined {
  const m = text.toLowerCase().match(/(?:under|below|less than|max(?:imum)?|up to|budget(?: of)?|within|<)\s*[£$€]?\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Math.round(Number(m[1]) * 100) : undefined;
}

function wantsMembership(text: string): boolean | undefined {
  if (/\b(monthly|subscription|membership|member|per month|a month|yearly|annual)\b/i.test(text)) return true;
  if (/\b(one[- ]?off|one[- ]?time|once|lifetime|no subscription)\b/i.test(text)) return false;
  return undefined;
}

/** Offers ranked for a request: keyword overlap first, cheaper first on ties; out-of-budget dropped. */
export function rankOffers(offers: Offer[], text: string): Offer[] {
  const q = words(text);
  const budget = budgetOf(text);
  const membership = wantsMembership(text);
  return offers
    .filter((o) => budget === undefined || o.price <= budget)
    .filter((o) => membership === undefined || (o.billing !== "one_time") === membership)
    .map((o) => {
      const hay = words(`${o.title} ${o.description ?? ""}`);
      const score = q.filter((w) => hay.some((h) => h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5)))).length;
      return { o, score };
    })
    .filter((x, _i, all) => q.length === 0 || (x.score > 0 && x.score * 2 >= Math.max(...all.map((y) => y.score))))
    .sort((a, b) => b.score - a.score || a.o.price - b.o.price)
    .map((x) => x.o);
}

const BUY = /\b(buy|purchase|check ?out|order|subscribe|sign me up|i'?ll take|take (it|the)|get (it|the)|go with)\b/i;
const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|#1|number one|option 1)\b/i, 0],
  [/\b(second|2nd|#2|option 2)\b/i, 1],
  [/\b(third|3rd|#3|option 3)\b/i, 2],
];

/** Which offer a "buy …" message means: an ordinal of what was shown, the cheapest, a named one, or the only one shown. */
export function pickOffer(text: string, offers: Offer[], shown: string[]): Offer | undefined {
  const byId = offers.find((o) => text.includes(o.id));
  if (byId) return byId;
  const shownOffers = shown.map((s) => offers.find((o) => o.id === s)).filter((o): o is Offer => !!o);
  const ord = ORDINALS.find(([re]) => re.test(text));
  if (ord && shownOffers[ord[1]]) return shownOffers[ord[1]];
  if (/\bcheapest\b/i.test(text)) return [...(shownOffers.length ? shownOffers : offers)].sort((a, b) => a.price - b.price)[0];
  const named = rankOffers(offers, text.replace(BUY, " "))[0];
  if (named && words(text.replace(BUY, " ")).length) return named;
  if (shownOffers.length === 1 || /\b(it|that|this)\b/i.test(text)) return shownOffers[0];
  return undefined;
}

function event(name: string, ref: string, conv: Conversation, props: Record<string, unknown> = {}): AnalyticsEventInput {
  return {
    event: name,
    distinct_id: `agent_${ref}`,
    properties: { darwin_site: STORE_SITE, visitor_kind: "agent", agent_name: conv.agentName, darwin_ref: ref, channel: "a2a", synthetic: conv.synthetic, ...props },
  };
}

const offerData = (o: Offer) => ({ id: o.id, title: o.title, description: o.description, price: o.price, currency: o.currency, billing: o.billing, priceLabel: formatPrice(o) });

/** One buyer-agent message → the store agent's reply (and the events it implies). */
export async function replyTo(
  message: string,
  opts: { contextId?: string; agentName?: string; origin: string; synthetic?: boolean },
): Promise<AgentTurn> {
  const contextId = opts.contextId && /^[\w-]{4,80}$/.test(opts.contextId) ? opts.contextId : id("ctx");
  const convs = conversations();
  let conv = convs.get(contextId);
  const events: AnalyticsEventInput[] = [];
  if (!conv) {
    const pitch = pitchFor(contextId);
    conv = { shown: [], agentName: (opts.agentName ?? "unknown-agent").slice(0, 60), synthetic: !!opts.synthetic, startedAt: new Date().toISOString(), levers: pitch.levers };
    convs.set(contextId, conv);
    if (convs.size > 5000) convs.delete(convs.keys().next().value!);
    events.push(event("agent_conversation_started", contextId, conv, { levers: pitch.levers.join(",") }));
    if (pitch.testId) events.push(event("agent_variant", contextId, conv, { test_id: pitch.testId, variant: pitch.variant, levers: pitch.levers.join(",") }));
  }
  const catalog = await getCatalog();
  const base = { business: catalog.business, catalog: catalog.source };
  const text = message.trim().slice(0, 1000);
  events.push(event("agent_message", contextId, conv, { length: text.length }));

  let turn: AgentTurn;
  if (BUY.test(text)) {
    const offer = pickOffer(text, catalog.offers, conv.shown);
    if (!offer) {
      turn = { contextId, text: `Which one? Tell me the name, or ask me what's available first.`, data: { intent: "none", ...base } };
    } else {
      const checkout = await createCheckout(offer, catalog, { ref: contextId, agentName: conv.agentName, synthetic: conv.synthetic }, opts.origin);
      events.push(event("checkout_started", contextId, conv, { product_id: offer.id, price: offer.price, currency: offer.currency, value: offer.price, checkout_tagged: checkout.tagged }));
      turn = {
        contextId,
        text: `${offer.title}, ${formatPrice(offer)}. Checkout: ${checkout.url} . Payment happens on ${catalog.source === "demo" ? "the demo checkout (no real charge)" : "Whop"}; access is instant once it goes through.`,
        data: { intent: "checkout", ...base, checkout: { url: checkout.url, offerId: offer.id, title: offer.title, ref: contextId, tagged: checkout.tagged } },
      };
    }
  } else if (/\b(refund|return|cancel|support|contact|help|who are you|what do you sell)\b/i.test(text) && !budgetOf(text)) {
    turn = {
      contextId,
      text: `I'm the store agent for ${catalog.business}. I can list what's for sale with prices, and give you a checkout link when you're ready. Memberships can be cancelled any time from your Whop account; for refunds, contact the seller through Whop.`,
      data: { intent: "info", ...base },
    };
  } else {
    const ranked = rankOffers(catalog.offers, text);
    const L = new Set(conv.levers);
    let top = (ranked.length ? ranked : [...catalog.offers].sort((a, b) => a.price - b.price)).slice(0, 3);
    // upsell: lead with the biggest plan in the catalog.
    if (L.has("upsell")) {
      const biggest = [...catalog.offers].sort((a, b) => b.price - a.price)[0];
      if (biggest) top = [biggest, ...top.filter((o) => o.id !== biggest.id)].slice(0, 3);
    }
    // one-pick: a single recommendation, with the reason.
    const others = top.length - 1;
    if (L.has("one-pick")) top = top.slice(0, 1);
    conv.shown = top.map((o) => o.id);
    for (const o of top) events.push(event("product_viewed", contextId, conv, { product_id: o.id, price: o.price, currency: o.currency }));
    const exact = ranked.length > 0;
    const facts = L.has("facts") ? ["Instant access as soon as the payment goes through.", "Memberships cancel any time from your Whop account.", "Payment is handled by Whop's checkout."] : undefined;
    const lines = L.has("one-pick")
      ? [`My pick for you: ${top[0].title}, ${formatPrice(top[0])}.${top[0].description ? ` ${top[0].description}` : ""}`, `${exact ? "It's the closest match to what you asked for" : "Nothing matches exactly; it's our most popular starting point"}${others > 0 ? ` (${others} other option${others === 1 ? "" : "s"}: ask to see them)` : ""}.`]
      : [`${exact ? "Here's what fits" : "Nothing matches that exactly; here's what we have"} at ${catalog.business}:`, ...top.map((o, i) => `${i + 1}. ${L.has("upsell") && i === 0 ? "Best value: " : ""}${o.title}: ${formatPrice(o)}${o.description ? `. ${o.description}` : ""}`)];
    if (facts) lines.push(`Good to know: ${facts.join(" ")}`);
    lines.push(L.has("structured") ? `To buy, reply: buy ${top[0].id}${top.length > 1 ? ` (or the id of another offer: ${top.slice(1).map((o) => o.id).join(", ")})` : ""}.` : `Say "buy the first one" (or its name) and I'll send a checkout link.`);
    turn = {
      contextId,
      text: lines.join("\n"),
      data: {
        intent: "offers",
        ...base,
        offers: top.map(offerData),
        ...(facts ? { facts } : {}),
        ...(L.has("structured") ? { buy: { reply: `buy ${top[0].id}`, offerIds: top.map((o) => o.id) } } : {}),
      },
    };
  }
  track(events);
  return turn;
}

/** How a conversation is being pitched (for simulated buyers and tests). */
export function conversationLevers(contextId: string): Lever[] | undefined {
  return conversations().get(contextId)?.levers;
}

export function resetStoreAgent() {
  conversations().clear();
}
