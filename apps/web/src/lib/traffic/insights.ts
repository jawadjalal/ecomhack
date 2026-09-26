/**
 * "What to improve": SEO, conversion and AI-agent suggestions from the traffic report.
 *
 * - heuristicInsights: deterministic rules over the report (always available, no API keys).
 * - llmInsights: the same report + the rule-based findings go to the LLM (DeepSeek via OpenRouter / Grok / Claude), which
 *   may reword, merge and add suggestions, but only from the numbers it was given. Any failure
 *   falls back to the rules.
 * Every suggestion quotes its evidence and, where it can, sizes the prize (extra orders if the gap
 * closed at today's traffic) and carries a one-line prompt that drafts an A/B test in
 * /console/personalize (lib/web's draftRule).
 */
import { z } from "zod";
import { generateJson, llmAvailable, llmLabel } from "@/lib/llm/client";
import { NOT_PROVIDED, type TrafficDimension, type TrafficReport, type TrafficRow } from "./report";

export type InsightCategory = "seo" | "conversion" | "agents" | "tracking";

export interface TrafficInsight {
  id: string;
  category: InsightCategory;
  title: string;
  /** The numbers behind it, in plain words. */
  evidence: string;
  /** What to do. */
  action: string;
  /** Extra orders (and pence) if this segment converted at the site average, at today's traffic. */
  impact?: { orders: number; revenue: number };
  /** Plain-language change for /api/web/draft ("Visitors from Instagram: add a badge …"). */
  testPrompt?: string;
  /** Somewhere in Darwin to act on it. */
  link?: { href: string; label: string };
  confidence: "low" | "medium" | "high";
}

export interface InsightsResponse {
  insights: TrafficInsight[];
  source: "heuristic" | "llm";
  /** "heuristic" or "llm:<model>". */
  author: string;
  generatedAt: string;
  /** Why the LLM wasn't used, when it wasn't. */
  note?: string;
}

const MIN_ROW = 20;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gbp = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;
const confidenceOf = (n: number): TrafficInsight["confidence"] => (n >= 200 ? "high" : n >= 60 ? "medium" : "low");

/** A change the web engine can draft, per channel (matches lib/web's source vocabulary). */
const SOURCE_FIX: Record<string, { action: string; prompt: string }> = {
  ai: {
    action: "AI-assistant visitors arrive with a specific question. Answer it above the fold: delivery, returns and stock.",
    prompt: "Visitors from ChatGPT and other AI assistants: banner saying Free UK delivery over £60 · Free 60-day returns · Ships in 24h",
  },
  search: {
    action: "Search visitors want the thing they typed. Echo their search in the headline so they know they're in the right place.",
    prompt: "Google searchers: put their search in the headline",
  },
  social: {
    action: "Social visitors are browsing, not buying yet. Add social proof right next to the buy button.",
    prompt: 'Instagram and TikTok: add a badge "★ 4.8 from 2,000+ runners" next to Add to cart',
  },
  paid: {
    action: "You pay for these clicks. Match the landing page to the ad's keyword and lead with the offer.",
    prompt: "Paid ad visitors: put their search in the headline and add a banner Free delivery and 60-day returns",
  },
  email: {
    action: "Subscribers already know you. Skip the pitch: show what's new and a clear reason to buy today.",
    prompt: "Email visitors: banner saying New this week · Free delivery for subscribers",
  },
  referral: {
    action: "Visitors from reviews and blogs want confirmation. Show ratings and the review quote near the price.",
    prompt: 'Visitors from other websites: add a badge "Rated 4.8 by 2,000+ runners" next to Add to cart',
  },
  direct: {
    action: "Direct visitors are returning or typed your URL. Remove friction: hide pop-ups, show delivery info.",
    prompt: "Direct visitors: hide the newsletter popup",
  },
};

function aov(r: TrafficReport): number {
  return r.totals.conversions ? r.totals.revenue / r.totals.conversions : 0;
}

function gap(row: TrafficRow, avg: number, value: number) {
  const orders = Math.max(0, Math.round(row.visitors * (avg - row.conversionRate)));
  return { orders, revenue: Math.round(orders * value) };
}

const DIM_NOUN: Partial<Record<TrafficDimension, string>> = {
  referrer: "Visitors from",
  country: "Visitors in",
  device: "Visitors on",
  landing: "Visitors landing on",
};

/** Deterministic suggestions. Sorted by prize, then confidence. */
export function heuristicInsights(r: TrafficReport): TrafficInsight[] {
  const out: TrafficInsight[] = [];
  const t = r.totals;
  if (t.visitors < 10) {
    return [
      {
        id: "need-traffic",
        category: "tracking",
        title: "Not enough visitors to judge yet",
        evidence: `${t.visitors} visitors so far.`,
        action: "Send some traffic through the tracked store (or use “+ test visitors”) and ask again.",
        confidence: "low",
      },
    ];
  }
  const avg = t.conversionRate;
  const value = aov(r);
  const share = (n: number) => (t.visitors ? n / t.visitors : 0);
  const rowsOf = (d: TrafficDimension) => r.dimensions[d].filter((x) => x.visitors >= MIN_ROW);

  // 1. Conversion gaps: channels first (they map straight onto a personalization rule).
  for (const row of rowsOf("source")) {
    if (row.conversionRate >= avg * 0.7) continue;
    const fix = SOURCE_FIX[row.key];
    out.push({
      id: `gap-source-${row.key}`,
      category: row.key === "search" || row.key === "ai" ? "seo" : "conversion",
      title: `${row.label} convert below average`,
      evidence: `${row.visitors} visitors, ${pct(row.conversionRate)} ordered vs ${pct(avg)} site-wide.`,
      action: fix?.action ?? "Tailor the page for this channel and test it.",
      impact: gap(row, avg, value),
      testPrompt: fix?.prompt,
      confidence: confidenceOf(row.visitors),
    });
  }
  const flaggedChannels = new Set(out.map((o) => o.id));
  const SEARCH_ENGINES = /^ref:(Google|Bing|DuckDuckGo|Yahoo|Ecosia|Brave Search)$/;
  for (const dim of ["referrer", "country", "device", "landing"] as const) {
    const worstRow = rowsOf(dim)
      .filter((row) => row.conversionRate < avg * 0.6 && row.key !== "direct" && row.key !== "??" && row.key !== "agent-api")
      .filter((row) => !(dim === "device" && row.label === "Unknown"))
      // "Search engines convert below average" already says it; don't repeat it per engine.
      .filter((row) => !(dim === "referrer" && SEARCH_ENGINES.test(row.key) && flaggedChannels.has("gap-source-search")))
      .sort((a, b) => gap(b, avg, value).orders - gap(a, avg, value).orders)[0];
    for (const row of worstRow ? [worstRow] : []) {
      out.push({
        id: `gap-${dim}-${row.key}`,
        category: "conversion",
        title: `${DIM_NOUN[dim]} ${dim === "country" ? row.label.replace(/^\S+\s/, "") : row.label} rarely buy`,
        evidence: `${row.visitors} visitors, ${pct(row.conversionRate)} ordered vs ${pct(avg)} site-wide.`,
        action:
          dim === "country"
            ? `Show delivery time, cost and currency for ${row.label.replace(/^\S+\s/, "")} up front; unexpected shipping is the top reason carts are abandoned.`
            : dim === "device"
              ? `Check the ${row.label.toLowerCase()} checkout end to end: tap targets, form length, payment options.`
              : dim === "landing"
                ? `This page is a doorway that doesn't lead anywhere. Add a clear next step and the bestsellers above the fold.`
                : `Look at what ${row.label} promised your visitors and make the landing page match it.`,
        impact: gap(row, avg, value),
        confidence: confidenceOf(row.visitors),
      });
    }
  }

  // 2. Search: queries that convert well = content to build; ones that don't = pages to fix.
  const queries = rowsOf("query").filter((q) => q.key !== NOT_PROVIDED);
  const best = [...queries].sort((a, b) => b.conversionRate - a.conversionRate)[0];
  if (best && best.conversionRate > avg * 1.3) {
    out.push({
      id: `seo-query-win-${best.key}`,
      category: "seo",
      title: `“${best.label}” is a money keyword`,
      evidence: `${best.visitors} visitors searched it and ${pct(best.conversionRate)} ordered (site average ${pct(avg)}).`,
      action: `Build a dedicated landing page and guide for “${best.label}” (title tag, H1, FAQ with the exact phrase), and bid on it if it's organic today.`,
      confidence: confidenceOf(best.visitors),
    });
  }
  const worst = [...queries].sort((a, b) => a.conversionRate - b.conversionRate)[0];
  if (worst && worst !== best && worst.conversionRate < avg * 0.6) {
    out.push({
      id: `seo-query-gap-${worst.key}`,
      category: "seo",
      title: `People searching “${worst.label}” don't find it`,
      evidence: `${worst.visitors} visitors, ${pct(worst.conversionRate)} ordered.`,
      action: `Either the page doesn't show what “${worst.label}” promises or you don't sell it. Put the matching product first for this search, or stop paying for the keyword.`,
      impact: gap(worst, avg, value),
      testPrompt: `Visitors searching ${worst.label}: put their search in the headline`,
      confidence: confidenceOf(worst.visitors),
    });
  }
  const searchRow = r.dimensions.source.find((s) => s.key === "search");
  if (t.notProvided >= 20 && searchRow && t.notProvided / searchRow.visitors > 0.5) {
    out.push({
      id: "seo-not-provided",
      category: "tracking",
      title: "Most search terms are hidden by Google",
      evidence: `${t.notProvided} of ${searchRow.visitors} search visitors arrived without a search term ((not provided)).`,
      action: "Connect Google Search Console to see the organic queries (totals per page), and tag paid links with utm_term.",
      confidence: "high",
    });
  }
  if (share(searchRow?.visitors ?? 0) < 0.15 && t.visitors >= 100) {
    out.push({
      id: "seo-low-search-share",
      category: "seo",
      title: "Search brings you very little traffic",
      evidence: `Only ${pct(share(searchRow?.visitors ?? 0))} of visitors came from search engines.`,
      action: "Basic SEO: unique title and meta description per product, product structured data (schema.org), and a category page per use-case (trail, road, racing).",
      link: { href: "/readiness", label: "Audit the store" },
      confidence: "medium",
    });
  }

  // 3. AI assistants and agents.
  const aiRow = r.dimensions.source.find((s) => s.key === "ai");
  if (!aiRow || aiRow.visitors === 0) {
    out.push({
      id: "agents-no-ai-traffic",
      category: "agents",
      title: "No visitors from AI assistants yet",
      evidence: "0 visitors from ChatGPT, Perplexity, Claude or Gemini.",
      action: "Make the catalogue readable by AI: server-rendered prices and stock, product structured data, an llms.txt, and a product feed. Run the readiness audit to see what's missing.",
      link: { href: "/readiness", label: "Run the agent-readiness audit" },
      confidence: "medium",
    });
  }
  if (t.agents > 0) {
    const agentRate = r.dimensions.device.find((d) => d.key === "Agent")?.conversionRate;
    out.push({
      id: "agents-share",
      category: "agents",
      title: `AI agents are ${pct(share(t.agents))} of your visitors`,
      evidence: `${t.agents} agent sessions${agentRate !== undefined ? `, ${pct(agentRate)} of them ordered` : ""}.`,
      action: "Agents read structured data, not pictures: keep price incl. VAT, stock per size, delivery and returns in the HTML and the agent API, and remove pop-ups.",
      link: { href: "/console", label: "Watch agents in mission control" },
      confidence: confidenceOf(t.agents),
    });
  }

  // 4. Scale what works.
  const star = rowsOf("referrer")
    .filter((x) => x.key !== "direct" && x.key !== "agent-api")
    .sort((a, b) => b.conversionRate - a.conversionRate)[0];
  if (star && star.conversionRate > avg * 1.4) {
    out.push({
      id: `scale-${star.key}`,
      category: "seo",
      title: `${star.label} sends your best buyers`,
      evidence: `${star.visitors} visitors, ${pct(star.conversionRate)} ordered: ${(star.conversionRate / (avg || 1)).toFixed(1)}× the site average.`,
      action: `Put more effort into ${star.label}: more posts or links there, and a landing page written for that audience.`,
      confidence: confidenceOf(star.visitors),
    });
  }

  // 5. Tracking hygiene.
  const tagged = r.dimensions.campaign.reduce((n, c) => n + c.visitors, 0);
  if (t.visitors >= 100 && share(tagged) < 0.1) {
    out.push({
      id: "tracking-utm",
      category: "tracking",
      title: "Most links aren't tagged",
      evidence: `Only ${pct(share(tagged))} of visitors arrived on a UTM-tagged link.`,
      action: "Add utm_source / utm_medium / utm_campaign to every link you post (bio links, newsletters, ads) so each campaign's sales show up here.",
      confidence: "high",
    });
  }

  return balance(out);
}

const LIMIT = 8;
const PER_CATEGORY = 3;

/** Biggest prize first, but every category with a finding gets a slot and none takes more than 3. */
function balance(all: TrafficInsight[]): TrafficInsight[] {
  const rank = { high: 0, medium: 1, low: 2 };
  const sorted = [...all].sort((a, b) => (b.impact?.orders ?? 0) - (a.impact?.orders ?? 0) || rank[a.confidence] - rank[b.confidence]);
  const picked: TrafficInsight[] = [];
  const count = (c: InsightCategory) => picked.filter((p) => p.category === c).length;
  for (const c of ["conversion", "seo", "agents", "tracking"] as const) {
    const first = sorted.find((i) => i.category === c);
    if (first) picked.push(first);
  }
  for (const i of sorted) {
    if (picked.length >= LIMIT) break;
    if (!picked.includes(i) && count(i.category) < PER_CATEGORY) picked.push(i);
  }
  return picked.sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b));
}

/* ------------------------------------------------------------------ LLM */

const LlmInsight = z.object({
  category: z.enum(["seo", "conversion", "agents", "tracking"]),
  title: z.string().min(3).max(120),
  evidence: z.string().min(3).max(300),
  action: z.string().min(3).max(400),
  testPrompt: z.string().max(300).optional(),
  basedOn: z.string().max(80).optional(),
});
const LlmOutput = z.object({ insights: z.array(LlmInsight).min(1).max(8) });

function compact(r: TrafficReport) {
  const rows = (d: TrafficDimension) =>
    r.dimensions[d].slice(0, 8).map((x) => ({ label: x.label, visitors: x.visitors, humans: x.humans, agents: x.agents, orderRate: pct(x.conversionRate) }));
  return {
    totals: { ...r.totals, conversionRate: pct(r.totals.conversionRate), revenue: gbp(r.totals.revenue) },
    channels: rows("source"),
    referringSites: rows("referrer"),
    searchQueries: rows("query"),
    campaigns: rows("campaign"),
    countries: rows("country"),
    landingPages: rows("landing"),
    devices: rows("device"),
  };
}

const SYSTEM = `You are Darwin, a conversion-rate and SEO analyst for an online store that sells to humans and to AI shopping agents.
You get the store's traffic report and a list of rule-based findings. Write the most valuable improvements, most valuable first.
Rules:
- Use ONLY numbers present in the input. Never invent data, benchmarks or percentages.
- "(not provided)" means Google hid the organic search term: never guess it.
- Each insight: category (seo | conversion | agents | tracking), a short title, evidence quoting the input's numbers, one concrete action.
- testPrompt (optional): one sentence describing a page change for one audience, e.g. "Visitors from Instagram: add a badge ★ 4.8 from 2,000+ runners next to Add to cart". Text, banners, badges, hiding or styling only.
- basedOn (optional): the id of the rule-based finding you built on, if any.
- Keep the rule-based findings' substance; merge duplicates; add at most 3 new ones.`;

export async function llmInsights(r: TrafficReport, base = heuristicInsights(r)): Promise<InsightsResponse> {
  const generatedAt = new Date().toISOString();
  if (!llmAvailable()) {
    return { insights: base, source: "heuristic", author: "heuristic", generatedAt, note: "No LLM key configured: built-in rules." };
  }
  try {
    const out = await generateJson({
      system: SYSTEM,
      prompt: `Traffic report (JSON):\n${JSON.stringify(compact(r))}\n\nRule-based findings (JSON):\n${JSON.stringify(
        base.map(({ id, category, title, evidence, action }) => ({ id, category, title, evidence, action })),
      )}\n\nReturn {"insights": [...]}.`,
      schema: LlmOutput,
      maxTokens: 2500,
    });
    const byId = new Map(base.map((b) => [b.id, b]));
    const insights: TrafficInsight[] = out.insights.map((x, i) => {
      const src = x.basedOn ? byId.get(x.basedOn) : undefined;
      return {
        id: src?.id ?? `llm-${i}`,
        category: x.category,
        title: x.title,
        evidence: x.evidence,
        action: x.action,
        // Impact and links are computed, never taken from the model.
        impact: src?.impact,
        link: src?.link,
        testPrompt: x.testPrompt ?? src?.testPrompt,
        confidence: src?.confidence ?? "low",
      };
    });
    return { insights, source: "llm", author: llmLabel(), generatedAt };
  } catch (err) {
    return { insights: base, source: "heuristic", author: "heuristic", generatedAt, note: `LLM unavailable (${String((err as Error).message).slice(0, 120)}): built-in rules.` };
  }
}
