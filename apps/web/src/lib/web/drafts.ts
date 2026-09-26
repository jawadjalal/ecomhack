/**
 * Turning "people from ChatGPT should see our delivery and returns up front" into a rule.
 *
 * - draftRule(): the LLM writes it, grounded in the page's real elements (outline.ts); if there's
 *   no LLM, or its answer doesn't validate, a keyword parser does (so the demo runs with no keys).
 * - suggestRules(): the playbook, one idea per traffic source, ordered by where the site's own data
 *   says conversion lags most.
 * Drafts are never saved here: the merchant reviews and edits them first.
 *
 * Darwin never invents facts about the store (claims.ts): copy it writes is the page's own words, the
 * visitor's search, or neutral text. A fact only the merchant knows is a "[Your …]" placeholder, and a
 * claim the page doesn't make is marked "[Confirm: …]"; neither can go live until the merchant edits it.
 */
import { z } from "zod";
import type { PageElement, TrafficSource, WebChange, WebDraftResponse, WebRuleDraft, WebSiteOverview } from "@/lib/contracts";
import { TRAFFIC_SOURCES, TRAFFIC_SOURCE_LABEL } from "@/lib/contracts";
import { generateJson, llmAvailable, llmLabel } from "@/lib/llm/client";
import { draftNeedsMerchant, guardChanges, merchantNote, NEEDS, pageFacts, pageTexts } from "./claims";
import { pageOutline } from "./outline";
import { WebRuleDraftSchema } from "./store";

/* ------------------------------------------------------------------ selectors */

const FALLBACK = {
  headline: "h1",
  sub: "h1 + p",
  button: '.add-to-cart, button[name="add"], form[action*="/cart/add"] [type="submit"]',
  popup: '.promo-popup, [class*="newsletter-popup"], [class*="popup"]',
};

type Target = keyof typeof FALLBACK;

/** The page's own element for a target, when the outline has one. */
export function pickSelector(target: Target, outline: PageElement[]): string {
  const find = (fn: (e: PageElement) => boolean) => outline.find(fn)?.selector;
  switch (target) {
    case "headline":
      return find((e) => e.tag === "h1") ?? FALLBACK.headline;
    case "sub":
      return find((e) => /sub|tagline|lede|lead/i.test(e.selector) && e.tag !== "h1") ?? FALLBACK.sub;
    case "button": {
      // The product's own buy button beats a header "Checkout" link.
      const clickable = (re: RegExp) => find((e) => ["button", "a", "input"].includes(e.tag) && (re.test(e.text) || re.test(e.selector)));
      return clickable(/add[ -]to[ -]?(cart|bag|basket)/i) ?? clickable(/\bbuy\b|shop now|order now/i) ?? FALLBACK.button;
    }
    case "popup":
      return find((e) => /popup|modal|newsletter/i.test(e.selector)) ?? FALLBACK.popup;
  }
}

/* ------------------------------------------------------------------ heuristic parser */

const SOURCE_WORDS: [TrafficSource, RegExp][] = [
  ["paid", /\b(paid|ads?|adverts?|advertising|cpc|ppc|campaigns?|sponsored)\b/],
  ["ai", /\b(ai|chat ?gpt|gpt|openai|perplexity|claude|gemini|copilot|llms?|assistants?|chatbots?|answer engines?)\b/],
  ["email", /\b(e-?mails?|newsletters?|klaviyo|mailchimp|subscribers?)\b/],
  ["search", /\b(google|search(es|ed|ing)?|seo|bing|organic)\b/],
  ["social", /\b(social|instagram|insta|tiktok|facebook|twitter|x\.com|reddit|pinterest|youtube|linkedin|influencers?)\b/],
  ["referral", /\b(referrals?|blogs?|other (web)?sites|partners?|affiliates?)\b/],
  ["direct", /\b(direct|typed (in|the url))\b/],
];

type Copy = { banner: string; badge: string; headline: string; button: string };

/** Neutral copy: says something about the visitor's visit, nothing about the store. */
const WELCOME = "Welcome back";
const SEARCH_BANNER = "Here's what you searched for: {query}";

/** The page's own buy-button text ("Add to cart"), when the outline has it. */
function buttonText(outline: PageElement[]): string | undefined {
  const selector = pickSelector("button", outline);
  const text = outline.find((e) => e.selector === selector)?.text.trim();
  return text && text.length <= 30 && !text.endsWith("…") ? text : undefined;
}

/**
 * Copy per source for when the prompt doesn't say what the text should be: the page's own facts
 * (verbatim), the visitor's search ({query}), neutral words, or a "[Your …]" placeholder for the
 * merchant. Never a rating, count, delivery promise or policy Darwin made up.
 */
function defaultCopy(key: TrafficSource | "any", outline: PageElement[]): Copy {
  const delivery = pageFacts(outline, "delivery", 3);
  const returns = pageFacts(outline, "returns", 2);
  const reviews = pageFacts(outline, "reviews");
  const offer = pageFacts(outline, "offer");
  const btn = buttonText(outline);
  const onButton = (fact: string | undefined, need: string) => (fact && btn && `${btn} · ${fact}`.length <= 70 ? `${btn} · ${fact}` : need);
  switch (key) {
    case "ai":
      return { banner: delivery ?? NEEDS.delivery, badge: returns ?? NEEDS.returns, headline: NEEDS.headline, button: onButton(returns, NEEDS.button) };
    case "search":
      return { banner: SEARCH_BANNER, badge: "You searched for {query}", headline: "{query}", button: NEEDS.button };
    case "social":
      return { banner: reviews ?? NEEDS.reviews, badge: reviews ?? NEEDS.reviews, headline: NEEDS.headline, button: onButton(reviews, NEEDS.button) };
    case "paid":
      return { banner: offer ?? NEEDS.offer, badge: offer ?? NEEDS.offer, headline: "{query}", button: onButton(offer, NEEDS.offer) };
    case "email":
      return { banner: WELCOME, badge: WELCOME, headline: WELCOME, button: NEEDS.button };
    case "referral":
      return { banner: returns ?? NEEDS.returns, badge: returns ?? NEEDS.returns, headline: NEEDS.headline, button: onButton(returns, NEEDS.button) };
    case "direct":
      return { banner: delivery ?? NEEDS.delivery, badge: returns ?? NEEDS.returns, headline: WELCOME, button: NEEDS.button };
    case "any":
      return { banner: delivery ?? NEEDS.delivery, badge: reviews ?? NEEDS.reviews, headline: "{query}", button: NEEDS.button };
  }
}

const clip = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function quoted(prompt: string): string[] {
  const out: string[] = [];
  for (const m of prompt.matchAll(/["“”]([^"“”]{2,200})["“”]|(?:^|\s)'([^']{2,200})'(?=[\s.,!?;:]|$)/g)) out.push((m[1] ?? m[2]).trim());
  return out;
}

/** "saying Free returns" / "that says …" / "to read …" (unquoted, to the end of the clause). */
function saying(prompt: string): string | undefined {
  return prompt
    .match(/\b(?:saying|that says|which says|to say|to read|reading|with the (?:text|words|copy))\s*:?\s+([^.;\n]{3,160})/i)?.[1]
    ?.trim()
    .replace(/[,.]\s*$/, "");
}

/** A rule from a plain-English prompt, without an LLM. */
export function heuristicDraft(site: string, prompt: string, outline: PageElement[] = []): WebRuleDraft {
  const p = ` ${prompt.toLowerCase()} `;
  const texts = quoted(prompt);

  // Search terms: "searched for 'waterproof'" narrows the audience rather than being display text.
  const queryIncludes: string[] = [];
  const searched = prompt.match(/search(?:ed|es|ing)?\s+(?:for\s+)?["“']([^"”']{2,60})["”']/i);
  if (searched) {
    queryIncludes.push(searched[1].toLowerCase().trim());
    texts.splice(texts.indexOf(searched[1].trim()), 1);
  }

  // "google ads" are paid traffic, not search; "newsletter popup" and "their search" are page things, not sources.
  const sourceText = p
    .replace(/\b(google|facebook|meta|instagram|tiktok|bing|search) ads\b/g, " ads ")
    .replace(/\b(newsletter|e-?mail) (pop-?ups?|modals?|sign-?ups?|forms?|overlays?|capture)\b/g, " popup ")
    .replace(/\b(their|the) (search|query|search terms?|keywords?)\b|what they (searched|typed|looked)/g, " ");
  const sources = SOURCE_WORDS.filter(([, re]) => re.test(sourceText)).map(([s]) => s);
  if (/\b(everyone|all visitors|every visitor|all traffic)\b/.test(p)) sources.length = 0;
  const copyKey: TrafficSource | "any" = sources.length === 1 ? sources[0] : "any";
  const copy = defaultCopy(copyKey, outline);
  const usesQuery = /\{query\}|\b(their|the) (search|query|search terms?|keywords?)\b|what they (searched|typed|looked) (for)?/.test(p);
  const withQuery = (v: string) => (usesQuery && !v.includes("{query}") ? `{query}: ${v}` : v);

  // Each kind of change, at the position it's mentioned, so quoted texts line up with them in order.
  const at = (re: RegExp) => re.exec(p)?.index ?? -1;
  const wanted: { at: number; make: (text: (fallback: string) => string) => WebChange }[] = [];
  const want = (pos: number, make: (typeof wanted)[number]["make"]) => pos >= 0 && wanted.push({ at: pos, make });
  want(at(/\b(hide|remove|get rid of|kill|turn off|no more|without)\b[^.]*\b(pop-?ups?|modals?|newsletter|overlays?)\b/), () => ({
    action: "hide",
    selector: pickSelector("popup", outline),
  }));
  want(at(/(?<!sub[- ]?)\b(head(line|ing)|title|hero|h1)\b/), (text) => ({
    action: "text",
    selector: pickSelector("headline", outline),
    value: withQuery(text(copy.headline)),
  }));
  want(at(/\bsub-?(head(line|ing)?|title)|\btagline\b/), (text) => ({ action: "text", selector: pickSelector("sub", outline), value: withQuery(text(copy.banner)) }));
  if (!/\b(badge|next to|beside|under|below)\b/.test(p)) {
    want(at(/\b(buttons?|cta|call to action|add to cart|add-to-cart|buy button)\b/), (text) => ({
      action: "text",
      selector: pickSelector("button", outline),
      value: text(copy.button),
    }));
  }
  want(at(/\b(badges?|social proof|reviews?|ratings?|stars?|trust)\b/), (text) => ({ action: "badge", selector: pickSelector("button", outline), value: text(copy.badge) }));
  want(at(/\b(banners?|bar|announcement|strip|notice|top of the page|message)\b/), (text) => ({ action: "banner", value: withQuery(text(copy.banner)) }));
  if (!wanted.length) want(0, (text) => ({ action: "banner", value: withQuery(text(copy.banner)) }));

  const said = saying(prompt);
  let t = 0;
  const nextText = (fallback: string) => {
    const i = t++;
    return texts[i] ?? (i === 0 ? said : undefined) ?? fallback;
  };
  // The merchant's own words are kept, but a claim the page doesn't make still waits for their confirmation.
  const guarded = guardChanges(
    wanted
      .sort((a, b) => a.at - b.at)
      .slice(0, 5)
      .map((w) => w.make(nextText)),
    pageTexts(outline),
  );
  const changes = guarded.changes;

  const mode = /\b(always|everyone in|permanently|just show|show it to all|personali[sz]e)\b/.test(p) && !/\b(a\/b|ab test|split|test|experiment)\b/.test(p) ? "always" : "test";
  const who = sources.length ? sources.map((s) => SHORT_LABEL[s]).join(" + ") : "everyone";
  const what = [...new Set(changes.map((c) => ACTION_LABEL[c.action]))].join(" + ");
  return WebRuleDraftSchema.parse({
    site,
    name: `${what} for ${who}`,
    hypothesis: clip(
      (sources.length === 1 ? PLAYBOOK[sources[0]].hypothesis : "Visitors convert better when the page speaks to why they came.") +
        merchantNote(guarded.unverified, draftNeedsMerchant({ changes })),
    ),
    audience: { ...(sources.length ? { sources } : {}), ...(queryIncludes.length ? { queryIncludes } : {}) },
    changes,
    mode,
    author: "heuristic",
    prompt: prompt.slice(0, 1000),
  });
}

const SHORT_LABEL: Record<TrafficSource, string> = {
  ai: "AI assistants",
  search: "search",
  social: "social",
  paid: "paid ads",
  email: "email",
  referral: "referrals",
  direct: "direct",
};

const ACTION_LABEL: Record<WebChange["action"], string> = {
  text: "New copy",
  banner: "Banner",
  badge: "Badge",
  hide: "Hide popup",
  style: "Restyle",
};

/* ------------------------------------------------------------------ LLM */

const LlmRuleSchema = z.object({
  name: z.string(),
  hypothesis: z.string().optional(),
  audience: z
    .object({
      sources: z.array(z.string()).optional(),
      queryIncludes: z.array(z.string()).optional(),
      paths: z.array(z.string()).optional(),
    })
    .default({}),
  changes: z.array(z.object({ action: z.string(), selector: z.string().optional(), value: z.string().optional() })),
  mode: z.enum(["test", "always"]).default("test"),
});

const SYSTEM = `You write personalization rules for an online store's web page. A small script on the page applies them in the browser.
A rule has an audience (who sees it) and up to 5 changes. Changes can only:
- "text": replace the text of the elements matching "selector" with "value" (plain text, never HTML)
- "banner": add a thin announcement bar at the top of the page with "value" (no selector)
- "badge": add a small pill with "value" right after the element matching "selector"
- "hide": hide the elements matching "selector"
- "style": append CSS declarations in "value" to the element (e.g. "background:#111;color:#fff"), no urls
"{query}" in a value is replaced by the visitor's search query in Title Case (skipped when they have none).
Audience sources: ${TRAFFIC_SOURCES.map((s) => `"${s}" (${TRAFFIC_SOURCE_LABEL[s]})`).join(", ")}. Omit sources for everyone.
queryIncludes narrows to visitors whose search query contains one of those words.
mode: "test" = A/B test against the unchanged page (default), "always" = show to everyone in the audience.
Only use selectors from the page outline when one fits; otherwise use a simple, robust selector (h1, button). Keep copy short (under 90 characters) and specific.
Never invent facts about the store. No star ratings, review, customer or order counts, awards, "bestseller", delivery or dispatch promises, return policies, warranties, guarantees, discounts or stock levels, unless that exact text is in the page outline: then reuse it word for word. Otherwise write neutral copy (the visitor's search via {query}, "Welcome back", "Here's what you searched for: {query}"), or put a placeholder the merchant fills in, like "[Your returns policy]". Facts the merchant states in the prompt are fine, but Darwin will still ask them to confirm any that aren't on the page.`;

/** A rule from a prompt: the LLM when configured, else the keyword parser. Fetches the page to ground selectors. */
export async function draftRule(site: string, prompt: string, opts: { url?: string; outline?: PageElement[] } = {}): Promise<WebDraftResponse> {
  const outline = opts.outline ?? (await pageOutline(opts.url));
  if (llmAvailable()) {
    try {
      const out = await generateJson({
        system: SYSTEM,
        prompt: `Page outline (selector → current text):\n${
          outline.length ? outline.map((e) => `- ${e.selector} → ${JSON.stringify(e.text)}`).join("\n") : "(page not available: use generic selectors)"
        }\n\nThe merchant asks: ${JSON.stringify(prompt)}\n\nReturn {"name","hypothesis","audience":{"sources"?,"queryIncludes"?},"changes":[{"action","selector"?,"value"?}],"mode"}.`,
        schema: LlmRuleSchema,
        maxTokens: 1200,
      });
      const rule = WebRuleDraftSchema.parse({
        site,
        ...out,
        audience: {
          ...out.audience,
          sources: out.audience.sources?.filter((s) => (TRAFFIC_SOURCES as readonly string[]).includes(s)),
        },
        author: llmLabel(),
        prompt: prompt.slice(0, 1000),
      });
      // The model was told the rule; this makes sure: a claim the page doesn't make waits for the merchant.
      const guarded = guardChanges(rule.changes, pageTexts(outline));
      const note = merchantNote(guarded.unverified, draftNeedsMerchant(guarded));
      return { rule: { ...rule, changes: guarded.changes, ...(note ? { hypothesis: clip(`${rule.hypothesis ?? ""}${note}`.trim()) } : {}) }, source: "llm", outline };
    } catch {
      /* fall through to the heuristic */
    }
  }
  return { rule: heuristicDraft(site, prompt, outline), source: "heuristic", outline };
}

/* ------------------------------------------------------------------ playbook */

interface Play {
  hypothesis: string;
  build: (outline: PageElement[]) => Pick<WebRuleDraft, "name" | "changes">;
}

const copy = (o: PageElement[], key: TrafficSource) => defaultCopy(key, o);

/**
 * One idea per source. Copy comes from defaultCopy(): the page's own facts, the visitor's context, or
 * neutral words; an idea that needs a fact the page doesn't state carries a "[Your …]" placeholder, so it's
 * a draft for the merchant and autopilot skips it.
 */
export const PLAYBOOK: Record<TrafficSource, Play> = {
  ai: {
    hypothesis: "Shoppers sent by ChatGPT or Perplexity arrive to check facts. Your delivery and returns terms up front answer them before they bounce back to the chat.",
    build: (o) => ({ name: "Delivery & returns banner for AI assistants", changes: [{ action: "banner", value: copy(o, "ai").banner }] }),
  },
  search: {
    hypothesis: "Echoing the visitor's search in the headline tells them they landed in the right place (message match), so fewer bounce.",
    build: (o) => ({ name: "Search-matched headline", changes: [{ action: "text", selector: pickSelector("headline", o), value: copy(o, "search").headline }] }),
  },
  social: {
    hypothesis: "Social visitors arrive cold and unsure. Your real rating next to the buy button answers 'is this any good?'.",
    build: (o) => ({ name: "Reviews badge for social visitors", changes: [{ action: "badge", selector: pickSelector("button", o), value: copy(o, "social").badge }] }),
  },
  paid: {
    hypothesis: "Ad clicks came for the ad's promise. Repeating your offer above the fold keeps the message consistent from ad to page.",
    build: (o) => ({ name: "Offer banner for ad clicks", changes: [{ action: "banner", value: copy(o, "paid").banner }] }),
  },
  email: {
    hypothesis: "Subscribers already know the brand. Recognising them beats a generic first-visit page.",
    build: (o) => ({ name: "Welcome-back banner for subscribers", changes: [{ action: "banner", value: copy(o, "email").banner }] }),
  },
  referral: {
    hypothesis: "Visitors from a review or blog arrive interested but wary. Your returns terms right at the buy button lower the risk of trying.",
    build: (o) => ({ name: "Returns badge for referrals", changes: [{ action: "badge", selector: pickSelector("button", o), value: copy(o, "referral").badge }] }),
  },
  direct: {
    hypothesis: "Direct visitors are mostly returning customers who came to buy. A signup popup gets in their way.",
    build: (o) => ({ name: "No popup for direct visitors", changes: [{ action: "hide", selector: pickSelector("popup", o) }] }),
  },
};

/** Each source's next idea, tried when the first one is stopped or already shipped. */
export const FOLLOW_UPS: Record<TrafficSource, Play> = {
  ai: {
    hypothesis: "AI-referred shoppers compare on facts. Answering 'can I return it?' right at the buy button removes the last doubt.",
    build: (o) => ({ name: "Returns & warranty badge for AI assistants", changes: [{ action: "badge", selector: pickSelector("button", o), value: copy(o, "ai").badge }] }),
  },
  search: {
    hypothesis: "If the headline can't change, a bar repeating the search still confirms the visitor is in the right place.",
    build: (o) => ({ name: "Search-matched banner", changes: [{ action: "banner", value: copy(o, "search").banner }] }),
  },
  social: {
    hypothesis: "Social visitors trust other shoppers. Your rating above the fold is seen by more of them than a small badge.",
    build: (o) => ({ name: "Social-proof banner", changes: [{ action: "banner", value: copy(o, "social").banner }] }),
  },
  paid: {
    hypothesis: "Putting the ad's offer on the buy button itself keeps the promise in view at the moment of decision.",
    build: (o) => ({ name: "Offer on the button for ad clicks", changes: [{ action: "text", selector: pickSelector("button", o), value: copy(o, "paid").button }] }),
  },
  email: {
    hypothesis: "Subscribers are already on the list: the newsletter popup only gets in their way.",
    build: (o) => ({ name: "No popup for subscribers", changes: [{ action: "hide", selector: pickSelector("popup", o) }] }),
  },
  referral: {
    hypothesis: "Visitors from a review came for one product; a signup popup gets between them and it.",
    build: (o) => ({ name: "No popup for referrals", changes: [{ action: "hide", selector: pickSelector("popup", o) }] }),
  },
  direct: {
    hypothesis: "Returning customers came to buy; a reminder of your delivery and returns terms removes the last hesitation.",
    build: (o) => ({ name: "Delivery & returns banner for direct visitors", changes: [{ action: "banner", value: copy(o, "direct").banner }] }),
  },
};

/** All ideas for a source, in the order to try them. */
export const ideasFor = (source: TrafficSource): Play[] => [PLAYBOOK[source], FOLLOW_UPS[source]];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * Sources by opportunity: most visitors converting furthest below the site average first.
 * With no data yet, the playbook order stands.
 */
export function rankSources(overview?: WebSiteOverview): TrafficSource[] {
  const order: TrafficSource[] = ["ai", "search", "social", "paid", "email", "direct", "referral"];
  if (!overview?.visitors) return order;
  const avg = overview.conversionRate;
  const gap = (s: TrafficSource) => {
    const st = overview.bySource[s];
    return st.visitors ? st.visitors * Math.max(0.001, avg - st.conversionRate + 0.001) : 0;
  };
  return [...order].sort((a, b) => gap(b) - gap(a));
}

/** Idea `index` for `source` as a draft, with the site's own numbers in the hypothesis when there are enough. */
export function ideaDraft(site: string, source: TrafficSource, index: number, overview?: WebSiteOverview, outline: PageElement[] = []): WebRuleDraft | undefined {
  const play = ideasFor(source)[index];
  if (!play) return undefined;
  const st = overview?.bySource[source];
  const evidence =
    st && overview && st.visitors >= 20
      ? ` Data: ${TRAFFIC_SOURCE_LABEL[source]} convert at ${pct(st.conversionRate)} vs ${pct(overview.conversionRate)} site-wide (${st.visitors} visitors${overview.syntheticVisitors ? ", includes simulated traffic" : ""}).`
      : "";
  const built = play.build(outline);
  // Safety net: the playbook only uses the page's words, but nothing unconfirmed leaves here either way.
  const guarded = guardChanges(built.changes, pageTexts(outline));
  return WebRuleDraftSchema.parse({
    site,
    ...built,
    changes: guarded.changes,
    hypothesis: clip(play.hypothesis + evidence + merchantNote(guarded.unverified, draftNeedsMerchant(guarded))),
    audience: { sources: [source] },
    mode: "test",
    author: "playbook",
  });
}

/** One playbook idea per source, the biggest opportunity first. */
export function suggestRules(site: string, overview?: WebSiteOverview, outline: PageElement[] = []): WebRuleDraft[] {
  return rankSources(overview)
    .slice(0, 5)
    .map((source) => ideaDraft(site, source, 0, overview, outline)!);
}
