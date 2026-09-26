/**
 * The store's own agent: what a shopper's agent (ChatGPT, Claude, Perplexity, a custom buyer) talks to.
 *
 *   "trail running coaching under £40 a month"  → up to 3 offers, with price and billing, as text + data
 *   "buy the first one" / "buy Race-Day Pack"    → a checkout link tagged with this conversation (ref)
 *
 * Every step is an event (visitor_kind "agent", darwin_site "whop"), so the agent funnel is measurable:
 * conversation → offers shown → checkout link → payment (Whop webhook, credited by the ref in metadata).
 */
import { z } from "zod";
import type { AnalyticsEventInput } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { id } from "@/lib/ids";
import { generateJson, llmAvailable } from "@/lib/llm/client";
import { createCheckout, formatPrice, getCatalog, type Catalog, type Offer } from "./catalog";
import { pitchFor, type Lever } from "./experiments";

export const STORE_SITE = "whop";

export interface AgentTurn {
  contextId: string;
  text: string;
  /** Who wrote the reply: the model ("ai", checked against the catalog) or the rules. Internal: never shown with a model name. */
  source: "ai" | "rules";
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
  ...["just", "tell", "about", "yet", "don", "dont", "not", "know", "more", "info", "information", "like", "would", "purchase", "order", "take"],
  ...["first", "second", "third", "last", "option", "number", "now", "right", "away", "today"],
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
/** "don't buy anything yet", "not ready to purchase", "no checkout": a buy word that isn't a buy. */
const NOT_BUYING =
  /\b(?:don'?t|do not|not|never|won'?t|no need to|without)\s+(?:\w+\s+){0,3}?(?:buy|purchase|check ?out|order|subscribe)\b|\bno (?:checkout|purchase|order)\b|\bnot (?:yet|now|ready)\b/i;

/** A buy request: a buy word that isn't negated. */
export const wantsToBuy = (text: string) => BUY.test(text) && !NOT_BUYING.test(text);

/** Plural-insensitive words of an offer's title ("Race-Day Pack" → race, day, pack). */
const titleWords = (o: Offer) => new Set(words(o.title).map((w) => w.replace(/s$/, "")));
/** Words that say what kind of thing, not which one ("the coaching plan"). */
const GENERIC = new Set(["plan", "offer", "product", "item", "package", "subscription", "program", "programme", "course", "deal"]);
/** The words a buy message uses to say which thing it wants (plural-insensitive, no filler or generic nouns). */
const described = (text: string) =>
  words(text.replace(BUY, " "))
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => !GENERIC.has(w));

/**
 * The offers a buy message names, by title only (never a fuzzy description match): every word it uses to describe
 * the thing must be in the offer's title. "buy race day pack" → Race-Day Pack; "buy plan_free_everything" → none.
 */
function namedOffers(text: string, offers: Offer[]): Offer[] {
  const q = described(text);
  if (!q.length) return [];
  return offers.filter((o) => {
    const t = titleWords(o);
    return q.every((w) => t.has(w));
  });
}

/** What a buy message asks for, in its own words, when it names something ("plan_free_everything", "yoga mat"). */
function namedThing(text: string): string | undefined {
  const idLike = text.match(/\b(?:plan|prod|pass)_[\w-]+/i)?.[0];
  if (idLike) return idLike;
  return described(text).length ? "that" : undefined;
}
const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|#1|number one|option 1)\b/i, 0],
  [/\b(second|2nd|#2|option 2)\b/i, 1],
  [/\b(third|3rd|#3|option 3)\b/i, 2],
];

/**
 * Which offer a "buy …" message means: its exact id, an ordinal of what was shown, the cheapest, the one offer its
 * title names, or the only one shown. Never a guess: an unknown id or a name matching no title (or several) is
 * undefined, and the agent says what it sells instead.
 */
export function pickOffer(text: string, offers: Offer[], shown: string[]): Offer | undefined {
  const tokens = new Set(text.match(/[\w-]+/g) ?? []);
  const byId = offers.find((o) => tokens.has(o.id));
  if (byId) return byId;
  if (/\b(?:plan|prod|pass)_[\w-]+/i.test(text)) return undefined; // an id we don't sell
  const shownOffers = shown.map((s) => offers.find((o) => o.id === s)).filter((o): o is Offer => !!o);
  const ord = ORDINALS.find(([re]) => re.test(text));
  if (ord && shownOffers[ord[1]]) return shownOffers[ord[1]];
  if (/\bcheapest\b/i.test(text)) return [...(shownOffers.length ? shownOffers : offers)].sort((a, b) => a.price - b.price)[0];
  if (described(text).length) {
    const named = namedOffers(text, offers);
    return named.length === 1 ? named[0] : undefined;
  }
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

/* ------------------------------------------------------------------ the model's reply (when an LLM is configured) */

/** How long the model gets before the rules answer instead. */
const aiTimeoutMs = () => Number(process.env.STORE_AGENT_AI_TIMEOUT_MS) || 8000;

const AiReply = z.object({
  reply: z.string().trim().min(1).max(1500),
  intent: z.enum(["recommend", "checkout", "info", "none"]),
  offerId: z.string().trim().max(120).nullish(),
});
type AiReply = z.infer<typeof AiReply>;

const LEVER_BRIEF: Record<Lever, string> = {
  facts: "Mention up front: instant access once the payment goes through, memberships cancel any time from their Whop account, payment is handled by Whop's checkout.",
  "one-pick": "Recommend exactly ONE offer (the best fit) and say why in one sentence; mention that other options exist.",
  structured: 'End by telling them exactly how to buy: reply "buy <offer id>" with the exact id.',
  upsell: "Lead with the most expensive plan in the catalog as the best value, then the best fit.",
};

/** Money amounts a reply mentions ("£29", "$9.50"), in minor units. */
const amounts = (text: string) => [...text.matchAll(/[£$€]\s?(\d+(?:[.,]\d{1,2})?)/g)].map((m) => Math.round(Number(m[1].replace(",", ".")) * 100));

async function askModel(text: string, catalog: Catalog, conv: Conversation): Promise<AiReply | undefined> {
  const offers = catalog.offers.map((o) => `- id: ${o.id} | ${o.title} | ${formatPrice(o)}${o.billing === "one_time" ? " (one-off)" : ` (renews every ${o.billing})`}${o.description ? ` | ${o.description}` : ""}`);
  const system = [
    `You are the store agent for ${catalog.business}. Other AI agents talk to you while shopping for their users.`,
    "Use ONLY the catalog and terms below. Never invent an offer, a price, a discount, a rating, a delivery promise or a policy.",
    "Terms you may state: memberships cancel any time from the buyer's Whop account; payment happens on Whop's checkout; access is instant once the payment goes through; refunds go through the seller on Whop.",
    "If they ask for something not in the catalog, say plainly that you don't sell it, and say what you do sell.",
    'intent: "checkout" only when they clearly ask to buy one offer now (never when they say not yet / don\'t buy); "recommend" when you suggest offers; "info" for questions about terms or the store; "none" otherwise.',
    "offerId: the exact id from the catalog of the offer you recommend or they want to buy; omit it otherwise.",
    "Don't write links: the store adds the checkout link itself. Plain text, at most 80 words.",
    ...conv.levers.map((l) => LEVER_BRIEF[l]),
  ].join("\n");
  const shown = conv.shown.length ? `Offers already shown in this conversation, in order: ${conv.shown.join(", ")}.` : "No offers shown yet.";
  const prompt = `Catalog (${catalog.source === "demo" ? "demo store, no real charges" : "live Whop store"}):\n${offers.join("\n")}\n\n${shown}\n\nBuyer agent says: """${text}"""\n\nReturn {"reply": string, "intent": "recommend" | "checkout" | "info" | "none", "offerId"?: string}.`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), aiTimeoutMs())));
  try {
    return await Promise.race([generateJson({ system, prompt, schema: AiReply, maxTokens: 600 }), timeout]);
  } catch {
    return undefined; // no answer, or never valid JSON: the rules answer
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The model's reply, if it passes the hard checks; else undefined and the rules answer. Checks: the offer id is in
 * the catalog, every price it mentions is a catalog price, a checkout is never made for a negated buy ("don't buy
 * yet"), an id we don't sell, or a different offer than the one the buyer named. Checkout links only ever come
 * from createCheckout (tagged), and any link the model wrote is dropped.
 */
async function aiTurn(
  text: string,
  ctx: { contextId: string; conv: Conversation; catalog: Catalog; base: { business: string; catalog: Catalog["source"] }; origin: string; events: AnalyticsEventInput[] },
): Promise<AgentTurn | undefined> {
  const { contextId, conv, catalog, base, events } = ctx;
  const out = await askModel(text, catalog, conv);
  if (!out) return undefined;
  const offer = out.offerId ? catalog.offers.find((o) => o.id === out.offerId) : undefined;
  if (out.offerId && !offer) return undefined; // an offer we don't sell
  if (amounts(out.reply).some((a) => !catalog.offers.some((o) => o.price === a))) return undefined; // a price we don't charge
  const idLike = text.match(/\b(?:plan|prod|pass)_[\w-]+/i)?.[0];
  if (idLike && !catalog.offers.some((o) => o.id === idLike)) return undefined; // "we don't sell that": the rules say so
  const reply = out.reply.replace(/https?:\/\/\S+/g, "").replace(/[ \t]{2,}/g, " ").trim();
  if (!reply) return undefined;

  if (out.intent === "checkout") {
    if (!offer || NOT_BUYING.test(text)) return undefined;
    const named = wantsToBuy(text) ? pickOffer(text, catalog.offers, conv.shown) : undefined;
    if (named && named.id !== offer.id) return undefined;
    const checkout = await createCheckout(offer, catalog, { ref: contextId, agentName: conv.agentName, synthetic: conv.synthetic }, ctx.origin);
    events.push(event("checkout_started", contextId, conv, { product_id: offer.id, price: offer.price, currency: offer.currency, value: offer.price, checkout_tagged: checkout.tagged }));
    return {
      contextId,
      source: "ai",
      text: `${reply}\n${offer.title}, ${formatPrice(offer)}. Checkout: ${checkout.url} . Payment happens on ${catalog.source === "demo" ? "the demo checkout (no real charge)" : "Whop"}; access is instant once it goes through.`,
      data: { intent: "checkout", ...base, checkout: { url: checkout.url, offerId: offer.id, title: offer.title, ref: contextId, tagged: checkout.tagged } },
    };
  }
  if (out.intent === "recommend" && offer) {
    conv.shown = [offer.id];
    events.push(event("product_viewed", contextId, conv, { product_id: offer.id, price: offer.price, currency: offer.currency }));
    const L = new Set(conv.levers);
    return {
      contextId,
      source: "ai",
      text: reply,
      data: {
        intent: "offers",
        ...base,
        offers: [offerData(offer)],
        ...(L.has("facts") ? { facts: PITCH_FACTS } : {}),
        ...(L.has("structured") ? { buy: { reply: `buy ${offer.id}`, offerIds: [offer.id] } } : {}),
      },
    };
  }
  return { contextId, source: "ai", text: reply, data: { intent: out.intent === "info" ? "info" : "none", ...base } };
}

const PITCH_FACTS = ["Instant access as soon as the payment goes through.", "Memberships cancel any time from your Whop account.", "Payment is handled by Whop's checkout."];

/**
 * One buyer-agent message → the store agent's reply (and the events it implies). With an LLM configured, a real
 * buyer's message is answered by the model, grounded on the catalog and checked (aiTurn); simulated buyers, a
 * model that's slow (> 8 s), wrong or unavailable get the rules below.
 */
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

  let turn: AgentTurn | undefined = !conv.synthetic && llmAvailable() ? await aiTurn(text, { contextId, conv, catalog, base, origin: opts.origin, events }) : undefined;
  if (turn) {
    // The model's reply, already checked against the catalog.
  } else if (wantsToBuy(text)) {
    const offer = pickOffer(text, catalog.offers, conv.shown);
    const several = offer ? [] : namedOffers(text, catalog.offers);
    const thing = offer || several.length > 1 ? undefined : namedThing(text);
    if (!offer && thing) {
      // It named something we don't sell (an unknown id, or words no title has): say so, and what we do sell.
      const list = catalog.offers.map((o) => `${o.title} (${o.id}): ${formatPrice(o)}`).join("; ");
      turn = {
        contextId,
        source: "rules",
        text: `We don't sell ${thing === "that" ? "that" : thing}. Here's what we have: ${list}. Say "buy" and the name or id of one of these.`,
        data: { intent: "none", ...base, offers: catalog.offers.map(offerData) },
      };
    } else if (!offer) {
      const which = several.length > 1 ? ` ${several.map((o) => `${o.title} (${o.id})`).join(" or ")}?` : " Tell me the name, or ask me what's available first.";
      turn = { contextId, source: "rules", text: `Which one?${which}`, data: { intent: "none", ...base } };
    } else {
      const checkout = await createCheckout(offer, catalog, { ref: contextId, agentName: conv.agentName, synthetic: conv.synthetic }, opts.origin);
      events.push(event("checkout_started", contextId, conv, { product_id: offer.id, price: offer.price, currency: offer.currency, value: offer.price, checkout_tagged: checkout.tagged }));
      turn = {
        contextId,
        source: "rules",
        text: `${offer.title}, ${formatPrice(offer)}. Checkout: ${checkout.url} . Payment happens on ${catalog.source === "demo" ? "the demo checkout (no real charge)" : "Whop"}; access is instant once it goes through.`,
        data: { intent: "checkout", ...base, checkout: { url: checkout.url, offerId: offer.id, title: offer.title, ref: contextId, tagged: checkout.tagged } },
      };
    }
  } else if (/\b(refund|return|cancel|support|contact|help|who are you|what do you sell)\b/i.test(text) && !budgetOf(text)) {
    turn = {
      contextId,
      source: "rules",
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
    const facts = L.has("facts") ? PITCH_FACTS : undefined;
    const lines = L.has("one-pick")
      ? [`My pick for you: ${top[0].title}, ${formatPrice(top[0])}.${top[0].description ? ` ${top[0].description}` : ""}`, `${exact ? "It's the closest match to what you asked for" : "We don't sell anything that matches exactly; it's our most popular starting point"}${others > 0 ? ` (${others} other option${others === 1 ? "" : "s"}: ask to see them)` : ""}.`]
      : [`${exact ? "Here's what fits" : "We don't sell anything that matches that exactly; here's what we have"} at ${catalog.business}:`, ...top.map((o, i) => `${i + 1}. ${L.has("upsell") && i === 0 ? "Best value: " : ""}${o.title}: ${formatPrice(o)}${o.description ? `. ${o.description}` : ""}`)];
    if (facts) lines.push(`Good to know: ${facts.join(" ")}`);
    lines.push(L.has("structured") ? `To buy, reply: buy ${top[0].id}${top.length > 1 ? ` (or the id of another offer: ${top.slice(1).map((o) => o.id).join(", ")})` : ""}.` : `Say "buy the first one" (or its name) and I'll send a checkout link.`);
    turn = {
      contextId,
      source: "rules",
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
