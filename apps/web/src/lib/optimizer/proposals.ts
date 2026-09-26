/**
 * Designer: turn insights into ONE concrete, validated PageSpec change to A/B test.
 *
 * Heuristic mode uses a playbook mapping insight kinds → candidate patches (bundles of 1-3 related
 * knobs). We pick the highest-scoring candidate (insight impact × fit) that is valid, not a no-op and
 * not already tried. Every few proposals the loop asks for a wildcard (`explore`), which favours bold
 * or creative ideas that may well lose: that's how the loop learns to reject.
 *
 * LLM mode hands the model the PageSpec JSON schema, the live spec, the insights and the tried
 * history, then validates whatever comes back exactly like a playbook patch. Any failure → playbook.
 */
import { z } from "zod";
import { PageSpecSchema, type ChangeProposal, type Insight, type PageSpec, type SpecPatch } from "@/lib/contracts";
import { describeDiff } from "@/lib/spec/patch";
import { generateJson, llmAvailable, llmLabel } from "@/lib/llm/client";
import { id } from "@/lib/ids";
import { insightKind, type InsightKind } from "./insights";
import { canonicalKey, clamp, normalizePatch, withTimeout } from "./util";

export interface PlaybookIdea {
  title: string;
  patch: SpecPatch;
  hypothesis: string;
  /** Relative lift we'd expect on visitor conversion, e.g. 0.12 = +12%. A prior, not a measurement. */
  expectedLift: number;
  /** A bold bet that could backfire. */
  risky?: boolean;
  /** Copy / visual tweak rather than a friction fix. */
  creative?: boolean;
}

export const IDEAS = {
  shipping_free_threshold: {
    title: "Show delivery cost upfront + free UK delivery over £60",
    patch: {
      cart: { showShippingUpfront: true, freeShippingThreshold: 6000 },
      announcement: { enabled: true, text: "Free UK delivery over £60" },
    },
    hypothesis:
      "Showing the delivery fee in the bag (and waiving it over £60) removes the last-step surprise that kills checkouts, and gives shoppers a reason to finish.",
    expectedLift: 0.18,
  },
  shipping_upfront_only: {
    title: "Show the delivery fee in the bag",
    patch: { cart: { showShippingUpfront: true } },
    hypothesis: "No surprises at the last step: shoppers who reach checkout already know the total.",
    expectedLift: 0.08,
  },
  one_step_checkout: {
    title: "One-page guest checkout with express pay",
    patch: { checkout: { steps: 1, guestCheckout: true, expressPay: true } },
    hypothesis:
      "Collapsing checkout into one page, dropping the forced account and offering Apple Pay / Google Pay removes the exits between 'I want it' and 'paid'.",
    expectedLift: 0.15,
  },
  guest_checkout: {
    title: "Let shoppers check out as a guest",
    patch: { checkout: { guestCheckout: true } },
    hypothesis: "A forced sign-up is a classic checkout killer; guests can still create an account after paying.",
    expectedLift: 0.07,
  },
  express_pay: {
    title: "Add express pay (Apple Pay / Google Pay)",
    patch: { checkout: { expressPay: true } },
    hypothesis: "One-tap wallets skip the address and card forms entirely, especially on mobile.",
    expectedLift: 0.05,
  },
  sticky_cta_reviews: {
    title: "Sticky add-to-bag + reviews + delivery estimate on product pages",
    patch: { productPage: { ctaPosition: "sticky", showReviews: true, showDeliveryEstimate: true } },
    hypothesis:
      "Keeping the button in view, and answering 'is it any good?' and 'when will it arrive?' right next to it, turns browsers into buyers.",
    expectedLift: 0.12,
  },
  above_fold_cta: {
    title: "Move add-to-bag above the fold",
    patch: { productPage: { ctaPosition: "above-fold" } },
    hypothesis: "Shoppers shouldn't have to scroll past the description to buy.",
    expectedLift: 0.06,
  },
  trust_returns: {
    title: "Returns policy, size guide and trust badges on product pages",
    patch: { productPage: { showReturnsPolicy: true, showSizeGuide: true, trustBadges: true } },
    hypothesis: "Fit and returns are the two big worries when buying shoes online; answering both lowers the risk of clicking buy.",
    expectedLift: 0.06,
  },
  urgency_low_stock: {
    title: "Low-stock urgency on product pages",
    patch: { productPage: { urgency: "low-stock", ctaText: "Grab yours before they're gone" } },
    hypothesis:
      "Scarcity cues can push fence-sitters to act now. Risky: urgency can feel pushy and erode trust, and AI agents ignore it entirely.",
    expectedLift: 0.08,
    risky: true,
  },
  hero_social_proof: {
    title: "Social proof + ratings on the homepage",
    patch: {
      hero: { showSocialProof: true, ctaText: "Shop bestsellers" },
      productGrid: { showRatings: true, sort: "bestselling" },
    },
    hypothesis: "Star ratings and a bestsellers-first grid tell new visitors which shoe to click first.",
    expectedLift: 0.05,
  },
  grid_quick_add: {
    title: "Quick-add and ratings on the product grid",
    patch: { productGrid: { showQuickAdd: true, showRatings: true } },
    hypothesis: "Runners who already know their shoe can add it straight from the grid.",
    expectedLift: 0.04,
  },
  hero_copy_bold: {
    title: "Bolder hero: \"Your fastest mile starts here\"",
    patch: {
      hero: {
        headline: "Your fastest mile starts here",
        subheadline: "Performance running shoes, designed and tested in London.",
        ctaText: "Find your pace",
        layout: "split",
      },
    },
    hypothesis: "An outcome-led headline and a clearer call to action give visitors a reason to start browsing.",
    expectedLift: 0.03,
    creative: true,
  },
  accent_orange: {
    title: "High-contrast orange buttons",
    patch: { theme: { accent: "#ea580c", radius: "full" } },
    hypothesis: "A warmer, higher-contrast accent makes primary actions pop. Pure aesthetics: it could just as easily do nothing.",
    expectedLift: 0.02,
    creative: true,
  },
  cart_upsell: {
    title: "\"Complete the look\" cross-sell in the bag",
    patch: { cart: { upsell: true } },
    hypothesis: "Socks and vests next to the shoes raise basket size. Risky: extra choices in the bag can distract from checking out.",
    expectedLift: 0.03,
    risky: true,
  },
  agent_eta: {
    title: "Tell AI shoppers when it arrives: delivery ETA + JSON-LD",
    patch: { agentSurface: { exposeDeliveryEta: true, structuredData: true } },
    hypothesis:
      "Agents shopping to a deadline ('delivered by Friday') can't shortlist a product without a delivery ETA. Exposing it, plus schema.org data, makes us matchable.",
    expectedLift: 0.1,
  },
  agent_returns: {
    title: "Publish the returns policy to agents and shoppers",
    patch: { agentSurface: { exposeReturnPolicy: true }, productPage: { showReturnsPolicy: true } },
    hypothesis: "Many agent briefs require free returns, and humans want the same reassurance. One policy, both audiences.",
    expectedLift: 0.07,
  },
  agent_stock: {
    title: "Expose per-size stock to AI shoppers",
    patch: { agentSurface: { exposeStock: true } },
    hypothesis: "An agent buying a UK 10 won't gamble on availability; live stock lets it commit.",
    expectedLift: 0.06,
  },
  agent_stock_returns: {
    title: "Expose stock levels and returns policy to AI shoppers",
    patch: { agentSurface: { exposeStock: true, exposeReturnPolicy: true } },
    hypothesis: "Size availability and free returns are hard constraints in most agent briefs.",
    expectedLift: 0.08,
  },
  agent_landed_price: {
    title: "Quote landed price (incl. delivery) to AI shoppers",
    patch: { agentSurface: { exposeLandedPrice: true } },
    hypothesis: "Agents compare total cost across stores; without a landed price we lose budget-capped briefs by default.",
    expectedLift: 0.06,
  },
  agent_negotiation: {
    title: "Let AI shoppers negotiate (up to 10% off)",
    patch: { agentSurface: { negotiation: { enabled: true, maxDiscountPct: 10 } } },
    hypothesis:
      "Budget-capped agents walk when the sticker price is over their limit; a merchant agent that can concede up to 10% (never below floor price) wins those sales.",
    expectedLift: 0.07,
  },
  agent_structured: {
    title: "Add schema.org product data for AI shoppers",
    patch: { agentSurface: { structuredData: true } },
    hypothesis: "Structured data lets agents parse products reliably instead of guessing from HTML.",
    expectedLift: 0.03,
  },
} satisfies Record<string, PlaybookIdea>;

export type IdeaKey = keyof typeof IDEAS;

/** Insight kind → candidate ideas, best first, with how well each fits the problem (0..1). */
export const PLAYBOOK: Record<InsightKind, [IdeaKey, number][]> = {
  shipping_shock: [
    ["shipping_free_threshold", 1],
    ["shipping_upfront_only", 0.6],
  ],
  checkout_friction: [
    ["one_step_checkout", 1],
    ["guest_checkout", 0.6],
    ["express_pay", 0.4],
  ],
  weak_add_to_cart: [
    ["sticky_cta_reviews", 1],
    ["urgency_low_stock", 0.8],
    ["trust_returns", 0.7],
    ["above_fold_cta", 0.5],
  ],
  cta_rage_clicks: [
    ["above_fold_cta", 1],
    ["sticky_cta_reviews", 0.9],
  ],
  landing_bounce: [
    ["hero_social_proof", 1],
    ["grid_quick_add", 0.7],
    ["hero_copy_bold", 0.5],
    ["accent_orange", 0.3],
  ],
  cart_stall: [
    ["shipping_free_threshold", 0.9],
    ["express_pay", 0.8],
    ["cart_upsell", 0.4],
  ],
  agent_missing_eta: [["agent_eta", 1]],
  agent_missing_returns: [
    ["agent_returns", 1],
    ["agent_stock_returns", 0.8],
  ],
  agent_missing_stock: [
    ["agent_stock", 1],
    ["agent_stock_returns", 0.9],
  ],
  agent_missing_landed_price: [["agent_landed_price", 1]],
  agent_missing_negotiation: [["agent_negotiation", 1]],
  agent_missing_structured_data: [["agent_structured", 1]],
  agent_blind: [
    ["agent_eta", 1],
    ["agent_stock_returns", 0.9],
    ["agent_landed_price", 0.8],
    ["agent_negotiation", 0.7],
  ],
  agent_abandon: [
    ["agent_negotiation", 0.5],
    ["agent_landed_price", 0.4],
  ],
};

/** Bold ideas the designer reaches for on a wildcard turn. */
const WILDCARDS: IdeaKey[] = ["urgency_low_stock", "hero_copy_bold", "cart_upsell", "accent_orange"];

/** Order of last resort when no insight points anywhere (e.g. brand-new store, no traffic). */
const FALLBACK_ORDER: IdeaKey[] = [
  "shipping_free_threshold",
  "sticky_cta_reviews",
  "one_step_checkout",
  "agent_eta",
  "agent_stock_returns",
  "hero_social_proof",
  "agent_landed_price",
  "agent_negotiation",
  "trust_returns",
  "grid_quick_add",
  ...WILDCARDS,
];

export interface ProposeOptions {
  /** Wildcard turn: prefer a risky/creative idea. */
  explore?: boolean;
}

/** Look up the playbook idea behind a proposal (by title), e.g. to tell the audience it's a risky bet. */
export function ideaForProposal(p: Pick<ChangeProposal, "title">): PlaybookIdea | undefined {
  return Object.values(IDEAS).find((i) => i.title === p.title);
}

/**
 * Heuristic proposal. Returns null only when every applicable idea has been tried or is a no-op.
 * `triedPatches` are compared by canonical JSON, both raw and normalised against the live spec.
 */
export function propose(
  insights: Insight[],
  spec: PageSpec,
  triedPatches: SpecPatch[] = [],
  opts: ProposeOptions = {},
): ChangeProposal | null {
  const tried = new Set(triedPatches.map(canonicalKey));
  interface Option {
    key: IdeaKey;
    idea: PlaybookIdea;
    patch: SpecPatch;
    next: PageSpec;
    score: number;
    insights: Insight[];
  }
  const options = new Map<IdeaKey, Option>();

  const consider = (key: IdeaKey, score: number, insight?: Insight) => {
    const idea: PlaybookIdea = IDEAS[key];
    if (tried.has(canonicalKey(idea.patch))) return;
    const norm = normalizePatch(spec, idea.patch);
    if (!norm || tried.has(canonicalKey(norm.patch))) return;
    const existing = options.get(key);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (insight && !existing.insights.includes(insight)) existing.insights.push(insight);
      return;
    }
    options.set(key, { key, idea, patch: norm.patch, next: norm.next, score, insights: insight ? [insight] : [] });
  };

  insights.forEach((insight, rank) => {
    const kind = insightKind(insight);
    if (!kind) return;
    // Slight preference for the order the analyst (or LLM) ranked insights in.
    const rankFactor = 1 - Math.min(rank, 10) * 0.01;
    for (const [key, fit] of PLAYBOOK[kind]) consider(key, Math.max(insight.impactScore, 0.1) * fit * rankFactor, insight);
  });

  const isBold = (o: Option) => Boolean(o.idea.risky || o.idea.creative);
  let pool = [...options.values()];
  if (opts.explore) {
    if (!pool.some(isBold)) WILDCARDS.forEach((k, i) => consider(k, 0.05 - i * 0.001));
    // Wildcards favour genuinely risky bets over neutral cosmetic ones: that's where the loop learns.
    const bold = [...options.values()].filter(isBold).map((o) => ({ ...o, score: o.score * (o.idea.risky ? 2 : 1) }));
    if (bold.length) pool = bold;
  }
  if (!pool.length) {
    FALLBACK_ORDER.forEach((k, i) => consider(k, 0.01 * (FALLBACK_ORDER.length - i)));
    pool = [...options.values()];
  }
  if (!pool.length) return null;

  pool.sort((a, b) => b.score - a.score);
  const best = pool[0];
  const lead = best.insights[0];
  return {
    id: id("prop"),
    createdAt: new Date().toISOString(),
    insightIds: best.insights.map((i) => i.id),
    title: best.idea.title,
    hypothesis: lead ? `${lead.title}. ${best.idea.hypothesis}` : best.idea.hypothesis,
    patch: best.patch,
    diff: describeDiff(spec, best.next),
    expectedLift: best.idea.expectedLift,
    source: "heuristic",
  };
}

/* ------------------------------------------------------------------ LLM designer */

const LlmProposalSchema = z.object({
  title: z.string().min(3).max(100),
  hypothesis: z.string().min(10).max(600),
  patch: z.record(z.string(), z.unknown()),
  expectedLift: z.number(),
  insightIds: z.array(z.string()).max(6).optional(),
});

export interface TriedIdea {
  title: string;
  patch: SpecPatch;
  outcome: string;
  lift?: number;
}

/**
 * Ask the LLM for one proposal. Returns `{ proposal: null, reason }` whenever the model is unavailable,
 * times out, or suggests something invalid / no-op / already tried; the caller then uses `propose()`.
 */
export async function proposeWithLlm(
  insights: Insight[],
  spec: PageSpec,
  tried: TriedIdea[],
  opts: ProposeOptions = {},
): Promise<{ proposal: ChangeProposal | null; reason?: string }> {
  if (!llmAvailable()) return { proposal: null, reason: "no LLM configured" };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version: _v, label: _l, ...current } = spec;
    const res = await withTimeout(
      generateJson({
        schema: LlmProposalSchema,
        maxTokens: 1500,
        system:
          "You are the designer inside Darwin, a storefront that improves itself for human shoppers AND AI shopping agents. " +
          "You can only change the store through a JSON patch (deep-partial) of its PageSpec. Propose exactly ONE experiment: " +
          "1-3 related knob changes most likely to raise visitor conversion, grounded in the insights. " +
          "Never repeat an idea in alreadyTried. Never set version or label. Copy must be honest: no invented statistics or claims. " +
          'Respond as {"title","hypothesis","patch","expectedLift","insightIds"}; expectedLift is a fraction (0.12 = +12%).',
        prompt: JSON.stringify({
          mode: opts.explore
            ? "WILDCARD: propose a bold or creative idea that is plausible but might backfire"
            : "Fix the biggest leak first",
          pageSpecJsonSchema: z.toJSONSchema(PageSpecSchema),
          currentSpec: current,
          insights: insights.map(({ id: iid, title, detail, audience, stage, evidence, impactScore }) => ({
            id: iid,
            title,
            detail,
            audience,
            stage,
            evidence,
            impactScore,
          })),
          alreadyTried: tried.map((t) => ({ title: t.title, patch: t.patch, outcome: t.outcome, lift: t.lift })),
        }),
      }),
      25_000,
      "LLM proposal",
    );

    const rawPatch = { ...res.patch };
    delete rawPatch.version;
    delete rawPatch.label;
    const norm = normalizePatch(spec, rawPatch as SpecPatch);
    if (!norm) return { proposal: null, reason: "patch was invalid or changed nothing" };
    const triedKeys = new Set(tried.map((t) => canonicalKey(t.patch)));
    if (triedKeys.has(canonicalKey(norm.patch))) return { proposal: null, reason: "patch was already tried" };
    const diff = describeDiff(spec, norm.next);
    if (diff.length > 6) return { proposal: null, reason: `patch touched ${diff.length} knobs (max 6)` };

    const known = new Set(insights.map((i) => i.id));
    const insightIds = (res.insightIds ?? []).filter((i) => known.has(i));
    // Models sometimes answer 12 meaning 12%.
    const lift = Math.abs(res.expectedLift) > 1.5 ? res.expectedLift / 100 : res.expectedLift;
    return {
      proposal: {
        id: id("prop"),
        createdAt: new Date().toISOString(),
        insightIds: insightIds.length ? insightIds : insights.slice(0, 1).map((i) => i.id),
        title: res.title,
        hypothesis: res.hypothesis,
        patch: norm.patch,
        diff,
        expectedLift: clamp(lift, -0.5, 1),
        source: llmLabel(),
      },
    };
  } catch (err) {
    return { proposal: null, reason: err instanceof Error ? err.message.slice(0, 120) : "LLM error" };
  }
}
