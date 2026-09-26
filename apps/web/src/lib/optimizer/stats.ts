/**
 * Experiment statistics: honest Bayesian A/B testing.
 *
 * Primary metric: visitor-level conversion — the share of distinct visitors (humans + agents)
 * in an arm who fired `order_completed`. Each arm gets a Beta(1 + conversions, 1 + non-conversions)
 * posterior (uniform prior); a seeded Monte Carlo gives P(treatment > control) and a 95% credible
 * interval on relative lift.
 *
 * Triggered analysis: a patch that only touches `agentSurface` is invisible to humans, so its
 * decision is computed on agent visitors only (`audience: "agent"`); human traffic would just add noise.
 */
import type { AnalyticsEvent, Audience, ExperimentResult, SpecPatch, VariantStats, VisitorKind } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { filterEvents } from "@/lib/analytics/summary";
import { hashString, mulberry32 } from "./util";

export type Decision = ExperimentResult["decision"];

export interface DecisionConfig {
  /** Minimum unique visitors per arm before we will call ship/reject. */
  minVisitors: number;
  /** Same, when the metric is scoped to one audience (agents are a small slice of traffic). */
  minSegmentVisitors: number;
  /** Ship when P(treatment > control) ≥ this. */
  shipThreshold: number;
  /** Reject when P(treatment > control) ≤ this. */
  rejectThreshold: number;
  /** After this many traffic rounds without a call, give up: inconclusive. */
  maxRounds: number;
}

export const DEFAULT_DECISION: DecisionConfig = {
  minVisitors: 400,
  minSegmentVisitors: 100,
  shipThreshold: 0.95,
  rejectThreshold: 0.1,
  maxRounds: 4,
};

/* ------------------------------------------------------------------ per-variant stats */

const emptyKind = () => ({ visitors: 0, conversions: 0, conversionRate: 0 });

/** Visitor-level stats for one arm. `events` must already be filtered to that arm. */
export function variantStatsFromEvents(variant: string, events: readonly AnalyticsEvent[]): VariantStats {
  const kindOf = new Map<string, VisitorKind>();
  const buyers = new Set<string>();
  let revenue = 0;
  for (const e of events) {
    if (!kindOf.has(e.distinct_id)) kindOf.set(e.distinct_id, e.properties.visitor_kind ?? "human");
    if (e.event === "order_completed") {
      buyers.add(e.distinct_id);
      revenue += Number(e.properties.revenue ?? 0) || 0;
    }
  }
  const byKind: VariantStats["byKind"] = { human: emptyKind(), agent: emptyKind() };
  for (const [id, kind] of kindOf) {
    byKind[kind].visitors++;
    if (buyers.has(id)) byKind[kind].conversions++;
  }
  for (const k of Object.values(byKind)) k.conversionRate = k.visitors ? k.conversions / k.visitors : 0;
  const visitors = kindOf.size;
  const conversions = buyers.size;
  return { variant, visitors, conversions, revenue, conversionRate: visitors ? conversions / visitors : 0, byKind };
}

/** Control + treatment stats for an experiment, read from the event store. */
export function experimentArms(
  experimentId: string,
  events: readonly AnalyticsEvent[] = eventStore().all(),
): { control: VariantStats; treatment: VariantStats; synthetic: boolean } {
  const inExp = filterEvents(events, { experimentId });
  const control = inExp.filter((e) => e.properties.variant === "control");
  const treatment = inExp.filter((e) => e.properties.variant === "treatment");
  return {
    control: variantStatsFromEvents("control", control),
    treatment: variantStatsFromEvents("treatment", treatment),
    synthetic: inExp.some((e) => e.properties.synthetic === true),
  };
}

/* ------------------------------------------------------------------ posterior sampling */

function sampleNormal(rng: () => number): number {
  // Box–Muller
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia–Tsang gamma sampler (shape ≥ 1, which the uniform prior guarantees). */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a + 1) · U^(1/a)
    return sampleGamma(shape + 1, rng) * Math.pow(rng() || Number.MIN_VALUE, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(a: number, b: number, rng: () => number): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}

function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface PosteriorComparison {
  /** P(treatment CR > control CR). */
  probabilityToBeat: number;
  /** 95% credible interval on relative lift. */
  liftInterval: [number, number];
  /** Posterior median relative lift. */
  medianLift: number;
}

export function comparePosteriors(
  control: { visitors: number; conversions: number },
  treatment: { visitors: number; conversions: number },
  opts: { draws?: number; seed?: number } = {},
): PosteriorComparison {
  const draws = opts.draws ?? 20_000;
  const rng = mulberry32(opts.seed ?? 1);
  const aC = 1 + control.conversions;
  const bC = 1 + Math.max(0, control.visitors - control.conversions);
  const aT = 1 + treatment.conversions;
  const bT = 1 + Math.max(0, treatment.visitors - treatment.conversions);
  const lifts = new Float64Array(draws);
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    const c = sampleBeta(aC, bC, rng);
    const t = sampleBeta(aT, bT, rng);
    if (t > c) wins++;
    lifts[i] = (t - c) / c;
  }
  lifts.sort();
  return {
    probabilityToBeat: wins / draws,
    liftInterval: [quantile(lifts, 0.025), quantile(lifts, 0.975)],
    medianLift: quantile(lifts, 0.5),
  };
}

/* ------------------------------------------------------------------ decisions */

export function decide(
  input: { probabilityToBeat: number; controlVisitors: number; treatmentVisitors: number; round: number },
  cfg: DecisionConfig = DEFAULT_DECISION,
  audience: Audience = "all",
): Decision {
  const min = audience === "all" ? cfg.minVisitors : cfg.minSegmentVisitors;
  const enough = input.controlVisitors >= min && input.treatmentVisitors >= min;
  if (enough && input.probabilityToBeat >= cfg.shipThreshold) return "ship";
  if (enough && input.probabilityToBeat <= cfg.rejectThreshold) return "reject";
  if (input.round >= cfg.maxRounds) return "inconclusive";
  return "running";
}

/** Relative lift of b over a, or undefined when a is zero. */
export function relativeLift(a: number, b: number): number | undefined {
  return a > 0 ? (b - a) / a : undefined;
}

/** Which visitors a patch can affect: agentSurface-only patches are invisible to humans. */
export function metricAudience(patch: SpecPatch): Audience {
  const keys = Object.keys(patch).filter((k) => patch[k as keyof SpecPatch] !== undefined);
  return keys.length > 0 && keys.every((k) => k === "agentSurface") ? "agent" : "all";
}

/** The slice of an arm the decision metric counts. */
export function segment(v: VariantStats, audience: Audience): { visitors: number; conversions: number; conversionRate: number } {
  return audience === "all" ? v : v.byKind[audience];
}

/** Full result for a pair of arms. `round` = traffic rounds run so far. */
export function evaluateArms(
  control: VariantStats,
  treatment: VariantStats,
  round: number,
  cfg: DecisionConfig = DEFAULT_DECISION,
  seed = 1,
  audience: Audience = "all",
): ExperimentResult {
  const c = segment(control, audience);
  const t = segment(treatment, audience);
  const post = comparePosteriors(c, t, { seed });
  const lift = relativeLift(c.conversionRate, t.conversionRate) ?? (t.conversions > 0 ? post.medianLift : 0);
  return {
    control,
    treatment,
    lift,
    probabilityToBeat: post.probabilityToBeat,
    liftInterval: post.liftInterval,
    decision: decide(
      { probabilityToBeat: post.probabilityToBeat, controlVisitors: c.visitors, treatmentVisitors: t.visitors, round },
      cfg,
      audience,
    ),
    audience,
  };
}

/** Recompute an experiment's result from the event store. */
export function evaluateExperiment(
  experimentId: string,
  round: number,
  cfg: DecisionConfig = DEFAULT_DECISION,
  audience: Audience = "all",
  events?: readonly AnalyticsEvent[],
): { result: ExperimentResult; synthetic: boolean } {
  const { control, treatment, synthetic } = experimentArms(experimentId, events);
  return {
    result: evaluateArms(control, treatment, round, cfg, hashString(`${experimentId}:${round}`), audience),
    synthetic,
  };
}
