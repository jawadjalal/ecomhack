/**
 * In-browser simulation of the whole Darwin loop, used by the console in mock mode
 * (`/console?mock=1`, or automatically for any API group that 404s).
 *
 * It implements the same shapes as the real HTTP API (see contracts/api.ts) so the console
 * code path is identical in both modes. Everything it produces is synthetic and the console
 * labels it as such.
 *
 * The story it tells (per generation, human CR / agent CR):
 *   Gen 0 2.3% / 18%  →  Gen 1 3.1% / 34%  →  Gen 2 3.8% / 52%  →  Gen 3 4.6% / 63%  → …
 * with one honest REJECT along the way.
 */
import {
  FUNNEL_STEPS,
  type AgentSessionSummary,
  type AgentSessionsResponse,
  type AgentToolStat,
  type AnalyticsEvent,
  type AnalyticsEventsResponse,
  type AnalyticsFilter,
  type AnalyticsSummary,
  type ChangeProposal,
  type Experiment,
  type ExperimentResult,
  type ExperimentsResponse,
  type FrictionSignal,
  type GenerationRecord,
  type GithubStatusResponse,
  type Insight,
  type LoopLogEntry,
  type LoopState,
  type NegotiationTurn,
  type PageSpec,
  type SegmentKpis,
  type ShoppingGoal,
  type SpecPatch,
  type VariantStats,
  type VisitorKind,
} from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { describeDiff, tryApplyPatch } from "@/lib/spec/patch";
import { PRODUCTS, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import type { SimulationOptions, SimulationResult } from "@/lib/simulator";
import type { PullRequestResult } from "@/lib/github";

/* ------------------------------------------------------------------ rng */

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

/* ------------------------------------------------------------------ stats */

function erf(x: number) {
  // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

function betaMoments(conv: number, n: number) {
  const a = 1 + conv;
  const b = 1 + Math.max(0, n - conv);
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  return { mean, variance };
}

/** Bayesian P(treatment > control) + 95% interval on relative lift (normal approximation). */
export function compareArms(cConv: number, cN: number, tConv: number, tN: number) {
  const c = betaMoments(cConv, cN);
  const t = betaMoments(tConv, tN);
  const diff = t.mean - c.mean;
  const sd = Math.sqrt(c.variance + t.variance);
  const probabilityToBeat = sd > 0 ? normCdf(diff / sd) : 0.5;
  const crC = cN ? cConv / cN : 0;
  const crT = tN ? tConv / tN : 0;
  const lift = crC > 0 ? (crT - crC) / crC : 0;
  const liftInterval: [number, number] = [(diff - 1.96 * sd) / c.mean, (diff + 1.96 * sd) / c.mean];
  return { probabilityToBeat, lift, liftInterval };
}

/* ------------------------------------------------------------------ script */

/** Conditional funnel rates: visit→view, view→add, add→checkout, checkout→order. */
type Rates = [number, number, number, number];
interface Quality {
  human: Rates;
  agent: Rates;
}
const cr = (r: Rates) => r[0] * r[1] * r[2] * r[3];

interface Attempt {
  outcome: "ship" | "reject";
  short: string;
  insights: Omit<Insight, "id">[];
  proposal: { title: string; hypothesis: string; patch: SpecPatch; expectedLift: number };
  quality: Quality;
  /** Conversion rates recorded for the generation this attempt produces (ship only). */
  record?: { human: number; agent: number };
}

const GEN0: Quality = { human: [0.64, 0.3, 0.52, 0.23], agent: [0.8, 0.4, 0.8, 0.7] };
const GEN0_RECORD = { human: 0.023, agent: 0.18 };

const SCRIPT: Attempt[] = [
  {
    outcome: "ship",
    short: "Shipping upfront + agent ETAs",
    insights: [
      {
        title: "62% of checkouts die when shipping appears",
        audience: "human",
        severity: "high",
        stage: "checkout",
        detail:
          "Shipping (£4.95) is only revealed at the last checkout step. 62% of shoppers who see it leave within 30 seconds.",
        evidence: [
          { label: "abandon after reveal", value: "62%" },
          { label: "shipping fee", value: "£4.95" },
          { label: "median time to exit", value: "18s" },
        ],
        impactScore: 31,
      },
      {
        title: "41% of AI shoppers quit: no delivery ETA",
        audience: "agent",
        severity: "high",
        stage: "agent: get_product",
        detail:
          "Agents with a deadline ask for deliveryEtaDays. The catalog doesn't expose it, so they can't commit and move on.",
        evidence: [
          { label: "missing field", value: "deliveryEtaDays" },
          { label: "agents affected", value: "41%" },
          { label: "top agent", value: "grok-shopper" },
        ],
        impactScore: 74,
      },
      {
        title: "Agents can't compare landed price",
        audience: "agent",
        severity: "medium",
        stage: "agent: search_products",
        detail: "Prices exclude shipping, so price-comparing agents rank PACE below stores that quote a total.",
        evidence: [
          { label: "missing field", value: "landedPrice" },
          { label: "sessions", value: "23%" },
        ],
        impactScore: 18,
      },
      {
        title: "Add to bag is below the fold on mobile",
        audience: "human",
        severity: "medium",
        stage: "product page",
        detail: "The button sits under a long description. Mobile shoppers rage-click the size selector looking for it.",
        evidence: [
          { label: "rage clicks", value: "8%" },
          { label: "reach CTA", value: "29%" },
        ],
        impactScore: 12,
      },
    ],
    proposal: {
      title: "Show shipping in the bag (free over £60) + expose delivery ETA to agents",
      hypothesis:
        "Shipping shock is the biggest human leak and a missing ETA is the biggest agent leak. Showing the cost early, with a free-shipping threshold, removes the surprise; exposing deliveryEtaDays and landed price lets deadline-driven agents commit.",
      patch: {
        cart: { showShippingUpfront: true, freeShippingThreshold: 6000 },
        productPage: { showDeliveryEstimate: true },
        agentSurface: { exposeDeliveryEta: true, exposeLandedPrice: true },
      },
      expectedLift: 0.28,
    },
    quality: { human: [0.64, 0.3, 0.55, 0.294], agent: [0.82, 0.62, 0.84, 0.8] },
    record: { human: 0.031, agent: 0.34 },
  },
  {
    outcome: "ship",
    short: "Sticky CTA + reviews; stock & returns for agents",
    insights: [
      {
        title: "71% never scroll to “Add to bag”",
        audience: "human",
        severity: "high",
        stage: "product page",
        detail: "The CTA sits below a 400-word description. Only 29% of product viewers ever see it; 9% rage-click the size picker.",
        evidence: [
          { label: "reach CTA", value: "29%" },
          { label: "rage clicks", value: "9%" },
          { label: "mobile share", value: "64%" },
        ],
        impactScore: 26,
      },
      {
        title: "38% of agents can't verify stock for their size",
        audience: "agent",
        severity: "high",
        stage: "agent: check_availability",
        detail: "Agents shopping for a specific size call check_availability and get no stock levels back, so they abandon.",
        evidence: [
          { label: "missing field", value: "stock" },
          { label: "agents affected", value: "38%" },
        ],
        impactScore: 61,
      },
      {
        title: "Free-returns agents can't confirm the policy",
        audience: "agent",
        severity: "medium",
        stage: "agent: get_product",
        detail: "PACE offers 60-day free returns but doesn't say so in the catalog, so policy-constrained agents skip it.",
        evidence: [
          { label: "missing field", value: "returnPolicy" },
          { label: "sessions", value: "22%" },
        ],
        impactScore: 21,
      },
      {
        title: "1,284 reviews hidden from product pages",
        audience: "human",
        severity: "medium",
        stage: "product page",
        detail: "Aurora has a 4.7★ rating but the product page shows no reviews or trust badges.",
        evidence: [
          { label: "avg rating", value: "4.7★" },
          { label: "reviews", value: "1,284" },
        ],
        impactScore: 14,
      },
    ],
    proposal: {
      title: "Add to bag above the fold with reviews + expose stock, returns and JSON-LD to agents",
      hypothesis:
        "Most product viewers never reach the CTA and agents can't confirm stock or returns. Moving the button above the fold with social proof, and exposing stock, the returns policy and structured data, should lift both audiences.",
      patch: {
        productPage: { ctaPosition: "above-fold", showReviews: true, trustBadges: true },
        agentSurface: { exposeStock: true, exposeReturnPolicy: true, structuredData: true },
      },
      expectedLift: 0.22,
    },
    quality: { human: [0.65, 0.36, 0.56, 0.29], agent: [0.9, 0.8, 0.85, 0.85] },
    record: { human: 0.038, agent: 0.52 },
  },
  {
    outcome: "ship",
    short: "1-step guest checkout + agent negotiation",
    insights: [
      {
        title: "3-step checkout with forced sign-up loses 44%",
        audience: "human",
        severity: "high",
        stage: "checkout",
        detail: "Shoppers must create an account before paying. 44% of those who start checkout leave at the account wall.",
        evidence: [
          { label: "drop at account wall", value: "44%" },
          { label: "checkout steps", value: "3" },
        ],
        impactScore: 29,
      },
      {
        title: "Negotiating agents walk away: prices are fixed",
        audience: "agent",
        severity: "high",
        stage: "agent: negotiate",
        detail: "31% of agent sessions try to negotiate. The merchant agent can't offer anything, so they buy elsewhere.",
        evidence: [
          { label: "negotiate calls", value: "31%" },
          { label: "declined", value: "100%" },
          { label: "avg ask", value: "−7%" },
        ],
        impactScore: 38,
      },
      {
        title: "No express pay on mobile",
        audience: "human",
        severity: "medium",
        stage: "checkout",
        detail: "64% of checkouts are on mobile, where card entry takes 2+ minutes.",
        evidence: [
          { label: "mobile checkouts", value: "64%" },
          { label: "card entry", value: "2m 10s" },
        ],
        impactScore: 11,
      },
    ],
    proposal: {
      title: "One-step guest checkout with express pay + let agents negotiate up to 8%",
      hypothesis:
        "The account wall is now the biggest human leak, and price-sensitive agents leave when they can't negotiate. A single guest step with express pay, plus a merchant agent allowed to concede up to 8% within margin, should convert both.",
      patch: {
        checkout: { steps: 1, guestCheckout: true, expressPay: true },
        agentSurface: { negotiation: { enabled: true, maxDiscountPct: 8 } },
      },
      expectedLift: 0.2,
    },
    quality: { human: [0.65, 0.37, 0.62, 0.309], agent: [0.92, 0.86, 0.9, 0.885] },
    record: { human: 0.046, agent: 0.63 },
  },
  {
    outcome: "reject",
    short: "Low-stock urgency",
    insights: [
      {
        title: "Shoppers hesitate on product pages (median 48s)",
        audience: "human",
        severity: "medium",
        stage: "product page",
        detail: "Time-to-add is long for first-time visitors; 31% leave the product page without interacting.",
        evidence: [
          { label: "median dwell", value: "48s" },
          { label: "exit without action", value: "31%" },
        ],
        impactScore: 9,
      },
      {
        title: "Hero ignores 12,000 happy runners",
        audience: "human",
        severity: "low",
        stage: "home",
        detail: "The home hero has no social proof; 38% bounce from the landing page.",
        evidence: [{ label: "bounce", value: "38%" }],
        impactScore: 6,
      },
      {
        title: "Agents re-query sizes one by one",
        audience: "agent",
        severity: "low",
        stage: "agent: check_availability",
        detail: "Agents make 4.2 availability calls per session; latency, not conversion.",
        evidence: [{ label: "calls / session", value: "4.2" }],
        impactScore: 4,
      },
    ],
    proposal: {
      title: "Low-stock urgency badges + “Selling fast” announcement bar",
      hypothesis:
        "Hesitation on the product page might be reduced by scarcity cues on sizes that are genuinely low in stock.",
      patch: {
        productPage: { urgency: "low-stock" },
        announcement: { enabled: true, text: "Selling fast: popular sizes are running low" },
      },
      expectedLift: 0.06,
    },
    quality: { human: [0.64, 0.35, 0.6, 0.3], agent: [0.92, 0.86, 0.9, 0.875] },
  },
  {
    outcome: "ship",
    short: "Social-proof hero + quick add",
    insights: [
      {
        title: "Hero ignores 12,000 happy runners",
        audience: "human",
        severity: "medium",
        stage: "home",
        detail: "38% bounce from the landing page. The hero has no rating strip and the grid hides ratings.",
        evidence: [
          { label: "bounce", value: "38%" },
          { label: "avg rating", value: "4.6★" },
        ],
        impactScore: 11,
      },
      {
        title: "Adding from the grid takes 3 clicks",
        audience: "human",
        severity: "medium",
        stage: "collection",
        detail: "Returning runners know what they want but must open each product page to add it.",
        evidence: [
          { label: "returning visitors", value: "27%" },
          { label: "clicks to add", value: "3" },
        ],
        impactScore: 9,
      },
    ],
    proposal: {
      title: "Social-proof hero, ratings on the grid and one-tap quick add",
      hypothesis:
        "Urgency didn't help: hesitation is about trust, not scarcity. Leading with social proof and letting returning runners add straight from the grid should reduce bounce and clicks-to-add.",
      patch: {
        hero: { showSocialProof: true, headline: "Loved by 12,000 London runners" },
        productGrid: { showRatings: true, showQuickAdd: true, sort: "bestselling" },
      },
      expectedLift: 0.08,
    },
    quality: { human: [0.67, 0.38, 0.62, 0.317], agent: [0.93, 0.87, 0.9, 0.9] },
    record: { human: 0.05, agent: 0.66 },
  },
  {
    outcome: "ship",
    short: "Complete-the-look upsell",
    insights: [
      {
        title: "Only 4% of bags include accessories",
        audience: "human",
        severity: "low",
        stage: "cart",
        detail: "Socks and vests are rarely discovered; the bag has no cross-sell.",
        evidence: [{ label: "attach rate", value: "4%" }],
        impactScore: 5,
      },
    ],
    proposal: {
      title: "“Complete the look” cross-sell in the bag",
      hypothesis: "A light cross-sell next to the free-shipping progress bar nudges bags over £60.",
      patch: { cart: { upsell: true } },
      expectedLift: 0.05,
    },
    quality: { human: [0.67, 0.38, 0.63, 0.33], agent: [0.93, 0.88, 0.9, 0.9] },
    record: { human: 0.053, agent: 0.67 },
  },
];

function genericAttempt(n: number, prev: Quality): Attempt {
  const bump = (r: Rates, f: number): Rates => [r[0], r[1], r[2], Math.min(0.95, r[3] * f)];
  const human = bump(prev.human, 1.04);
  const agent = bump(prev.agent, 1.015);
  const ideas: { short: string; title: string; patch: SpecPatch }[] = [
    { short: "Higher-contrast CTA", title: "Higher-contrast add-to-bag button", patch: { theme: { accent: "#15803d" } } },
    { short: "Size guide inline", title: "Inline size guide on product pages", patch: { productPage: { showSizeGuide: true } } },
    { short: "Negotiation margin 10%", title: "Let the merchant agent concede up to 10%", patch: { agentSurface: { negotiation: { enabled: true, maxDiscountPct: 10 } } } },
    { short: "Rounded UI", title: "Friendlier rounded buttons", patch: { theme: { radius: "full" } } },
  ];
  const idea = ideas[n % ideas.length];
  return {
    outcome: "ship",
    short: idea.short,
    insights: [
      {
        title: "Diminishing returns: remaining leaks are small",
        audience: "all",
        severity: "low",
        stage: "store",
        detail: "The big leaks are fixed. Darwin keeps testing small, reversible improvements.",
        evidence: [{ label: "largest remaining leak", value: "<5 / 1k" }],
        impactScore: 4,
      },
    ],
    proposal: {
      title: idea.title,
      hypothesis: "Small, low-risk polish. Kept only if the A/B test says so.",
      patch: idea.patch,
      expectedLift: 0.03,
    },
    quality: { human, agent },
    record: { human: cr(human), agent: cr(agent) },
  };
}

/* ------------------------------------------------------------------ personas */

const HUMAN_PERSONAS = [
  { name: "mobile-skimmer", mobile: true },
  { name: "marathon-planner", mobile: false },
  { name: "bargain-hunter", mobile: true },
  { name: "gift-buyer", mobile: false },
  { name: "returning-runner", mobile: true },
  { name: "trail-curious", mobile: true },
];

const AGENT_NAMES = ["grok-shopper", "claude-buyer", "gpt-shopper", "perplexity-agent", "gemini-shopper"];

const GOALS: (ShoppingGoal & { productId: string })[] = [
  { brief: "Daily trainers, UK 9, under £130, delivered by Friday", category: "road", maxBudget: 13000, size: "9", deadlineDays: 3, productId: "p_aurora" },
  { brief: "Trail shoes, UK 10, under £150, free returns only", category: "trail", maxBudget: 15000, size: "10", requiresFreeReturns: true, productId: "p_ridge" },
  { brief: "Carbon race shoe, UK 8, best price you can get", category: "racing", maxBudget: 21000, size: "8", negotiates: true, productId: "p_velocity" },
  { brief: "Recovery shoes, UK 11, cheapest landed price", category: "road", maxBudget: 9500, size: "11", negotiates: true, productId: "p_city" },
  { brief: "Hydration vest for an ultra next weekend", category: "accessories", maxBudget: 8000, deadlineDays: 5, productId: "p_vest" },
  { brief: "Light tempo shoe, UK 7, under £100", category: "road", maxBudget: 10000, size: "7", productId: "p_tempo" },
];

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ aggregates */

interface KindAgg {
  visitors: number;
  orders: number;
  revenue: number;
  funnel: number[];
  events: number;
}
interface Bucket {
  specVersion: number;
  experimentId?: string;
  variant?: string;
  kinds: Record<VisitorKind, KindAgg>;
  friction: Map<string, FrictionSignal>;
  tools: Map<string, AgentToolStat>;
  firstAt: string;
  lastAt: string;
}

const emptyKind = (): KindAgg => ({ visitors: 0, orders: 0, revenue: 0, funnel: [0, 0, 0, 0, 0], events: 0 });

function sumKpis(aggs: KindAgg[]): SegmentKpis {
  const t = aggs.reduce(
    (acc, a) => {
      acc.visitors += a.visitors;
      acc.orders += a.orders;
      acc.revenue += a.revenue;
      a.funnel.forEach((v, i) => (acc.funnel[i] += v));
      return acc;
    },
    emptyKind(),
  );
  const first = Math.max(1, t.funnel[0]);
  return {
    visitors: t.visitors,
    sessions: t.visitors,
    orders: t.orders,
    revenue: t.revenue,
    conversionRate: t.visitors ? t.funnel[4] / t.visitors : 0,
    averageOrderValue: t.orders ? t.revenue / t.orders : 0,
    funnel: FUNNEL_STEPS.map((step, i) => ({
      step,
      visitors: t.funnel[i],
      rateFromStart: t.funnel[i] / first,
      rateFromPrevious: i === 0 ? 1 : t.funnel[i - 1] ? t.funnel[i] / t.funnel[i - 1] : 0,
    })),
  };
}

/* ------------------------------------------------------------------ engine */

interface ArmCounts {
  human: number;
  agent: number;
}

interface MockExperimentState {
  exp: Experiment;
  attempt: Attempt;
  controlQuality: Quality;
  arms: { control: ArmCounts; treatment: ArmCounts };
  roundPerArm: number;
  rounds: number;
  assigned: ArmCounts;
}

const HUMAN_SHARE = 0.8;
const AOV = { human: 11800, agent: 12400 };
const MAX_EVENTS = 4000;

export interface MockEngineOptions {
  seed?: number;
  /** Artificial latency in ms (0 in tests). */
  latency?: number;
}

export class MockEngine {
  private rng: () => number;
  private latency: number;
  private seq = 0;

  private phase: LoopState["phase"] = "idle";
  private autopilot = false;
  private generation = 0;
  private liveSpec: PageSpec = { ...DEFAULT_SPEC };
  private liveQuality: Quality = GEN0;
  private insights: Insight[] = [];
  private proposal?: ChangeProposal;
  private attemptIndex = 0;
  private currentAttempt?: Attempt;
  private experiment?: MockExperimentState;
  private experiments: Experiment[] = [];
  private history: GenerationRecord[] = [];
  private log: LoopLogEntry[] = [];
  private updatedAt = new Date().toISOString();

  private events: AnalyticsEvent[] = [];
  private buckets = new Map<string, Bucket>();
  private sessions: AgentSessionSummary[] = [];
  private repo?: string;
  private prCounter = 11;

  constructor(opts: MockEngineOptions = {}) {
    this.rng = mulberry32(opts.seed ?? 20260926);
    this.latency = opts.latency ?? 120;
  }

  /* ---------------------------------------------------------------- helpers */

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq.toString(36)}${Math.floor(this.rng() * 1e8).toString(36)}`;
  }

  private uuid() {
    const hex = () => Math.floor(this.rng() * 0x10000).toString(16).padStart(4, "0");
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)];
  }

  private async wait(ms = this.latency) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private say(actor: LoopLogEntry["actor"], message: string, data?: unknown) {
    this.log.push({ at: new Date().toISOString(), phase: this.phase, actor, message, data });
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
  }

  private touch() {
    this.updatedAt = new Date().toISOString();
  }

  private attemptAt(i: number): Attempt {
    return SCRIPT[i] ?? genericAttempt(i, this.liveQuality);
  }

  private bucket(specVersion: number, experimentId?: string, variant?: string): Bucket {
    const key = `${specVersion}|${experimentId ?? "-"}|${variant ?? "-"}`;
    let b = this.buckets.get(key);
    if (!b) {
      const now = new Date().toISOString();
      b = {
        specVersion,
        experimentId,
        variant,
        kinds: { human: emptyKind(), agent: emptyKind() },
        friction: new Map(),
        tools: new Map(),
        firstAt: now,
        lastAt: now,
      };
      this.buckets.set(key, b);
    }
    return b;
  }

  private friction(b: Bucket, sig: Omit<FrictionSignal, "count" | "share">) {
    const key = `${sig.kind}|${sig.audience}|${sig.location}|${sig.detail ?? ""}`;
    const cur = b.friction.get(key);
    if (cur) cur.count += 1;
    else b.friction.set(key, { ...sig, count: 1, share: 0 });
  }

  private tool(b: Bucket, tool: string, ok: boolean, missing: string[] = []) {
    const cur = b.tools.get(tool) ?? { tool, calls: 0, errors: 0, missing: {} };
    cur.calls += 1;
    if (!ok) cur.errors += 1;
    for (const m of missing) cur.missing[m] = (cur.missing[m] ?? 0) + 1;
    b.tools.set(tool, cur);
  }

  /* ---------------------------------------------------------------- traffic */

  private simulateVisitor(kind: VisitorKind, emit: boolean, at: number) {
    const exp = this.experiment && this.experiment.exp.status === "running" ? this.experiment : undefined;
    let variant: "control" | "treatment" | undefined;
    let spec = this.liveSpec;
    let quality = this.liveQuality;
    if (exp) {
      // stratified alternation per visitor kind keeps the human/agent mix identical in both arms
      exp.assigned[kind] += 1;
      variant = exp.assigned[kind] % 2 === 0 ? "treatment" : "control";
      if (variant === "treatment") {
        spec = exp.exp.treatmentSpec;
        quality = exp.attempt.quality;
      }
      exp.arms[variant][kind] += 1;
    }
    const b = this.bucket(spec.version, exp?.exp.id, variant);
    const agg = b.kinds[kind];
    agg.visitors += 1;
    b.lastAt = new Date(at).toISOString();

    const events: AnalyticsEvent[] = [];
    const distinctId = kind === "agent" ? `agent_${this.id("a").slice(2)}` : `v_${this.id("h").slice(2)}`;
    const sessionId = this.id("s");
    let t = at;
    const base = {
      visitor_kind: kind,
      synthetic: true,
      spec_version: spec.version,
      $session_id: sessionId,
      ...(exp ? { experiment_id: exp.exp.id, variant } : {}),
    };
    const push = (event: string, props: Record<string, unknown> = {}) => {
      agg.events += 1;
      t += 40 + Math.floor(this.rng() * 260);
      if (emit) {
        events.push({ uuid: this.uuid(), event, distinct_id: distinctId, timestamp: new Date(t).toISOString(), properties: { ...base, ...props } });
      }
    };

    const r = quality[kind];
    if (kind === "human") this.humanJourney(spec, r, agg, b, push);
    else this.agentJourney(spec, r, agg, b, push, distinctId, sessionId, exp?.exp.id, variant, at);

    if (emit) {
      this.events.push(...events);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  private humanJourney(spec: PageSpec, r: Rates, agg: KindAgg, b: Bucket, push: (e: string, p?: Record<string, unknown>) => void) {
    const persona = this.pick(HUMAN_PERSONAS);
    const product = this.pickProduct();
    const sizes = Object.entries(product.stock).filter(([, q]) => q > 0).map(([s]) => s);
    const size = sizes.length ? this.pick(sizes) : undefined;
    const common = { persona: persona.name, $device_type: persona.mobile ? "Mobile" : "Desktop" };
    push("$pageview", { ...common, $pathname: "/store" });
    agg.funnel[0] += 1;
    if (this.rng() >= r[0]) return;
    push("product_viewed", { ...common, product_id: product.id, price: product.price, $pathname: `/store/products/${product.slug}` });
    agg.funnel[1] += 1;
    if (spec.productPage.ctaPosition === "below-description" && this.rng() < 0.09) {
      push("$rageclick", { ...common, element: "size selector" });
      this.friction(b, { kind: "rage_click", audience: "human", location: "product page · size selector" });
    }
    if (this.rng() >= r[1]) {
      if (spec.productPage.ctaPosition === "below-description" && this.rng() < 0.5) {
        this.friction(b, { kind: "dead_end", audience: "human", location: "product page", detail: "never reached Add to bag" });
      }
      return;
    }
    push("product_added", { ...common, product_id: product.id, price: product.price, size, quantity: 1 });
    agg.funnel[2] += 1;
    if (this.rng() >= r[2]) {
      if (!spec.checkout.guestCheckout && this.rng() < 0.5) {
        this.friction(b, { kind: "dead_end", audience: "human", location: "checkout · account wall" });
      }
      return;
    }
    const shipping =
      spec.cart.freeShippingThreshold !== null && product.price >= spec.cart.freeShippingThreshold ? 0 : SHIPPING_FEE;
    push("checkout_started", { ...common, value: product.price, product_id: product.id });
    agg.funnel[3] += 1;
    if (!spec.cart.showShippingUpfront && shipping > 0) push("shipping_cost_revealed", { ...common, shipping });
    if (this.rng() >= r[3]) {
      const shock = !spec.cart.showShippingUpfront && shipping > 0 && this.rng() < 0.7;
      const reason = shock ? "surprise shipping cost" : !spec.checkout.guestCheckout ? "account required" : "left at payment";
      push("checkout_abandoned", { ...common, reason, product_id: product.id });
      if (shock) this.friction(b, { kind: "shipping_shock", audience: "human", location: "checkout · shipping step" });
      return;
    }
    const revenue = product.price + shipping;
    push("order_completed", { ...common, product_id: product.id, revenue, price: product.price, quantity: 1 });
    agg.funnel[4] += 1;
    agg.orders += 1;
    agg.revenue += revenue;
  }

  private pickProduct(): Product {
    const weights = PRODUCTS.map((p) => 1 / p.bestsellerRank);
    const total = weights.reduce((a, w) => a + w, 0);
    let x = this.rng() * total;
    for (let i = 0; i < PRODUCTS.length; i++) {
      x -= weights[i];
      if (x <= 0) return PRODUCTS[i];
    }
    return PRODUCTS[0];
  }

  private agentJourney(
    spec: PageSpec,
    r: Rates,
    agg: KindAgg,
    b: Bucket,
    push: (e: string, p?: Record<string, unknown>) => void,
    distinctId: string,
    sessionId: string,
    experimentId: string | undefined,
    variant: string | undefined,
    at: number,
  ) {
    const agentName = this.pick(AGENT_NAMES);
    const goal = this.pick(GOALS);
    const product = PRODUCT_BY_ID.get(goal.productId) ?? PRODUCTS[0];
    const s = spec.agentSurface;
    const calls: AgentSessionSummary["toolCalls"] = [];
    let clock = at;
    const call = (tool: string, ok: boolean, missing?: string[]) => {
      clock += 300 + Math.floor(this.rng() * 900);
      calls.push({ tool, ok, missing: missing?.length ? missing : undefined, at: new Date(clock).toISOString() });
      this.tool(b, tool, ok, missing);
      push("agent_request", { agent_name: agentName, tool, ok, ...(missing?.length ? { missing } : {}), product_id: product.id });
    };
    const summary: AgentSessionSummary = {
      sessionId,
      agentName,
      goal: { brief: goal.brief, category: goal.category, maxBudget: goal.maxBudget, size: goal.size, deadlineDays: goal.deadlineDays, requiresFreeReturns: goal.requiresFreeReturns, negotiates: goal.negotiates },
      startedAt: new Date(at).toISOString(),
      outcome: "in_progress",
      toolCalls: calls,
      experimentId,
      variant,
      synthetic: true,
    };
    const abandon = (reason: string, missing?: string) => {
      summary.outcome = "abandoned";
      summary.reason = reason;
      push("agent_abandoned", { agent_name: agentName, reason, product_id: product.id });
      this.friction(b, { kind: "agent_abandoned", audience: "agent", location: calls.at(-1)?.tool ?? "search_products", detail: reason });
      if (missing) this.friction(b, { kind: "agent_missing_field", audience: "agent", location: calls.at(-1)?.tool ?? "get_product", detail: missing });
    };
    const finish = () => {
      this.sessions.unshift(summary);
      if (this.sessions.length > 40) this.sessions.length = 40;
    };

    // 1. discover
    call("search_products", true);
    agg.funnel[0] += 1;
    if (this.rng() >= r[0]) {
      abandon(s.structuredData ? "nothing matched the brief" : "no structured product data to compare");
      return finish();
    }
    // 2. product data
    const wanted: string[] = [];
    if (goal.deadlineDays && !s.exposeDeliveryEta) wanted.push("deliveryEtaDays");
    if (goal.requiresFreeReturns && !s.exposeReturnPolicy) wanted.push("returnPolicy");
    if (goal.negotiates && !s.exposeLandedPrice) wanted.push("landedPrice");
    call("get_product", true, wanted);
    push("product_viewed", { agent_name: agentName, product_id: product.id, price: product.price });
    agg.funnel[1] += 1;
    if (goal.size) {
      const stockMissing = s.exposeStock ? [] : ["stock"];
      call("check_availability", s.exposeStock, stockMissing);
    }
    if (this.rng() >= r[1]) {
      const missing = [...wanted, ...(goal.size && !s.exposeStock ? ["stock"] : [])];
      const reasons: Record<string, string> = {
        deliveryEtaDays: "no delivery ETA exposed",
        stock: `can't verify stock for UK ${goal.size ?? "size"}`,
        returnPolicy: "return policy not exposed",
        landedPrice: "landed price unknown",
      };
      const first = missing[0];
      abandon(first ? reasons[first] : "found a better match elsewhere", first);
      return finish();
    }
    // 3. cart (+ negotiation)
    call("add_to_cart", true);
    push("product_added", { agent_name: agentName, product_id: product.id, price: product.price, size: goal.size, quantity: 1 });
    agg.funnel[2] += 1;
    let price = product.price;
    if (goal.negotiates) {
      const ask = Math.round((product.price * 0.9) / 100) * 100;
      const turns: NegotiationTurn[] = [{ from: "buyer", message: `My principal's budget is tight. Would you do ${fmt(ask)} for the ${product.name}?`, offer: ask }];
      if (s.negotiation.enabled) {
        const counter = Math.max(product.floorPrice, Math.round((product.price * (1 - s.negotiation.maxDiscountPct / 100 * 0.75)) / 100) * 100);
        turns.push({ from: "merchant", message: `I can't go that low, but I can do ${fmt(counter)} with free 2-day delivery if you check out now.`, offer: counter });
        turns.push({ from: "buyer", message: "Deal. Proceeding to checkout.", offer: counter });
        price = counter;
      } else {
        turns.push({ from: "merchant", message: "Sorry, prices are fixed and I'm not able to offer a discount." });
      }
      summary.negotiation = turns;
      call("negotiate", s.negotiation.enabled);
      for (const turn of turns) push("agent_negotiation", { agent_name: agentName, from: turn.from, message: turn.message, offer: turn.offer });
    }
    if (this.rng() >= r[2]) {
      abandon(goal.negotiates && !s.negotiation.enabled ? "wanted a discount; merchant can't negotiate" : "over budget after shipping");
      return finish();
    }
    push("checkout_started", { agent_name: agentName, value: price, product_id: product.id });
    agg.funnel[3] += 1;
    // 4. checkout
    if (this.rng() >= r[3]) {
      call("checkout", false);
      abandon(spec.checkout.guestCheckout ? "payment declined by principal" : "checkout requires creating an account");
      return finish();
    }
    call("checkout", true);
    const shipping = spec.cart.freeShippingThreshold !== null && price >= spec.cart.freeShippingThreshold ? 0 : SHIPPING_FEE;
    const revenue = price + shipping;
    push("order_completed", { agent_name: agentName, product_id: product.id, revenue, price, quantity: 1 });
    agg.funnel[4] += 1;
    agg.orders += 1;
    agg.revenue += revenue;
    summary.outcome = "purchased";
    summary.orderTotal = revenue;
    finish();
  }

  private runTraffic(humans: number, agents: number, emitEvery: number, spreadMs = 1400) {
    const now = Date.now();
    const kinds: VisitorKind[] = [...Array(humans).fill("human"), ...Array(agents).fill("agent")];
    // interleave so agents don't all arrive last
    kinds.sort(() => this.rng() - 0.5);
    kinds.forEach((kind, i) => {
      const at = now - spreadMs + Math.floor((spreadMs * i) / Math.max(1, kinds.length));
      this.simulateVisitor(kind, emitEvery > 0 && i % emitEvery === 0, at);
    });
  }

  private liveVisitors() {
    let n = 0;
    for (const b of this.buckets.values()) {
      if (b.specVersion === this.liveSpec.version && !b.variant) n += b.kinds.human.visitors + b.kinds.agent.visitors;
    }
    return n;
  }

  /* ---------------------------------------------------------------- experiment maths */

  private experimentResult(state: MockExperimentState): ExperimentResult {
    const stats = (arm: "control" | "treatment"): VariantStats => {
      const q = arm === "control" ? state.controlQuality : state.attempt.quality;
      const counts = state.arms[arm];
      const byKind = {} as VariantStats["byKind"];
      let conversions = 0;
      let revenue = 0;
      for (const kind of ["human", "agent"] as const) {
        const v = counts[kind];
        const c = Math.round(v * cr(q[kind]));
        byKind[kind] = { visitors: v, conversions: c, conversionRate: v ? c / v : 0 };
        conversions += c;
        revenue += c * AOV[kind];
      }
      const visitors = counts.human + counts.agent;
      return { variant: arm, visitors, conversions, revenue, conversionRate: visitors ? conversions / visitors : 0, byKind };
    };
    const control = stats("control");
    const treatment = stats("treatment");
    const cmp = compareArms(control.conversions, control.visitors, treatment.conversions, treatment.visitors);
    return { control, treatment, ...cmp, decision: state.exp.result?.decision ?? "running" };
  }

  private refreshExperiment() {
    if (!this.experiment) return;
    const e = this.experiment.exp;
    const decision = e.result?.decision ?? "running";
    e.result = { ...this.experimentResult(this.experiment), decision };
  }

  private conclusion(): ExperimentResult["decision"] {
    const st = this.experiment;
    if (!st?.exp.result) return "running";
    const p = st.exp.result.probabilityToBeat;
    if (p >= 0.965) return "ship";
    if (p <= 0.2 && st.rounds >= 3) return "reject";
    if (st.rounds >= 7) return "inconclusive";
    return "running";
  }

  /* ---------------------------------------------------------------- loop */

  private snapshot(): LoopState {
    return structuredClone({
      phase: this.phase,
      autopilot: this.autopilot,
      generation: this.generation,
      liveSpec: this.liveSpec,
      insights: this.insights,
      proposal: this.proposal,
      experimentId: this.experiment?.exp.id,
      history: this.history,
      log: this.log,
      updatedAt: this.updatedAt,
    });
  }

  private recordGen0() {
    if (this.history.length) return;
    this.history.push({
      generation: 0,
      specVersion: this.liveSpec.version,
      label: this.liveSpec.label || "Baseline",
      humanConversionRate: GEN0_RECORD.human,
      agentConversionRate: GEN0_RECORD.agent,
      overallConversionRate: HUMAN_SHARE * GEN0_RECORD.human + (1 - HUMAN_SHARE) * GEN0_RECORD.agent,
      shippedAt: new Date().toISOString(),
    });
  }

  private doStep() {
    switch (this.phase) {
      case "idle": {
        this.phase = "observe";
        if (this.liveVisitors() < 300) this.runTraffic(480, 120, 0, 30 * 60_000);
        this.recordGen0();
        const n = this.liveVisitors();
        this.say("observer", `Watching Gen ${this.generation} (“${this.liveSpec.label}”): ${n.toLocaleString("en-GB")} sessions so far, humans and AI agents.`);
        break;
      }
      case "observe": {
        if (this.liveVisitors() < 300) this.runTraffic(240, 60, 0, 10 * 60_000);
        this.phase = "diagnose";
        this.currentAttempt = this.attemptAt(this.attemptIndex);
        this.insights = this.currentAttempt.insights
          .map((i) => ({ ...i, id: this.id("ins") }))
          .sort((a, b) => b.impactScore - a.impactScore);
        const top = this.insights[0];
        this.say("analyst", `Found ${this.insights.length} conversion leaks. Biggest: ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}.`, { insights: this.insights });
        break;
      }
      case "diagnose": {
        const a = this.currentAttempt ?? this.attemptAt(this.attemptIndex);
        const treatment = tryApplyPatch(this.liveSpec, a.proposal.patch) ?? this.liveSpec;
        this.proposal = {
          id: this.id("prop"),
          createdAt: new Date().toISOString(),
          insightIds: this.insights.slice(0, 2).map((i) => i.id),
          title: a.proposal.title,
          hypothesis: a.proposal.hypothesis,
          patch: a.proposal.patch,
          diff: describeDiff(this.liveSpec, treatment),
          expectedLift: a.proposal.expectedLift,
          source: "llm:grok-4",
        };
        this.phase = "propose";
        this.say("designer", `Proposal: ${a.proposal.title}. Expected lift ${Math.round(a.proposal.expectedLift * 100)}%.`, { proposal: this.proposal });
        break;
      }
      case "propose": {
        const a = this.currentAttempt ?? this.attemptAt(this.attemptIndex);
        const treatmentSpec: PageSpec = {
          ...(tryApplyPatch(this.liveSpec, a.proposal.patch) ?? this.liveSpec),
          version: this.liveSpec.version + 1,
          label: `Candidate: ${a.short}`,
        };
        // fresh stats for the candidate version (a previous rejected candidate may have used it)
        for (const [k, b] of this.buckets) if (b.specVersion === treatmentSpec.version) this.buckets.delete(k);
        const exp: Experiment = {
          id: this.id("exp"),
          name: a.short,
          status: "running",
          createdAt: new Date().toISOString(),
          proposalId: this.proposal?.id ?? "",
          controlVersion: this.liveSpec.version,
          treatmentSpec,
          allocation: 0.5,
          primaryMetric: "order_completed",
        };
        const pc = HUMAN_SHARE * cr(this.liveQuality.human) + (1 - HUMAN_SHARE) * cr(this.liveQuality.agent);
        const pt = HUMAN_SHARE * cr(a.quality.human) + (1 - HUMAN_SHARE) * cr(a.quality.agent);
        const z = a.outcome === "ship" ? 1.9 : 1.0;
        const need = (z * z * (pc * (1 - pc) + pt * (1 - pt))) / Math.max(1e-6, (pt - pc) ** 2);
        this.experiment = {
          exp,
          attempt: a,
          controlQuality: this.liveQuality,
          arms: { control: { human: 0, agent: 0 }, treatment: { human: 0, agent: 0 } },
          roundPerArm: Math.min(2000, Math.max(40, Math.ceil(need / 4))),
          rounds: 0,
          assigned: { human: 0, agent: 0 },
        };
        this.experiments.push(exp);
        this.phase = "experiment";
        this.say("experimenter", `Started A/B test “${a.short}”: 50/50 split on humans and agents, primary metric order_completed.`, { experimentId: exp.id });
        this.experimentRound();
        break;
      }
      case "experiment": {
        const verdict = this.conclusion();
        if (verdict === "running") {
          this.experimentRound();
          break;
        }
        this.decide(verdict);
        break;
      }
      case "decide": {
        const st = this.experiment;
        const decision = st?.exp.result?.decision;
        if (decision === "ship" && st) this.ship(st);
        else {
          this.attemptIndex += 1;
          this.currentAttempt = undefined;
          this.proposal = undefined;
          this.insights = [];
          this.phase = "observe";
          this.say("system", `Back to observing Gen ${this.generation}. The live store is unchanged.`);
        }
        break;
      }
      case "ship": {
        this.phase = "observe";
        this.insights = [];
        this.proposal = undefined;
        this.say("observer", `Watching Gen ${this.generation} (“${this.liveSpec.label}”) with fresh eyes.`);
        break;
      }
    }
    this.touch();
  }

  private experimentRound() {
    const st = this.experiment;
    if (!st) return;
    st.rounds += 1;
    const total = st.roundPerArm * 2;
    const humans = Math.round(total * HUMAN_SHARE);
    this.runTraffic(humans, total - humans, Math.max(10, Math.round(total / 60)), 2_000);
    this.refreshExperiment();
    const r = st.exp.result!;
    const verdict = this.conclusion();
    const msg =
      verdict === "running"
        ? `Round ${st.rounds}: treatment ${(r.treatment.conversionRate * 100).toFixed(1)}% vs control ${(r.control.conversionRate * 100).toFixed(1)}%, P(beat) ${r.probabilityToBeat.toFixed(2)}. Collecting more traffic.`
        : `Round ${st.rounds}: P(beat) ${r.probabilityToBeat.toFixed(2)} on ${(r.control.visitors + r.treatment.visitors).toLocaleString("en-GB")} visitors. That's conclusive.`;
    this.say("experimenter", msg);
  }

  private decide(verdict: ExperimentResult["decision"]) {
    const st = this.experiment!;
    this.refreshExperiment();
    st.exp.result!.decision = verdict;
    st.exp.status = "completed";
    st.exp.completedAt = new Date().toISOString();
    this.phase = "decide";
    const r = st.exp.result!;
    const lift = `${r.lift >= 0 ? "+" : "−"}${Math.abs(Math.round(r.lift * 100))}%`;
    if (verdict === "ship") this.say("experimenter", `Decision: SHIP. Conversion ${lift} with P(beat) = ${r.probabilityToBeat.toFixed(2)}.`, { result: r });
    else if (verdict === "reject") this.say("experimenter", `Decision: REJECT. Conversion ${lift}, P(beat) = ${r.probabilityToBeat.toFixed(2)}. Not shipping a loser.`, { result: r });
    else this.say("experimenter", `Decision: INCONCLUSIVE after ${st.rounds} rounds. Keeping the current store.`, { result: r });
  }

  private ship(st: MockExperimentState) {
    const a = st.attempt;
    const nextGen = this.generation + 1;
    const spec: PageSpec = { ...st.exp.treatmentSpec, label: `Gen ${nextGen}: ${a.short}` };
    this.liveSpec = spec;
    this.liveQuality = a.quality;
    this.generation = nextGen;
    this.phase = "ship";
    this.prCounter += 1;
    const slug = a.short.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const r = st.exp.result!;
    const pr: PullRequestResult = {
      dryRun: true,
      number: this.prCounter,
      branch: `darwin/gen-${nextGen}-${slug}`,
      title: `Darwin Gen ${nextGen}: ${a.proposal.title}`,
      body: [
        `## ${a.proposal.title}`,
        "",
        a.proposal.hypothesis,
        "",
        "### Experiment",
        `- Control: ${(r.control.conversionRate * 100).toFixed(2)}% (${r.control.visitors} visitors)`,
        `- Treatment: ${(r.treatment.conversionRate * 100).toFixed(2)}% (${r.treatment.visitors} visitors)`,
        `- Lift: ${(r.lift * 100).toFixed(1)}% · P(beat) ${r.probabilityToBeat.toFixed(3)}`,
        "",
        "### Changes",
        ...(this.proposal?.diff ?? []).map((d) => `- \`${d}\``),
        "",
        "_Opened by Darwin. Simulated traffic (mock mode)._",
      ].join("\n"),
      files: [{ path: "apps/web/storefront.config.json", content: JSON.stringify(spec, null, 2) + "\n" }],
    };
    this.history.push({
      generation: nextGen,
      specVersion: spec.version,
      label: a.short,
      humanConversionRate: a.record?.human ?? cr(a.quality.human),
      agentConversionRate: a.record?.agent ?? cr(a.quality.agent),
      overallConversionRate: HUMAN_SHARE * (a.record?.human ?? cr(a.quality.human)) + (1 - HUMAN_SHARE) * (a.record?.agent ?? cr(a.quality.agent)),
      experimentId: st.exp.id,
      lift: r.lift,
      prUrl: pr.url,
      shippedAt: new Date().toISOString(),
    });
    this.attemptIndex += 1;
    this.currentAttempt = undefined;
    this.say("shipper", `Promoted “${a.short}” to live as spec v${spec.version} and opened PR #${pr.number} (dry run): ${pr.title}.`, pr);
    this.say("system", `Generation ${nextGen} is live.`);
  }

  /* ---------------------------------------------------------------- public API (mirrors HTTP) */

  async getLoop(): Promise<LoopState> {
    await this.wait(20);
    return this.snapshot();
  }

  async stepLoop(): Promise<LoopState> {
    // propose is where an LLM would think; make it feel like it
    await this.wait(this.phase === "diagnose" ? Math.max(this.latency, this.latency * 8) : this.latency);
    this.doStep();
    return this.snapshot();
  }

  async setAutopilot(on: boolean): Promise<LoopState> {
    await this.wait();
    this.autopilot = on;
    this.say("system", on ? "Autopilot on: Darwin will keep improving the store on its own." : "Autopilot off.");
    this.touch();
    return this.snapshot();
  }

  async resetLoop(): Promise<LoopState> {
    await this.wait();
    const fresh = new MockEngine({ latency: this.latency });
    Object.assign(this, fresh, { repo: this.repo });
    this.say("system", "Reset to Gen 0. Events, experiments and history cleared.");
    return this.snapshot();
  }

  async getExperiments(): Promise<ExperimentsResponse> {
    await this.wait(20);
    return { experiments: structuredClone(this.experiments) };
  }

  async simulate(opts: SimulationOptions): Promise<SimulationResult> {
    await this.wait(40);
    const before = this.events.length;
    const ordersBefore = this.totalOrders();
    this.runTraffic(opts.humans, opts.agents, 1, Math.max(1400, (opts.spreadMinutes ?? 0) * 60_000));
    if (this.experiment?.exp.status === "running") this.refreshExperiment();
    const after = this.totalOrders();
    return {
      humans: opts.humans,
      agents: opts.agents,
      events: this.events.length - before,
      orders: after.count - ordersBefore.count,
      revenue: after.revenue - ordersBefore.revenue,
      byVariant: {},
    };
  }

  private totalOrders() {
    let count = 0;
    let revenue = 0;
    for (const b of this.buckets.values()) {
      for (const k of ["human", "agent"] as const) {
        count += b.kinds[k].orders;
        revenue += b.kinds[k].revenue;
      }
    }
    return { count, revenue };
  }

  async getSummary(filter: AnalyticsFilter = {}): Promise<AnalyticsSummary> {
    await this.wait(30);
    const bs = [...this.buckets.values()].filter(
      (b) =>
        (filter.specVersion === undefined || b.specVersion === filter.specVersion) &&
        (!filter.experimentId || b.experimentId === filter.experimentId) &&
        (!filter.variant || b.variant === filter.variant),
    );
    const kinds: VisitorKind[] = filter.visitorKind ? [filter.visitorKind] : ["human", "agent"];
    const byKind = {
      human: sumKpis(kinds.includes("human") ? bs.map((b) => b.kinds.human) : []),
      agent: sumKpis(kinds.includes("agent") ? bs.map((b) => b.kinds.agent) : []),
    };
    const frictionMap = new Map<string, FrictionSignal>();
    for (const b of bs) {
      for (const [k, f] of b.friction) {
        if (!kinds.includes(f.audience)) continue;
        const cur = frictionMap.get(k);
        if (cur) cur.count += f.count;
        else frictionMap.set(k, { ...f });
      }
    }
    const friction = [...frictionMap.values()]
      .map((f) => ({ ...f, share: byKind[f.audience].visitors ? f.count / byKind[f.audience].visitors : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    const toolMap = new Map<string, AgentToolStat>();
    if (kinds.includes("agent")) {
      for (const b of bs) {
        for (const t of b.tools.values()) {
          const cur = toolMap.get(t.tool) ?? { tool: t.tool, calls: 0, errors: 0, missing: {} };
          cur.calls += t.calls;
          cur.errors += t.errors;
          for (const [m, n] of Object.entries(t.missing)) cur.missing[m] = (cur.missing[m] ?? 0) + n;
          toolMap.set(t.tool, cur);
        }
      }
    }
    const times = bs.flatMap((b) => [b.firstAt, b.lastAt]).sort();
    const now = new Date().toISOString();
    return {
      from: times[0] ?? now,
      to: times.at(-1) ?? now,
      totalEvents: bs.reduce((n, b) => n + b.kinds.human.events + b.kinds.agent.events, 0),
      overall: sumKpis(bs.flatMap((b) => kinds.map((k) => b.kinds[k]))),
      byKind,
      friction,
      agentTools: [...toolMap.values()],
      filter,
    };
  }

  async getEvents(after?: string, limit = 100): Promise<AnalyticsEventsResponse> {
    await this.wait(20);
    let start = 0;
    if (after) {
      const idx = this.events.findIndex((e) => e.uuid === after);
      start = idx === -1 ? Math.max(0, this.events.length - limit) : idx + 1;
    } else {
      start = Math.max(0, this.events.length - limit);
    }
    const slice = this.events.slice(start).slice(-limit);
    return { events: structuredClone(slice), cursor: this.events.at(-1)?.uuid ?? after };
  }

  async getSessions(limit = 20): Promise<AgentSessionsResponse> {
    await this.wait(30);
    return { sessions: structuredClone(this.sessions.slice(0, limit)) };
  }

  async getGithubStatus(): Promise<GithubStatusResponse> {
    await this.wait(20);
    return { configured: false, repo: this.repo };
  }

  async connectRepo(repoUrl: string): Promise<PullRequestResult> {
    await this.wait(Math.max(this.latency, this.latency * 10));
    const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(repoUrl.trim()) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(repoUrl.trim());
    if (!m) throw new Error("Use a GitHub URL like https://github.com/acme/storefront");
    this.repo = `${m[1]}/${m[2]}`;
    this.say("system", `Connected ${this.repo}. Opened a PR installing Darwin analytics (dry run).`);
    this.touch();
    return {
      dryRun: true,
      number: 11,
      branch: "darwin/install-analytics",
      title: "Install Darwin analytics (humans + AI agents)",
      body: [
        "Darwin watches how **humans and AI shopping agents** use your store, then proposes, tests and ships improvements as PRs.",
        "",
        "This PR:",
        "- adds a PostHog-compatible tracker that posts to Darwin's `/ingest` endpoint",
        "- tags every event with `visitor_kind` (human | agent) and experiment attribution",
        "- publishes `/llms.txt` and an agent card so shopping agents can discover the store",
        "",
        "_Dry run: no GITHUB_TOKEN configured._",
      ].join("\n"),
      files: [
        {
          path: "src/app/darwin-analytics.tsx",
          content: [
            '"use client";',
            'import posthog from "posthog-js";',
            'import { useEffect } from "react";',
            "",
            "export function DarwinAnalytics() {",
            "  useEffect(() => {",
            '    posthog.init("darwin", { api_host: process.env.NEXT_PUBLIC_DARWIN_HOST + "/ingest", autocapture: true });',
            '    posthog.register({ visitor_kind: "human" });',
            "  }, []);",
            "  return null;",
            "}",
          ].join("\n"),
        },
        {
          path: "src/app/layout.tsx",
          content: ['import { DarwinAnalytics } from "./darwin-analytics";', "", "// …", "<body>", "  <DarwinAnalytics />", "  {children}", "</body>"].join("\n"),
        },
        { path: ".env.example", content: "NEXT_PUBLIC_DARWIN_HOST=https://darwin.example.com\n" },
      ],
    };
  }
}

function fmt(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------ singleton */

let engine: MockEngine | undefined;

/** The page-wide mock engine (one per browser tab). */
export function mockEngine(): MockEngine {
  engine ??= new MockEngine();
  return engine;
}
