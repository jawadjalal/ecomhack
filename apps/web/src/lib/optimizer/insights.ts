/**
 * Analyst: turn an AnalyticsSummary (+ the live PageSpec) into ranked, human-readable insights.
 *
 * Heuristic rules over funnel step rates, friction signals and agent tool stats. Every insight cites
 * the real numbers it is based on (`evidence`) and carries `impactScore` ≈ estimated orders lost per
 * 1,000 sessions, used for ranking. When the analytics module provides no friction/agent-tool data,
 * the rules fall back to funnel shape + what the spec is known to hide. With (almost) no traffic at
 * all, we return a clearly-labelled spec audit instead of pretending to have numbers.
 *
 * Optional LLM pass (`refineInsightsWithLlm`) rewrites titles/details and re-orders the list, but may
 * never introduce a number that isn't already in the insight.
 */
import { z } from "zod";
import type { AnalyticsSummary, FrictionSignal, Insight, PageSpec, SegmentKpis } from "@/lib/contracts";
import { SHIPPING_FEE } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { generateJson, llmAvailable } from "@/lib/llm/client";
import { num, numbersIn, pct, round1, withTimeout } from "./util";
import { UNAVAILABLE, describeElement, elementPhrase, rageClickTitle } from "./humanize";

/* ------------------------------------------------------------------ kinds */

export const INSIGHT_KINDS = [
  "shipping_shock",
  "checkout_friction",
  "weak_add_to_cart",
  "cta_rage_clicks",
  "landing_bounce",
  "cart_stall",
  "agent_missing_eta",
  "agent_missing_returns",
  "agent_missing_stock",
  "agent_missing_landed_price",
  "agent_missing_negotiation",
  "agent_missing_structured_data",
  "agent_blind",
  "agent_abandon",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/** Insight ids are stable per kind (`ins_shipping_shock`) so proposals and the LLM pass can refer to them. */
export function insightId(kind: InsightKind): string {
  return `ins_${kind}`;
}

export function insightKind(insight: Pick<Insight, "id">): InsightKind | undefined {
  const k = insight.id.replace(/^ins_/, "");
  return (INSIGHT_KINDS as readonly string[]).includes(k) ? (k as InsightKind) : undefined;
}

/* ------------------------------------------------------------------ tuning */

/** What "good" looks like at each step. Used to size the opportunity, never shown as measured data. */
export const BENCHMARKS = {
  browse: 0.55, // landing → product view
  addToCart: 0.25, // product view → add
  cartToCheckout: 0.6, // add → checkout
  checkoutCompletion: 0.7, // checkout → order
  agentConversion: 0.3, // agent visitor → order
} as const;

/**
 * Priors for relative conversion uplift when a friction is removed (CRO research, e.g. Baymard's
 * checkout abandonment studies). Used to size human insights on the same scale: orders × uplift.
 */
export const RELATIVE_UPLIFT = {
  hiddenShipping: 0.22,
} as const;

/** Below this many visitors in the summary we do a spec audit instead of reading funnels. */
export const MIN_VISITORS = 30;
/** Minimum visitors at a funnel step before we trust its rate. */
const MIN_STEP = 10;
const MIN_AGENTS = 5;

function severityFor(impact: number): Insight["severity"] {
  return impact >= 15 ? "high" : impact >= 5 ? "medium" : "low";
}

/**
 * Estimated absolute gain available at a step: the gap to benchmark or the relative gain expected
 * from removing friction the spec is known to have (whichever is larger), capped by the headroom.
 */
function potential(rate: number, benchmark: number, frictionGain: number): number {
  const gap = Math.max(benchmark - rate, rate * frictionGain);
  return Math.max(0, Math.min(gap, (1 - rate) * 0.6));
}

/* ------------------------------------------------------------------ agent field groups */

export type AgentFieldGroup = "landed_price" | "eta" | "returns" | "stock" | "negotiation" | "structured_data";

interface GroupDef {
  kind: InsightKind;
  label: string;
  match: RegExp;
  exposed: (s: PageSpec) => boolean;
}

/** Order matters: first match wins ("delivery cost" is a landed-price question, not an ETA one). */
export const AGENT_GROUPS: Record<AgentFieldGroup, GroupDef> = {
  landed_price: {
    kind: "agent_missing_landed_price",
    label: "landed price (incl. delivery)",
    match: /landed|shipping|postage|delivery[ _-]?(cost|fee|price)|total/i,
    exposed: (s) => s.agentSurface.exposeLandedPrice,
  },
  eta: {
    kind: "agent_missing_eta",
    label: "delivery ETA",
    // "eta" only at a word start ("ETA", "eta_days"), not inside "details"/"metadata".
    match: /(^|[^a-z])eta|deliver|arriv|dispatch|lead[ _-]?time/i,
    exposed: (s) => s.agentSurface.exposeDeliveryEta,
  },
  returns: {
    kind: "agent_missing_returns",
    label: "returns policy",
    match: /return|refund/i,
    exposed: (s) => s.agentSurface.exposeReturnPolicy,
  },
  stock: {
    kind: "agent_missing_stock",
    label: "stock levels",
    match: /stock|sizes?\b|availab|inventory|quantity/i,
    exposed: (s) => s.agentSurface.exposeStock,
  },
  negotiation: {
    kind: "agent_missing_negotiation",
    label: "negotiation",
    match: /negotiat|discount|haggl|counter[ _-]?offer|budget|too expensive|price/i,
    exposed: (s) => s.agentSurface.negotiation.enabled,
  },
  structured_data: {
    kind: "agent_missing_structured_data",
    label: "structured product data",
    match: /structured|json-?ld|schema/i,
    exposed: (s) => s.agentSurface.structuredData,
  },
};

export function agentGroupFor(text: string | undefined): AgentFieldGroup | undefined {
  if (!text) return undefined;
  return (Object.keys(AGENT_GROUPS) as AgentFieldGroup[]).find((g) => AGENT_GROUPS[g].match.test(text));
}

/* ------------------------------------------------------------------ helpers */

interface Ctx {
  summary: AnalyticsSummary;
  spec: PageSpec;
  /** Total visitors (humans + agents): the per-1,000 denominator. */
  total: number;
}

function at(k: SegmentKpis, step: string): number {
  return k.funnel.find((s) => s.step === step)?.visitors ?? 0;
}

function frictionOf(summary: AnalyticsSummary, kind: FrictionSignal["kind"], audience?: FrictionSignal["audience"]) {
  return (summary.friction ?? [])
    .filter((f) => f.kind === kind && (!audience || f.audience === audience) && f.count > 0)
    .sort((a, b) => b.count - a.count);
}

function per1k(lostOrders: number, ctx: Ctx): number {
  return round1((lostOrders / Math.max(1, ctx.total)) * 1000);
}

function impactChip(impact: number) {
  return { label: "Est. impact", value: `≈${impact} orders / 1k sessions` };
}

function make(
  kind: InsightKind,
  fields: Omit<Insight, "id" | "severity" | "impactScore" | "evidence"> & {
    evidence: Insight["evidence"];
    impact: number;
    severity?: Insight["severity"];
  },
): Insight {
  const { impact, severity, evidence, ...rest } = fields;
  return {
    id: insightId(kind),
    ...rest,
    severity: severity ?? severityFor(impact),
    evidence: [...evidence, impactChip(impact)],
    impactScore: impact,
  };
}

/** ["a", "b", "c"] → "a, b and c" (empty parts dropped). */
function listJoin(parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length <= 1 ? (p[0] ?? "") : `${p.slice(0, -1).join(", ")} and ${p.at(-1)}`;
}

/** listJoin, capitalised, with a full stop. */
function sentence(parts: string[]): string {
  const joined = listJoin(parts);
  return joined ? `${joined[0].toUpperCase()}${joined.slice(1)}.` : "";
}

/* ------------------------------------------------------------------ human rules */

function shippingShock(ctx: Ctx, checkoutFrictionPresent: boolean): Insight | undefined {
  const { summary, spec } = ctx;
  const H = summary.byKind.human;
  const checkoutN = at(H, "checkout_started");
  const ordersN = at(H, "order_completed");
  const completion = checkoutN ? ordersN / checkoutN : 0;
  const fee = formatGBP(SHIPPING_FEE);
  const shock = frictionOf(summary, "shipping_shock", "human")[0];

  if (shock) {
    const base = Math.max(checkoutN, shock.count);
    const share = shock.count / base;
    // Surprise costs are the #1 reason carts are abandoned (Baymard), and a hidden fee also depresses
    // earlier steps, so the upside is bigger than the people lost at the reveal itself.
    const impact = per1k(Math.max(shock.count * 0.5, spec.cart.showShippingUpfront ? 0 : ordersN * RELATIVE_UPLIFT.hiddenShipping), ctx);
    return make("shipping_shock", {
      title: `${pct(share)} of checkouts die the moment shipping appears`,
      audience: "human",
      stage: "checkout",
      detail:
        `${num(shock.count)} of ${num(base)} shoppers who started checkout left right after the ${fee} delivery fee ` +
        `was revealed${spec.cart.showShippingUpfront ? "" : " at the final step"}. No other step loses people this abruptly.`,
      evidence: [
        { label: "Left at shipping reveal", value: num(shock.count) },
        { label: "Checkout → order", value: pct(completion) },
        { label: "Shipping shown in cart", value: spec.cart.showShippingUpfront ? "yes" : "no" },
      ],
      impact,
    });
  }

  if (spec.cart.showShippingUpfront || checkoutN < MIN_STEP) return undefined;
  // The larger of: the uplift prior, or the share of the gap to benchmark that shipping explains.
  const gap = Math.max(0, BENCHMARKS.checkoutCompletion - completion);
  const impact = per1k(
    Math.max(ordersN * RELATIVE_UPLIFT.hiddenShipping, checkoutN * gap * 0.5 * (checkoutFrictionPresent ? 0.6 : 1)),
    ctx,
  );
  if (impact <= 0) return undefined;
  return make("shipping_shock", {
    title: `${pct(1 - completion)} of checkouts are abandoned — shipping is only revealed at the last step`,
    audience: "human",
    stage: "checkout",
    detail:
      `Only ${num(ordersN)} of ${num(checkoutN)} shoppers who started checkout finished (${pct(completion)}). ` +
      `The ${fee} delivery fee stays hidden until the final step: classic "shipping shock".`,
    evidence: [
      { label: "Checkout → order", value: pct(completion) },
      { label: "Checkout starters", value: num(checkoutN) },
      { label: "Shipping shown in cart", value: "no" },
    ],
    impact,
  });
}

function checkoutFrictionGain(spec: PageSpec): number {
  const { steps, guestCheckout, expressPay } = spec.checkout;
  return (steps === 3 ? 0.15 : steps === 2 ? 0.07 : 0) + (guestCheckout ? 0 : 0.12) + (expressPay ? 0 : 0.05);
}

function checkoutFriction(ctx: Ctx, shippingInsightPresent: boolean): Insight | undefined {
  const { summary, spec } = ctx;
  const H = summary.byKind.human;
  const checkoutN = at(H, "checkout_started");
  const ordersN = at(H, "order_completed");
  if (checkoutN < MIN_STEP) return undefined;
  const completion = ordersN / checkoutN;
  const frictionGain = checkoutFrictionGain(spec);
  if (frictionGain === 0 && completion >= BENCHMARKS.checkoutCompletion) return undefined;

  const shock = frictionOf(summary, "shipping_shock", "human")[0];
  const deadEnds = frictionOf(summary, "dead_end", "human").find((f) => /checkout/i.test(f.location));
  // Orders we'd expect back from removing the hurdles present (a forced account alone is the #2
  // abandonment reason in Baymard's research), or the share of the gap to benchmark the form explains.
  const gap = Math.max(0, BENCHMARKS.checkoutCompletion - completion);
  const unexplained = shock ? Math.max(0, checkoutN - ordersN - shock.count) / Math.max(1, checkoutN - ordersN) : 1;
  const lost = Math.max(ordersN * frictionGain, checkoutN * gap * 0.35 * unexplained * (shippingInsightPresent ? 0.6 : 1));
  const impact = per1k(lost, ctx);
  if (impact <= 0) return undefined;

  const { steps, guestCheckout, expressPay } = spec.checkout;
  const problems = [
    steps > 1 ? `it takes ${steps} steps` : "",
    guestCheckout ? "" : "shoppers must create an account",
    expressPay ? "" : "there's no express pay",
  ];
  const title =
    frictionGain > 0
      ? `Checkout takes ${steps} step${steps > 1 ? "s" : ""}${guestCheckout ? "" : " and demands an account"}: only ${pct(completion)} finish`
      : `${pct(1 - completion)} of checkouts are still abandoned`;
  return make("checkout_friction", {
    title,
    audience: "human",
    stage: "checkout",
    detail:
      `${num(checkoutN - ordersN)} of ${num(checkoutN)} shoppers who started checkout never ordered. ` +
      (frictionGain > 0 ? sentence(problems) + " Every extra hurdle is another exit." : "The form itself is the leak."),
    evidence: [
      { label: "Checkout → order", value: pct(completion) },
      { label: "Checkout steps", value: String(steps) },
      { label: "Guest checkout", value: guestCheckout ? "on" : "off" },
      ...(deadEnds ? [{ label: "Dead ends in checkout", value: num(deadEnds.count) }] : []),
    ],
    impact,
  });
}

function weakAddToCart(ctx: Ctx): Insight | undefined {
  const { summary, spec } = ctx;
  const H = summary.byKind.human;
  const viewN = at(H, "product_viewed");
  const addN = at(H, "product_added");
  const ordersN = at(H, "order_completed");
  if (viewN < MIN_STEP) return undefined;
  const rate = addN / viewN;
  const pp = spec.productPage;
  const gain =
    (pp.ctaPosition === "below-description" ? 0.2 : 0) +
    (pp.showReviews ? 0 : 0.08) +
    (pp.showDeliveryEstimate ? 0 : 0.05) +
    (pp.showReturnsPolicy ? 0 : 0.03) +
    (pp.trustBadges ? 0 : 0.02);
  if (gain === 0 && rate >= BENCHMARKS.addToCart) return undefined;
  const downstream = addN ? ordersN / addN : 0.3;
  // `gain` is the relative lift in add-to-bag from fixing what's missing; about half of it survives
  // to orders. Closing the whole gap to the benchmark is not a realistic promise for one change.
  const lost = ordersN * gain * 0.5 + viewN * Math.max(0, BENCHMARKS.addToCart - rate) * downstream * 0.05;
  const impact = per1k(lost, ctx);
  if (impact <= 0) return undefined;

  const reasons = [
    pp.ctaPosition === "below-description" ? `the "${pp.ctaText}" button sits below the description, out of view` : "",
    pp.showReviews ? "" : "reviews are hidden",
    pp.showDeliveryEstimate ? "" : "there's no delivery estimate",
  ];
  const deadEnds = frictionOf(summary, "dead_end", "human").find((f) => /product|\/p\//i.test(f.location));
  return make("weak_add_to_cart", {
    title: `Only ${pct(rate)} of product views turn into an add-to-bag`,
    audience: "human",
    stage: "product page",
    detail: `${num(viewN - addN)} of ${num(viewN)} shoppers who opened a product never added it. ${sentence(reasons)}`.trim(),
    evidence: [
      { label: "View → bag", value: pct(rate) },
      { label: "Product viewers", value: num(viewN) },
      { label: "CTA position", value: pp.ctaPosition },
      { label: "Reviews", value: pp.showReviews ? "shown" : "hidden" },
      ...(deadEnds ? [{ label: "Dead ends on product pages", value: num(deadEnds.count) }] : []),
    ],
    impact,
  });
}

function ctaRageClicks(ctx: Ctx): Insight | undefined {
  const { summary } = ctx;
  const H = summary.byKind.human;
  const hit = frictionOf(summary, "rage_click", "human").find((f) =>
    /add|cta|bag|cart|buy|checkout|button|size/i.test(`${f.location} ${f.detail ?? ""}`),
  );
  if (!hit || hit.count < 3) return undefined;
  const addN = at(H, "product_added");
  const downstream = addN ? at(H, "order_completed") / addN : 0.3;
  const impact = per1k(hit.count * 0.3 * downstream, ctx);
  const where = hit.detail ?? hit.location;
  const el = describeElement(where);
  const what = el ? `the ${elementPhrase(where)}` : `"${where}"`;
  return make("cta_rage_clicks", {
    title: rageClickTitle(num(hit.count), where),
    audience: "human",
    stage: "product page",
    detail: el?.disabled
      ? `${pct(hit.share)} of human visitors ${UNAVAILABLE(what)}`
      : `${pct(hit.share)} of human visitors hammered ${what}${el ? "" : ` (${hit.location})`} repeatedly: the button isn't where they expect it, or doesn't respond fast enough.`,
    evidence: [
      { label: "Rage clickers", value: num(hit.count) },
      { label: "Share of shoppers", value: pct(hit.share) },
      { label: "Element", value: el ? elementPhrase(where) : where },
    ],
    impact,
  });
}

function landingBounce(ctx: Ctx): Insight | undefined {
  const { summary, spec } = ctx;
  const H = summary.byKind.human;
  const pvN = at(H, "$pageview");
  const viewN = at(H, "product_viewed");
  if (pvN < MIN_STEP) return undefined;
  const rate = viewN / pvN;
  const gain = (spec.hero.showSocialProof ? 0 : 0.08) + (spec.productGrid.showRatings ? 0 : 0.04) + (spec.productGrid.showQuickAdd ? 0 : 0.02);
  if (gain === 0 && rate >= BENCHMARKS.browse) return undefined;
  const downstream = viewN ? at(H, "order_completed") / viewN : 0.03;
  const impact = per1k(pvN * potential(rate, BENCHMARKS.browse, gain) * downstream, ctx);
  if (impact <= 0) return undefined;
  const reasons = [
    spec.hero.showSocialProof ? "" : "there's no social proof above the fold",
    spec.productGrid.showRatings ? "" : "the grid hides star ratings",
  ];
  return make("landing_bounce", {
    title: `${pct(1 - rate)} of visitors leave without opening a product`,
    audience: "human",
    stage: "homepage",
    detail: `${num(pvN - viewN)} of ${num(pvN)} visitors saw "${spec.hero.headline}" and never clicked into a product. ${sentence(reasons)}`.trim(),
    evidence: [
      { label: "Landing → product", value: pct(rate) },
      { label: "Visitors", value: num(pvN) },
      { label: "Social proof", value: spec.hero.showSocialProof ? "on" : "off" },
    ],
    impact,
  });
}

function cartStall(ctx: Ctx): Insight | undefined {
  const { summary, spec } = ctx;
  const H = summary.byKind.human;
  const addN = at(H, "product_added");
  const checkoutN = at(H, "checkout_started");
  if (addN < MIN_STEP) return undefined;
  const rate = checkoutN / addN;
  const gain = (spec.cart.freeShippingThreshold === null ? 0.06 : 0) + (spec.checkout.expressPay ? 0 : 0.05);
  if (gain === 0 && rate >= BENCHMARKS.cartToCheckout) return undefined;
  const downstream = checkoutN ? at(H, "order_completed") / checkoutN : 0.4;
  const impact = per1k(addN * potential(rate, BENCHMARKS.cartToCheckout, gain) * downstream, ctx);
  if (impact <= 0) return undefined;
  return make("cart_stall", {
    title: `${pct(1 - rate)} of full bags never reach checkout`,
    audience: "human",
    stage: "cart",
    detail:
      `${num(addN - checkoutN)} of ${num(addN)} shoppers added something and stopped at the bag. ` +
      sentence([
        spec.cart.freeShippingThreshold === null ? "there's no free-delivery threshold to aim for" : "",
        spec.checkout.expressPay ? "" : "there's no one-tap express pay",
      ]),
    evidence: [
      { label: "Bag → checkout", value: pct(rate) },
      { label: "Shoppers with a bag", value: num(addN) },
      { label: "Free delivery threshold", value: spec.cart.freeShippingThreshold === null ? "none" : formatGBP(spec.cart.freeShippingThreshold) },
    ],
    impact,
  });
}

/* ------------------------------------------------------------------ agent rules */

interface GroupSignal {
  askedDistinct: number;
  askedRequests: number;
  abandoned: number;
  errors: number;
  reasons: Map<string, number>;
}

function agentInsights(ctx: Ctx): Insight[] {
  const { summary, spec } = ctx;
  const A = summary.byKind.agent;
  const agentN = A.visitors;
  if (agentN < MIN_AGENTS) return [];
  const agentCR = A.conversionRate;
  const humanCR = summary.byKind.human.conversionRate;

  const signals = new Map<AgentFieldGroup, GroupSignal>();
  const sig = (g: AgentFieldGroup) => {
    let s = signals.get(g);
    if (!s) signals.set(g, (s = { askedDistinct: 0, askedRequests: 0, abandoned: 0, errors: 0, reasons: new Map() }));
    return s;
  };
  const unmapped = new Map<string, number>();
  /** True once the store reports which fields agents asked for (then we don't guess). */
  let missingReported = false;

  for (const f of summary.friction ?? []) {
    if (f.audience !== "agent" || f.count <= 0) continue;
    if (f.kind === "agent_missing_field") {
      missingReported = true;
      const g = agentGroupFor(f.detail) ?? agentGroupFor(f.location);
      // Several fields map to one group (e.g. `sizes` and `stock`); the same agent often asks for both,
      // so take the max rather than summing distinct counts.
      if (g) sig(g).askedDistinct = Math.max(sig(g).askedDistinct, f.count);
    } else if (f.kind === "agent_abandoned") {
      const reason = f.detail ?? f.location;
      const g = agentGroupFor(reason);
      if (g) {
        const s = sig(g);
        s.abandoned += f.count;
        s.reasons.set(reason, (s.reasons.get(reason) ?? 0) + f.count);
      } else unmapped.set(reason, (unmapped.get(reason) ?? 0) + f.count);
    } else if (f.kind === "agent_error") {
      if (/negotiat/i.test(`${f.location} ${f.detail ?? ""}`)) sig("negotiation").errors += f.count;
    }
  }
  for (const t of summary.agentTools ?? []) {
    for (const [field, n] of Object.entries(t.missing ?? {})) {
      if (n <= 0) continue;
      missingReported = true;
      const g = agentGroupFor(field) ?? agentGroupFor(t.tool);
      if (g) sig(g).askedRequests += n;
    }
    if (/negotiat/i.test(t.tool) && t.errors > 0 && !frictionOf(summary, "agent_error", "agent").length) {
      sig("negotiation").errors += t.errors;
    }
  }

  const out: Insight[] = [];
  for (const [group, s] of signals) {
    const def = AGENT_GROUPS[group];
    if (def.exposed(spec)) continue;
    const askedEst = s.askedDistinct || Math.min(agentN, Math.round(s.askedRequests * 0.6));
    const affected = Math.min(agentN, Math.max(askedEst, s.abandoned, s.errors));
    if (affected <= 0) continue;
    // Agents that walked away over this field are the most recoverable; askers who stayed, much less so.
    const lost = s.abandoned * 0.5 + Math.max(0, affected - s.abandoned) * 0.1 * (1 - agentCR);
    const impact = per1k(lost, ctx);
    const topReason = [...s.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    let title: string;
    if (group === "negotiation") {
      title = `${num(Math.max(s.errors, s.abandoned, askedEst))} AI shoppers tried to negotiate: the store can't`;
    } else if (s.askedDistinct) {
      title = `${pct(Math.min(1, s.askedDistinct / agentN))} of AI shoppers asked for ${def.label}: we don't expose it`;
    } else if (s.askedRequests) {
      title = `AI shoppers asked for ${def.label} ${num(s.askedRequests)} times: we don't expose it`;
    } else {
      title = `${num(s.abandoned)} AI shoppers walked away over missing ${def.label}`;
    }
    const asked = s.askedDistinct
      ? `${num(s.askedDistinct)} of ${num(agentN)} agents requested ${def.label} and got nothing`
      : s.askedRequests
        ? `Agents requested ${def.label} ${num(s.askedRequests)} times across ${num(agentN)} agent sessions and got nothing`
        : s.errors
          ? `${num(s.errors)} negotiation attempts failed`
          : "";
    const abandonedPart = s.abandoned
      ? `${num(s.abandoned)} abandoned${topReason ? ` citing "${topReason}"` : ""}`
      : "";
    out.push(
      make(def.kind, {
        title,
        audience: "agent",
        stage: "agent: catalog",
        detail:
          `${[asked, abandonedPart].filter(Boolean).join("; ")}. ` +
          `Agents can't verify their brief without it, so they shortlist someone else. Agent conversion: ${pct(agentCR)}.`,
        evidence: [
          ...(s.askedDistinct ? [{ label: "Agents asking", value: num(s.askedDistinct) }] : []),
          ...(s.askedRequests ? [{ label: "Requests for it", value: num(s.askedRequests) }] : []),
          ...(s.abandoned ? [{ label: "Abandoned over it", value: num(s.abandoned) }] : []),
          ...(s.errors ? [{ label: "Failed attempts", value: num(s.errors) }] : []),
          { label: "Agent conversion", value: pct(agentCR) },
        ],
        impact,
      }),
    );
  }

  if (unmapped.size) {
    const reasons = [...unmapped.entries()].sort((a, b) => b[1] - a[1]);
    const total = reasons.reduce((n, [, c]) => n + c, 0);
    const impact = per1k(total * 0.15, ctx);
    out.push(
      make("agent_abandon", {
        title: `${pct(Math.min(1, total / agentN))} of AI shoppers give up: "${reasons[0][0]}"`,
        audience: "agent",
        stage: "agent: checkout",
        detail: `${num(total)} of ${num(agentN)} agent sessions ended in an abandon for reasons our playbook doesn't map to a knob yet. Top reason: "${reasons[0][0]}" (${num(reasons[0][1])}).`,
        evidence: reasons.slice(0, 3).map(([r, c]) => ({ label: r.slice(0, 40), value: num(c) })),
        impact,
      }),
    );
  }

  // Fallback: the store doesn't report which fields agents asked for, but the spec hides what they need.
  const fieldInsights = out.some((i) => i.id.startsWith("ins_agent_missing_"));
  if (!missingReported && !fieldInsights) {
    const hidden = (["eta", "returns", "stock", "landed_price", "negotiation"] as AgentFieldGroup[]).filter(
      (g) => !AGENT_GROUPS[g].exposed(spec),
    );
    if (hidden.length) {
      const gain = hidden.reduce((n, g) => n + (g === "negotiation" ? 0.05 : 0.12), 0);
      // Without telemetry we can't tell which field matters, so only claim half the gap.
      const impact = per1k(agentN * potential(agentCR, BENCHMARKS.agentConversion, gain) * 0.5, ctx);
      if (impact > 0) {
        const fields = hidden.filter((g) => g !== "negotiation").map((g) => AGENT_GROUPS[g].label);
        const noNegotiation = hidden.includes("negotiation");
        const what = fields.length
          ? `Our agent API hides ${listJoin(fields)}${noNegotiation ? ", and agents can't negotiate" : ""}`
          : "Agents can't negotiate on price";
        out.push(
          make("agent_blind", {
            title: `AI shoppers are flying blind: only ${pct(agentCR)} of ${num(agentN)} agents buy`,
            audience: "agent",
            stage: "agent: catalog",
            detail:
              `${what}: the facts a shopping agent needs to match a brief like "delivered by Friday, free returns".` +
              (humanCR > agentCR ? ` Humans convert at ${pct(humanCR)} on the same store.` : ""),
            evidence: [
              { label: "Agent conversion", value: pct(agentCR) },
              { label: "Human conversion", value: pct(humanCR) },
              { label: "Agent visitors", value: num(agentN) },
              { label: "Hidden fields", value: String(hidden.length) },
            ],
            impact,
          }),
        );
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ spec audit (no data) */

function auditInsights(spec: PageSpec, visitors: number): Insight[] {
  const basis = [
    { label: "Visitors observed", value: num(visitors) },
    { label: "Basis", value: "Spec audit (not enough traffic yet)" },
  ];
  const out: Insight[] = [];
  const add = (kind: InsightKind, title: string, detail: string, audience: Insight["audience"], stage: string, impactScore: number) =>
    out.push({ id: insightId(kind), title, detail, audience, stage, severity: "low", evidence: basis, impactScore });
  const wait = `Only ${num(visitors)} visitors so far, so this is from reading the spec, not measured behaviour.`;

  if (!spec.cart.showShippingUpfront) {
    add(
      "shipping_shock",
      "Shipping cost stays hidden until the last checkout step",
      `${wait} The ${formatGBP(SHIPPING_FEE)} delivery fee only appears at the final step: surprise costs are the top reason carts get abandoned.`,
      "human",
      "checkout",
      6,
    );
  }
  if (spec.checkout.steps > 1 || !spec.checkout.guestCheckout) {
    add(
      "checkout_friction",
      `Checkout takes ${spec.checkout.steps} steps${spec.checkout.guestCheckout ? "" : " and demands an account"}`,
      `${wait} Every extra step and forced sign-up is another exit.`,
      "human",
      "checkout",
      4,
    );
  }
  if (spec.productPage.ctaPosition === "below-description" || !spec.productPage.showReviews) {
    add(
      "weak_add_to_cart",
      "The add-to-bag button is buried and reviews are hidden",
      `${wait} Shoppers have to scroll past the description to buy, with no reviews to reassure them.`,
      "human",
      "product page",
      3,
    );
  }
  const hidden = (["eta", "returns", "stock", "landed_price"] as AgentFieldGroup[]).filter((g) => !AGENT_GROUPS[g].exposed(spec));
  if (hidden.length) {
    add(
      "agent_blind",
      `AI shoppers can't see ${listJoin(hidden.map((g) => AGENT_GROUPS[g].label))}`,
      `${wait} Shopping agents match briefs on delivery date, returns and total price; our agent API hides them.`,
      "agent",
      "agent: catalog",
      3,
    );
  }
  if (!spec.hero.showSocialProof) {
    add("landing_bounce", "No social proof on the homepage", `${wait} Nothing above the fold tells visitors other runners trust us.`, "human", "homepage", 1);
  }
  return out;
}

/* ------------------------------------------------------------------ entry point */

/** Heuristic diagnosis. Sorted by impactScore, highest first. */
export function diagnose(summary: AnalyticsSummary, spec: PageSpec): Insight[] {
  const total = summary.overall.visitors;
  if (total < MIN_VISITORS) return auditInsights(spec, total);
  const ctx: Ctx = { summary, spec, total };

  const checkoutFrictionPresent = checkoutFrictionGain(spec) > 0;
  const shipping = shippingShock(ctx, checkoutFrictionPresent);
  const insights = [
    shipping,
    checkoutFriction(ctx, Boolean(shipping)),
    weakAddToCart(ctx),
    ctaRageClicks(ctx),
    landingBounce(ctx),
    cartStall(ctx),
    ...agentInsights(ctx),
  ].filter((i): i is Insight => Boolean(i) && (i as Insight).impactScore > 0);

  return insights.sort((a, b) => b.impactScore - a.impactScore);
}

/* ------------------------------------------------------------------ optional LLM polish */

const RefinedSchema = z.object({
  insights: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(3).max(120),
        detail: z.string().min(3).max(500),
      }),
    )
    .max(20),
});

/** Numbers an insight is allowed to mention (everything already in its text or evidence). */
function allowedNumbers(i: Insight): Set<string> {
  return new Set([
    ...numbersIn([i.title, i.detail, ...i.evidence.map((e) => `${e.label} ${e.value}`)].join(" ")),
    "1000",
    "1",
  ]);
}

/**
 * Ask the LLM to sharpen the copy and re-rank. Keeps ids, evidence, impact and severity untouched,
 * and discards any rewrite that introduces a number not already present. Silent fallback.
 */
export async function refineInsightsWithLlm(insights: Insight[], summary: AnalyticsSummary): Promise<Insight[]> {
  if (!llmAvailable() || insights.length === 0) return insights;
  try {
    const res = await withTimeout(
      generateJson({
        schema: RefinedSchema,
        maxTokens: 1500,
        system:
          "You are the analyst in a live demo of Darwin, a storefront that improves itself for human shoppers and AI shopping agents. " +
          "Rewrite each insight's title (max ~70 chars, punchy, leads with the number) and detail (1-2 sentences). " +
          "Use ONLY numbers that already appear in that insight. Never invent statistics. Order the list by what the merchant should fix first.",
        prompt: JSON.stringify({
          totals: {
            visitors: summary.overall.visitors,
            humanConversion: summary.byKind.human.conversionRate,
            agentConversion: summary.byKind.agent.conversionRate,
          },
          insights: insights.map(({ id, title, detail, audience, stage, evidence, impactScore }) => ({
            id,
            title,
            detail,
            audience,
            stage,
            evidence,
            impactScore,
          })),
          respondWith: { insights: [{ id: "same id", title: "…", detail: "…" }] },
        }),
      }),
      20_000,
      "insight rewrite",
    );
    const byId = new Map(insights.map((i) => [i.id, i]));
    const out: Insight[] = [];
    const seen = new Set<string>();
    for (const r of res.insights) {
      const orig = byId.get(r.id);
      if (!orig || seen.has(r.id)) continue;
      seen.add(r.id);
      const allowed = allowedNumbers(orig);
      const honest = numbersIn(`${r.title} ${r.detail}`).every((n) => allowed.has(n));
      out.push(honest ? { ...orig, title: r.title, detail: r.detail } : orig);
    }
    for (const i of insights) if (!seen.has(i.id)) out.push(i);
    return out;
  } catch {
    return insights;
  }
}
