/**
 * Darwin never invents facts about a merchant, and never publishes them.
 *
 * Copy Darwin writes (playbook, autopilot, the prompt parser, the LLM) may only use:
 *   (a) what the page already says, word for word (outline.ts),
 *   (b) the visitor's own context ({query}, where they came from),
 *   (c) neutral words that state nothing about the store ("Welcome back").
 * Anything else that sounds like a fact (a rating, a review or customer count, an award, a delivery
 * promise, a returns policy, a warranty, a discount, a stock level) is a claim. A claim that isn't on the
 * page is wrapped as "[Confirm: …]", and text only the merchant knows is a "[Your …]" placeholder:
 * either one keeps a rule from going live (store.ts) until the merchant edits it, and autopilot skips it.
 */
import type { PageElement, WebChange, WebRuleDraft } from "@/lib/contracts";

/* ------------------------------------------------------------------ placeholders */

/** Text only the merchant can supply. A rule with one of these can't go live. */
export const NEEDS = {
  delivery: "[Your delivery and returns terms]",
  returns: "[Your returns or warranty terms]",
  reviews: "[Your rating and number of reviews]",
  offer: "[Your ad's offer]",
  headline: "[Your headline for these visitors]",
  button: "[Your button text]",
} as const;

/** "[Your …]" or "[Confirm: …]": waiting for the merchant. */
export const PLACEHOLDER = /\[(?:your|confirm)\b[^\]]*\]?/i;

export function needsMerchant(value: string | undefined): boolean {
  return !!value && PLACEHOLDER.test(value);
}

const MAX_VALUE = 200;

/** A claim Darwin couldn't find on the page, handed to the merchant to confirm (or edit) before it can go live. */
export function confirmText(value: string): string {
  const inner = value.length > MAX_VALUE - 12 ? `${value.slice(0, MAX_VALUE - 13).trimEnd()}…` : value;
  return `[Confirm: ${inner}]`;
}

/* ------------------------------------------------------------------ claims */

const COUNT_NOUN =
  "customers|clients|reviews|ratings|orders|sold|buyers|runners|riders|athletes|users|shoppers|members|subscribers|people|fans|sales|households|families|installs|downloads";

/** Phrases that state a fact about the store. Each is matched on its own, case-insensitively. */
const CLAIM_PATTERNS: RegExp[] = [
  // Star ratings: "★ 4.8/5", "4.8★", "★★★★★".
  /[★⭐]+\s*\d(?:[.,]\d{1,2})?(?:\s*(?:\/|out of)\s*5)?|\d(?:[.,]\d{1,2})?\s*(?:\/\s*5\s*)?[★⭐]+|[★⭐]+/gu,
  // "4.8/5", "4.8 out of 5", "5 stars".
  /\b\d(?:[.,]\d{1,2})?\s*(?:\/\s*5|out of (?:5|five)|stars?)\b/gi,
  // "Rated 4.8", "rating of 4.9/5".
  /\b(?:rated|ratings?(?: of)?|scored?)\s+\d(?:[.,]\d{1,2})?(?:\s*(?:\/|out of)\s*(?:5|10|five))?/gi,
  // "2,000+ customers", "12k happy runners", "1,284 reviews".
  new RegExp(`\\b\\d[\\d,.]*\\s*[km]?\\+?\\s+(?:(?:happy|satisfied|verified|loyal|five-star|5-star|real|trusted|repeat)\\s+)?(?:${COUNT_NOUN})\\b`, "gi"),
  /\b(?:thousands|millions|hundreds|tens of thousands) of (?:happy |satisfied )?(?:customers|runners|users|shoppers|people|fans|buyers)\b/gi,
  // "Free UK delivery over £60", "free 60-day returns", "free delivery on your first order".
  /\bfree\s+(?:[\w£$€%-]+\s+){0,3}?(?:returns?|shipping|delivery|exchanges?|postage|p&p)\b(?:\s+(?:on|over|above|for|when you spend)\s+(?:orders?\s+)?(?:over\s+|above\s+)?[£$€]?\s?\d[\d,.]*|\s+on\s+(?:your|all|every)\s+(?:first\s+)?orders?)?/gi,
  // "60-day returns", "2-year warranty", "30 day money-back guarantee", "100-night trial".
  /\b\d+[-\s]?(?:days?|nights?|weeks?|months?|years?|yrs?)\s+(?:free\s+)?(?:returns?|refunds?|exchanges?|money[-\s]back(?:\s+guarantee)?|warrant(?:y|ies)|guarantee|trial)\b/gi,
  /\b(?:easy|hassle[-\s]free|no[-\s]quibble|no[-\s]questions[-\s]asked)\s+returns?\b/gi,
  // Discounts: "10% off your first order", "save £20", "20% discount", "promo code".
  /\b\d+\s?%\s*off\b(?:\s+(?:your\s+)?(?:first|next)\s+(?:order|purchase|box|pair))?/gi,
  /\b(?:save|get)\s+(?:up to\s+)?(?:[£$€]\s?\d[\d,.]*|\d+\s?%)/gi,
  /\b\d+\s?%\s*(?:discount|cheaper|less)\b|\bdiscount(?:s|ed)?\b|\b(?:coupon|promo)\s+codes?\b|\bbuy one,? get one\b|\bbogo\b|\bhalf[-\s]price\b|\bon sale\b/gi,
  // Delivery promises: "ships today", "dispatched within 24 hours", "next-day delivery".
  /\b(?:ships?|shipped|shipping|dispatch(?:es|ed)?|deliver(?:s|ed|y)?|arrives?)\s+(?:(?:in|within)\s+\d+(?:\s*[-–]\s*\d+)?\s*(?:h|hrs?|hours?|days?|working days?|business days?)|today|tomorrow|same[-\s]day|next[-\s]day|overnight|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|christmas|tomorrow))\b/gi,
  /\b(?:same|next)[-\s]day\s+(?:delivery|shipping|dispatch)\b|\bexpress\s+(?:delivery|shipping)\b|\b(?:fast|quick|speedy|rapid)\s+(?:delivery|shipping|dispatch)\b/gi,
  // Stock levels.
  /\b(?:in stock|out of stock|only \d+ left|\d+ left(?: in stock)?|low stock|selling fast|almost gone|sold out|back in stock|limited stock|few left|going fast)\b/gi,
  // Guarantees and warranties: "lifetime guarantee", "2-year warranty".
  /\b(?:[\w-]+\s+)?(?:guarantee[ds]?|warrant(?:y|ies|ied))\b/gi,
  // Awards and rankings.
  /\b(?:award[-\s]winning|awards?|winner of|voted\s+(?:#\s?1|best|number one)|best[-\s]?sell(?:er|ers|ing)|number one|top[-\s]rated|best[-\s]rated|highest[-\s]rated|most popular)\b|#\s?1\b|\bno\.\s?1\b/gi,
  /\bas seen (?:in|on)\b[^.·,;!?|]{0,40}/gi,
  // Endorsements and popularity: "Loved by 2,000+ customers", "Recommended by runners you trust".
  /\b(?:loved|trusted|recommended|used|worn|chosen|approved|endorsed)\s+by\s+[^.·,;!?|]{2,40}/gi,
  /\beveryone(?:'s|’s| is)\s+(?:talking about|buying|loving|wearing)\b/gi,
];

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The fact-like phrases in a piece of copy ("★ 4.8/5", "2,000+ customers", "free 60-day returns", "10% off"). */
export function findClaims(text: string | undefined): string[] {
  if (!text) return [];
  const out = new Map<string, string>();
  for (const re of CLAIM_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const claim = m[0].trim();
      if (claim) out.set(norm(claim), claim);
    }
  }
  return [...out.values()];
}

/** Outline texts are cut at 80 characters (ending "…"): drop the last segment, it may be half a claim. */
function complete(text: string): string {
  if (!text.endsWith("…")) return text;
  const cut = Math.max(text.lastIndexOf(" · "), text.lastIndexOf(". "), text.lastIndexOf(" | "));
  return cut > 0 ? text.slice(0, cut + (text[cut] === "." ? 1 : 0)) : "";
}

/** What the page says: its elements' texts (complete ones only). */
export function pageTexts(outline: readonly PageElement[]): string[] {
  return outline.map((e) => complete(e.text)).filter(Boolean);
}

/**
 * Claims in `text` that the page doesn't make, word for word. A claim counts as the page's own only when
 * the page contains that same claim (so "Free UK delivery" doesn't pass for a page that says
 * "Free UK delivery over £60").
 */
export function unverifiedClaims(text: string | undefined, sources: readonly string[]): string[] {
  const claims = findClaims(text);
  if (!claims.length) return [];
  const onPage = new Set(sources.flatMap((s) => findClaims(s).map(norm)));
  return claims.filter((c) => !onPage.has(norm(c)));
}

/* ------------------------------------------------------------------ the page's own statements */

/** Short statements the page makes, split out of its elements' text ("Free 60-day returns"). */
export function pageStatements(outline: readonly PageElement[]): string[] {
  const out = new Map<string, string>();
  for (const text of pageTexts(outline)) {
    for (const part of text.split(/\s+·\s+|\s+\|\s+|(?<=[.!?])\s+/)) {
      const s = part.trim().replace(/[.;,]+$/, "");
      if (s.length >= 3 && s.length <= 90 && !out.has(norm(s))) out.set(norm(s), s);
    }
  }
  return [...out.values()];
}

const TOPICS = {
  /** What an AI shopper checks: delivery, dispatch, returns. */
  delivery: /deliver|shipping|\bships?\b|dispatch|postage|\breturns?\b|refund|exchange/i,
  returns: /\breturns?\b|refund|exchange|warrant|guarantee|money[-\s]back/i,
  reviews: /[★⭐]|review|\brated\b|rating|\bstars?\b|customers|trustpilot/i,
  offer: /%\s*off|discount|\bsave\b|\bcode\b|free (?:delivery|shipping)|\boffer\b|\bsale\b/i,
} as const;
export type FactTopic = keyof typeof TOPICS;

/**
 * The page's own statements on a topic that state a fact, joined with " · " (at most `max`, ≤ 90 chars),
 * verbatim. Undefined when the page says nothing about it: then only the merchant can fill it in.
 */
export function pageFacts(outline: readonly PageElement[], topic: FactTopic, max = 1): string | undefined {
  const picked: string[] = [];
  for (const s of pageStatements(outline)) {
    if (picked.length >= max) break;
    if (!TOPICS[topic].test(s) || !findClaims(s).length) continue;
    if ([...picked, s].join(" · ").length > 90) break;
    picked.push(s);
  }
  return picked.length ? picked.join(" · ") : undefined;
}

/* ------------------------------------------------------------------ guarding drafts */

/**
 * Make a draft's copy honest against the page: every value with a claim the page doesn't make is wrapped
 * as "[Confirm: …]" for the merchant. Returns the claims it couldn't find.
 */
export function guardChanges(changes: WebChange[], sources: readonly string[]): { changes: WebChange[]; unverified: string[] } {
  const unverified: string[] = [];
  const out = changes.map((c) => {
    if (!c.value || c.action === "style" || needsMerchant(c.value)) return c;
    const missing = unverifiedClaims(c.value, sources);
    if (!missing.length) return c;
    unverified.push(...missing);
    return { ...c, value: confirmText(c.value) };
  });
  return { changes: out, unverified: [...new Set(unverified)] };
}

/** Text the merchant must fill in or confirm before this draft can go live. */
export function draftNeedsMerchant(draft: Pick<WebRuleDraft, "changes">): boolean {
  return draft.changes.some((c) => needsMerchant(c.value));
}

/** A text in a rule that states something the page doesn't: the text, and the claims in it the page doesn't make. */
export interface UnbackedText {
  value: string;
  claims: string[];
}

/** The texts in these changes with a claim the page doesn't make, word for word (style changes state nothing). */
export function unbackedTexts(changes: readonly WebChange[], outline: readonly PageElement[]): UnbackedText[] {
  const sources = pageTexts(outline);
  return changes.flatMap((c) => {
    if (c.action === "style" || !c.value || needsMerchant(c.value)) return [];
    const claims = unverifiedClaims(c.value, sources);
    return claims.length ? [{ value: c.value, claims }] : [];
  });
}

/** Autopilot may start (or keep live) this copy on its own: nothing to fill in, and every claim is on the page. */
export function readyToPublish(draft: Pick<WebRuleDraft, "changes">, outline: readonly PageElement[]): boolean {
  if (draftNeedsMerchant(draft)) return false;
  const sources = pageTexts(outline);
  return draft.changes.every((c) => c.action === "style" || !unverifiedClaims(c.value, sources).length);
}

/** A short note for a draft's hypothesis saying what the merchant has to do before it can go live. */
export function merchantNote(unverified: readonly string[], placeholders: boolean): string {
  if (unverified.length) {
    const list = unverified
      .slice(0, 3)
      .map((c) => `“${c}”`)
      .join(", ");
    return ` Confirm first: Darwin couldn't find ${list} on your page, so it won't publish it until you edit the [Confirm: …] text.`;
  }
  return placeholders ? " Needs your details: fill in the [bracketed] text with your real terms before it can go live." : "";
}
