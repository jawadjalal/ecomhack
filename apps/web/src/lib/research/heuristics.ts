/**
 * Keyword heuristics over Tavily results: used when there's no LLM key, and to ground the LLM's
 * output in facts we extracted ourselves (llms.txt presence, prices).
 */
import type {
  ResearchClaim,
  ResearchCompetitor,
  ResearchSuggestion,
} from "@/lib/contracts";
import type { TavilyResult } from "./tavily";

/** Social, forums and encyclopedias: useful sources, but not competitors. */
const NOT_COMPETITORS = [
  "reddit.com",
  "youtube.com",
  "wikipedia.org",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "medium.com",
  "trustpilot.com",
  "google.com",
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** "Stride Running | Shoes & Kit" at stride.co.uk → "Stride Running". */
export function brandName(title: string, url: string): string {
  const head = title.split(/\s[|\-–—:]\s/)[0]?.trim();
  if (head && head.length >= 2 && head.length <= 40) return head;
  const d = domainOf(url).split(".")[0] ?? url;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Up to `max` distinct competitor domains from search results, skipping the merchant's own site. */
export function pickCompetitors(
  results: TavilyResult[],
  opts: { exclude?: string; max?: number } = {},
): TavilyResult[] {
  const own = opts.exclude ? domainOf(opts.exclude) : "";
  const seen = new Set<string>();
  const out: TavilyResult[] = [];
  for (const r of results) {
    const d = domainOf(r.url);
    if (!d || seen.has(d) || (own && d === own)) continue;
    if (NOT_COMPETITORS.some((n) => d === n || d.endsWith(`.${n}`))) continue;
    seen.add(d);
    out.push(r);
    if (out.length >= (opts.max ?? 5)) break;
  }
  return out;
}

export function priceRange(text: string): string | undefined {
  const found: { cur: string; v: number }[] = [];
  for (const m of text.matchAll(
    /([£$€])\s?(\d{1,4}(?:,\d{3})?(?:\.\d{2})?)/g,
  )) {
    // "free delivery over £50" is a threshold, not a product price.
    if (
      /(?:over|above|spend|orders of|off)\s*$/i.test(
        text.slice(Math.max(0, (m.index ?? 0) - 14), m.index),
      )
    )
      continue;
    const v = Number(m[2].replace(/,/g, ""));
    if (v >= 1 && v <= 5000) found.push({ cur: m[1], v });
  }
  if (!found.length) return undefined;
  const cur = found[0].cur;
  const vals = found.filter((f) => f.cur === cur).map((f) => f.v);
  const fmt = (n: number) => `${cur}${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}

function sentence(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[0].replace(/\s+/g, " ").trim().slice(0, 140) : undefined;
}

export const shippingOffer = (t: string) =>
  sentence(
    t,
    /[^.\n]{0,50}\bfree (?:standard |uk |us |next[- ]day )?(?:shipping|delivery)[^.\n]{0,60}/i,
  ) ??
  sentence(
    t,
    /[^.\n]{0,30}\b(?:next[- ]day|same[- ]day|express) (?:shipping|delivery)[^.\n]{0,50}/i,
  );

export const returnsOffer = (t: string) =>
  sentence(
    t,
    /[^.\n]{0,40}\b\d{1,3}[- ]days? (?:free )?returns?[^.\n]{0,40}/i,
  ) ?? sentence(t, /[^.\n]{0,40}\bfree returns?[^.\n]{0,40}/i);

const TACTICS: [RegExp, string][] = [
  [
    /free (?:shipping|delivery) (?:on orders )?over/i,
    "Free-shipping threshold",
  ],
  [/\bsubscribe|subscription\b/i, "Subscription / membership"],
  [/\bbundle|buy \d+ get|multi-?buy/i, "Bundles and multibuys"],
  [
    /\b\d{1,2}% off|\bsale\b|discount code|promo code/i,
    "Discounts and promo codes",
  ],
  [/\breviews?\b|\bstars?\b|rated/i, "Social proof (reviews/ratings)"],
  [/klarna|clearpay|afterpay|pay in 3|pay later/i, "Buy now, pay later"],
  [/gait analysis|fit finder|size guide|quiz/i, "Fit / size guidance"],
  [/price match/i, "Price match"],
  [/loyalty|rewards|points/i, "Loyalty rewards"],
];

export function tacticsIn(text: string): string[] {
  return TACTICS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

export function agentNotes(text: string, llmsTxt: boolean | null): string[] {
  const notes: string[] = [];
  if (llmsTxt === true) notes.push("Publishes /llms.txt for AI agents");
  if (llmsTxt === false) notes.push("No /llms.txt found");
  if (
    /chatgpt|ai (?:shopping )?assistant|agentic|model context protocol|\bmcp\b/i.test(
      text,
    )
  )
    notes.push("Mentions AI assistants / agents");
  return notes;
}

/** Build a competitor card from its search hit plus the page text we extracted. */
export function heuristicCompetitor(
  hit: TavilyResult,
  pageText: string,
  llmsTxt: boolean | null,
): ResearchCompetitor {
  const text = `${hit.content}\n${pageText}`;
  const shipping = shippingOffer(text);
  const returns = returnsOffer(text);
  const tactics = tacticsIn(text);
  const strengths = [
    shipping && "Clear delivery offer",
    returns && "Stated returns policy",
    tactics.includes("Social proof (reviews/ratings)") &&
      "Uses reviews as proof",
  ].filter(Boolean) as string[];
  const weaknesses = [
    !shipping && "No delivery offer found on the page",
    !returns && "Returns policy not visible",
    llmsTxt === false && "Not set up for AI agents (no llms.txt)",
  ].filter(Boolean) as string[];
  return {
    name: brandName(hit.title, hit.url),
    url: originOf(hit.url),
    priceRange: priceRange(text),
    positioning:
      hit.content.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) || undefined,
    shipping,
    returns,
    strengths,
    weaknesses,
    tactics,
    agentReadiness: { llmsTxt, notes: agentNotes(text, llmsTxt) },
    sources: [hit.url],
  };
}

/** First sentence of each result as a sourced trend line. */
export function heuristicTrends(
  results: TavilyResult[],
  max = 4,
): ResearchClaim[] {
  return results
    .filter((r) => r.content.trim().length > 40)
    .slice(0, max)
    .map((r) => ({
      text: (r.content.split(/(?<=[.!?])\s/)[0] ?? r.content)
        .replace(/\s+/g, " ")
        .slice(0, 220),
      sources: [r.url],
    }));
}

/** Test ideas driven by what competitors do that a store could copy (or beat). */
export function heuristicSuggestions(
  competitors: ResearchCompetitor[],
): ResearchSuggestion[] {
  const out: ResearchSuggestion[] = [];
  const src = (pred: (c: ResearchCompetitor) => boolean) =>
    competitors
      .filter(pred)
      .map((c) => c.sources[0])
      .slice(0, 3);
  const withShip = src((c) => Boolean(c.shipping));
  if (withShip.length) {
    out.push({
      title: "Show the delivery offer before the bag",
      why: `${withShip.length} of ${competitors.length} competitors lead with a delivery offer.`,
      testIdea:
        "Show a free delivery banner with the threshold and delivery date above the add to cart button",
      audience: "both",
      sources: withShip,
    });
  }
  const withReturns = src((c) => Boolean(c.returns));
  if (withReturns.length) {
    out.push({
      title: "Put the returns promise next to the price",
      why: `${withReturns.length} competitor${withReturns.length > 1 ? "s state" : " states"} a returns policy up front.`,
      testIdea: "Add a line under the price: free 30-day returns",
      audience: "humans",
      sources: withReturns,
    });
  }
  const proof = src((c) =>
    c.tactics.includes("Social proof (reviews/ratings)"),
  );
  if (proof.length) {
    out.push({
      title: "Lead with ratings on product pages",
      why: "Competitors use reviews and star ratings as proof.",
      testIdea:
        "Change the product headline to include the average star rating and review count",
      audience: "humans",
      sources: proof,
    });
  }
  const noAgents = competitors.filter(
    (c) => c.agentReadiness.llmsTxt === false,
  );
  if (noAgents.length) {
    out.push({
      title: "Win the AI shoppers competitors ignore",
      why: `${noAgents.length} competitor${noAgents.length > 1 ? "s have" : " has"} no llms.txt, so agents see less of them.`,
      testIdea:
        "For AI agent visitors, show price, stock and delivery date as plain text at the top of the product page",
      audience: "agents",
      sources: noAgents.map((c) => c.sources[0]).slice(0, 3),
    });
  }
  const bnpl = src((c) => c.tactics.includes("Buy now, pay later"));
  if (bnpl.length) {
    out.push({
      title: "Mention pay-later near the price",
      why: "Competitors reduce price shock with instalments.",
      testIdea: "Add 'or 3 interest-free payments' under the price",
      audience: "humans",
      sources: bnpl,
    });
  }
  return out.slice(0, 5);
}
