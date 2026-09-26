/**
 * Synthetic visitors for a site's web rules, so a demo can show a test reach a result in seconds.
 *
 * Each visitor gets a traffic source (a realistic mix), lands with that source's referrer and URL
 * parameters, is matched and assigned exactly like the browser runtime, and then converts with a
 * probability from a toy relevance model: a change helps when it answers what that source came for
 * (facts for AI referrals, the search term for search, social proof for social, the offer for ads).
 *
 * This is a model, not evidence. Every event is marked `synthetic: true` and the console labels it.
 */
import type { AnalyticsEventInput, PageElement, TrafficSource, WebChange, WebRule, WebSimulateResponse } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { pickSelector } from "./drafts";
import { EXPOSURE_EVENT } from "./results";
import { assignWebVariant, classifySource, fillValue, matchesAudience, type Segment } from "./segment";

export const MAX_SIM_VISITORS = 2000;

const MIX: [TrafficSource, number][] = [
  ["search", 0.3],
  ["social", 0.2],
  ["ai", 0.15],
  ["paid", 0.15],
  ["email", 0.08],
  ["direct", 0.07],
  ["referral", 0.05],
];

/** Baseline order rate per source before any change. */
const BASE: Record<TrafficSource, number> = {
  ai: 0.034,
  search: 0.03,
  social: 0.012,
  paid: 0.022,
  email: 0.045,
  referral: 0.028,
  direct: 0.04,
};

const QUERIES = ["waterproof trail shoes", "trail running shoes", "lightweight trail runners", "gore-tex running shoes", "wide fit trail shoes"];

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

/** How much one applied change moves this visitor's chance to order (the toy model). */
export function changeEffect(change: WebChange, seg: Segment): number {
  if (change.action === "hide") return /popup|modal|newsletter/i.test(change.selector ?? "") ? 1.08 : 1;
  const text = (fillValue(change.value, seg) ?? "").toLowerCase();
  if (!text) return 1;
  switch (seg.source) {
    case "ai":
      return /deliver|return|ship|dispatch|warrant|in stock|size|spec|£|\$/.test(text) ? 1.4 : 0.97;
    case "search":
      return change.value?.includes("{query}") ? 1.45 : /in stock|ships/.test(text) ? 1.1 : 0.98;
    case "social":
      return /★|review|rated|rating|customers|runners|loved|stars/.test(text) ? 1.32 : 0.98;
    case "paid":
      return /free (delivery|shipping)|% off|discount|code|save|first order|offer/.test(text) ? 1.28 : 0.98;
    case "email":
      return /welcome|subscriber|member|exclusive|perk/.test(text) ? 1.22 : 1;
    default:
      return /return|deliver|★|review/.test(text) ? 1.05 : 1;
  }
}

/** How likely each source is to click things other than buying (the heatmap differs by source). */
const CLICKS: Record<TrafficSource, { popup: number; nav: number; hero: number; rage: number }> = {
  ai: { popup: 0.08, nav: 0.12, hero: 0.05, rage: 0.01 },
  search: { popup: 0.22, nav: 0.3, hero: 0.1, rage: 0.02 },
  social: { popup: 0.38, nav: 0.12, hero: 0.28, rage: 0.06 },
  paid: { popup: 0.3, nav: 0.2, hero: 0.2, rage: 0.04 },
  email: { popup: 0.04, nav: 0.35, hero: 0.08, rage: 0.01 },
  referral: { popup: 0.25, nav: 0.25, hero: 0.12, rage: 0.02 },
  direct: { popup: 0.15, nav: 0.3, hero: 0.06, rage: 0.02 },
};

interface Targets {
  popup?: PageElement;
  nav?: PageElement;
  hero?: PageElement;
  cart?: PageElement;
  checkout?: PageElement;
}

/** Real elements from the page's outline for synthetic visitors to click. */
function clickTargets(outline: PageElement[]): Targets {
  const bySelector = (sel: string) => outline.find((e) => e.selector === sel);
  const cartSel = pickSelector("button", outline);
  return {
    popup: outline.find((e) => e.tag === "button" && (/close|dismiss/i.test(e.selector) || e.text === "×")),
    nav: outline.find((e) => e.tag === "a"),
    hero: outline.find((e) => e.tag === "h1"),
    cart: bySelector(cartSel),
    checkout: outline.find((e) => /checkout/i.test(e.text) && e.selector !== cartSel),
  };
}

function landing(source: TrafficSource, base: string, rand: () => number): { url: string; referrer?: string } {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const u = new URL(base);
  const query = pick(QUERIES);
  switch (source) {
    case "ai": {
      const ref = pick(["https://chatgpt.com/", "https://www.perplexity.ai/", "https://claude.ai/", "https://gemini.google.com/"]);
      if (ref.includes("chatgpt")) u.searchParams.set("utm_source", "chatgpt.com");
      return { url: u.href, referrer: ref };
    }
    case "search":
      u.searchParams.set("utm_term", query);
      return { url: u.href, referrer: pick(["https://www.google.com/", "https://www.google.co.uk/", "https://www.bing.com/", "https://duckduckgo.com/"]) };
    case "social":
      return { url: u.href, referrer: pick(["https://l.instagram.com/", "https://www.tiktok.com/", "https://t.co/x", "https://www.reddit.com/r/trailrunning/"]) };
    case "paid":
      u.searchParams.set(rand() < 0.7 ? "gclid" : "fbclid", Math.floor(rand() * 1e9).toString(36));
      u.searchParams.set("utm_term", query);
      return { url: u.href, referrer: "https://www.google.com/" };
    case "email":
      u.searchParams.set("utm_medium", "email");
      u.searchParams.set("utm_source", "klaviyo");
      return { url: u.href };
    case "referral":
      return { url: u.href, referrer: "https://www.runnersworld.example/best-trail-shoes" };
    default:
      return { url: u.href };
  }
}

/**
 * Send `visitors` synthetic visitors through the site's live rules. `rules` are the site's rules
 * (only running and shipped ones are live, as in the runtime); `url` is the page they land on.
 */
export function simulateWebTraffic(opts: {
  site: string;
  visitors: number;
  rules: WebRule[];
  url: string;
  /** The page's elements (outline.ts): when given, visitors also click them (for the heatmap). */
  outline?: PageElement[];
  seed?: number;
  now?: number;
}): WebSimulateResponse {
  const n = Math.max(1, Math.min(MAX_SIM_VISITORS, Math.floor(opts.visitors)));
  const rand = mulberry32(opts.seed ?? Date.now());
  const live = opts.rules.filter((r) => r.status === "running" || r.status === "shipped");
  const start = opts.now ?? Date.now();
  const batch = Math.floor(rand() * 1e9).toString(36);
  const events: AnalyticsEventInput[] = [];
  const targets = clickTargets(opts.outline ?? []);
  let orders = 0;

  for (let i = 0; i < n; i++) {
    let r = rand();
    const source = MIX.find(([, w]) => (r -= w) < 0)?.[0] ?? "direct";
    const land = landing(source, opts.url, rand);
    const seg = classifySource(land);
    const pathname = new URL(land.url).pathname;
    const distinctId = `v_sim_${batch}_${i}`;
    const ts = (k: number) => new Date(start + i * 5 + k).toISOString();
    const base = {
      visitor_kind: "human" as const,
      synthetic: true,
      persona: `web-sim:${seg.source}`,
      darwin_site: opts.site,
      $lib: "darwin-sim",
      $session_id: `s_sim_${batch}_${i}`,
      $current_url: land.url,
      $pathname: pathname,
      $referrer: land.referrer,
    };
    events.push({ event: "$pageview", distinct_id: distinctId, timestamp: ts(0), properties: { ...base, title: opts.site } });

    let lift = 1;
    for (const rule of live) {
      if (!matchesAudience(rule.audience, seg, pathname)) continue;
      const variant = assignWebVariant(distinctId, rule);
      events.push({
        event: EXPOSURE_EVENT,
        distinct_id: distinctId,
        timestamp: ts(1),
        properties: { ...base, rule_id: rule.id, web_source: seg.source, web_query: seg.query || undefined },
      });
      if (variant === "treatment") for (const c of rule.changes) lift *= changeEffect(c, seg);
    }
    const click = (t: PageElement | undefined, k: number, event = "$autocapture") =>
      t &&
      events.push({
        event,
        distinct_id: distinctId,
        timestamp: ts(k),
        properties: { ...base, $event_type: "click", $el_tag: t.tag, $el_text: t.text.slice(0, 64), $selector: t.selector },
      });
    const c = CLICKS[seg.source];
    if (rand() < c.popup) click(targets.popup, 1);
    if (rand() < c.nav) click(targets.nav, 1);
    if (rand() < c.hero) click(targets.hero, 1);
    if (rand() < c.rage && targets.hero) {
      // Three quick clicks on something that isn't a link: a "dead click" frustration signal.
      for (let k = 0; k < 3; k++) click(targets.hero, 1);
      click(targets.hero, 1, "$rageclick");
    }

    const p = Math.min(0.5, BASE[seg.source] * Math.min(lift, 1.9));
    const addToCart = rand() < Math.min(0.9, p * 3.2);
    if (addToCart) {
      click(targets.cart, 2);
      events.push({ event: "product_added", distinct_id: distinctId, timestamp: ts(2), properties: { ...base } });
    }
    if (addToCart && rand() < p / Math.min(0.9, p * 3.2)) {
      click(targets.checkout, 3);
      orders++;
      const revenue = 8000 + Math.floor(rand() * 8) * 500;
      events.push({ event: "order_completed", distinct_id: distinctId, timestamp: ts(3), properties: { ...base, revenue } });
    }
  }
  track(events);
  return { site: opts.site, visitors: n, orders, synthetic: true };
}
