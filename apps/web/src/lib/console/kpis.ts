/**
 * KPI maths shared by the console views (classic mission control and the Overview). Pure functions.
 *
 * Revenue per visitor is the tricky one. AI shopping agents spend ~20x more per visitor than humans
 * (they arrive knowing what they want), so a pooled `overall.revenue / overall.visitors` moves with
 * the human:agent traffic MIX, not with the store: observe batches, experiment rounds (skewed toward
 * the audience under test) and the console's traffic driver all use different ratios. Comparing a
 * window with 2% agents to one with 8% agents showed "−30% revenue / visitor" while conversion was up
 * for humans AND agents (Simpson's paradox). So both sides are computed per segment and weighted by
 * one fixed mix (Gen 0's, like the optimizer's `standardOverall`), from the same kind of filter.
 */
import type { AnalyticsFilter, AnalyticsSummary, SegmentKpis, VisitorKind } from "@/lib/contracts";

export type VisitorMix = Record<VisitorKind, number>;

const KINDS: VisitorKind[] = ["human", "agent"];

/** Unique visitors a segment needs before its revenue per visitor is shown or compared. */
export const RPV_MIN_VISITORS: VisitorMix = { human: 120, agent: 40 };

/** Normalised weights (sum 1) from visitor counts; undefined when there are none. */
export function mixWeights(counts: Partial<VisitorMix> | undefined): VisitorMix | undefined {
  const h = Math.max(0, Number(counts?.human) || 0);
  const a = Math.max(0, Number(counts?.agent) || 0);
  return h + a > 0 ? { human: h / (h + a), agent: a / (h + a) } : undefined;
}

/** Revenue (pence) per unique visitor of one segment; undefined below `min` visitors. */
export function segmentRevenuePerVisitor(seg: Pick<SegmentKpis, "visitors" | "revenue"> | undefined, min = 1): number | undefined {
  if (!seg || !(seg.visitors >= Math.max(1, min))) return undefined;
  const revenue = Number(seg.revenue) || 0;
  return revenue / seg.visitors;
}

/**
 * Revenue per visitor (pence) at a fixed human/agent mix: Σ weight(kind) × revenue(kind) / visitors(kind).
 * Undefined when a segment with a non-zero weight is below its sample floor (it can't be estimated).
 */
export function standardizedRevenuePerVisitor(
  summary: Pick<AnalyticsSummary, "byKind"> | undefined,
  weights: VisitorMix | undefined,
  min: VisitorMix = RPV_MIN_VISITORS,
): number | undefined {
  if (!summary || !weights) return undefined;
  let total = 0;
  for (const kind of KINDS) {
    const w = weights[kind];
    if (!(w > 0)) continue;
    const rpv = segmentRevenuePerVisitor(summary.byKind[kind], min[kind]);
    if (rpv === undefined) return undefined;
    total += w * rpv;
  }
  return total;
}

/** Filter keys that must match for two summaries to be comparable (everything but the spec version). */
const SCOPE_KEYS: (keyof AnalyticsFilter)[] = ["from", "to", "visitorKind", "experimentId", "variant", "includeSynthetic"];

function scopeOf(f: AnalyticsFilter | undefined): string {
  const s = f ?? {};
  return JSON.stringify(SCOPE_KEYS.map((k) => (k === "includeSynthetic" ? s.includeSynthetic !== false : (s[k] ?? null))));
}

/** True when two summaries were produced by the same kind of filter (spec version aside). */
export function sameScope(a: Pick<AnalyticsSummary, "filter"> | undefined, b: Pick<AnalyticsSummary, "filter"> | undefined): boolean {
  return Boolean(a && b) && scopeOf(a?.filter) === scopeOf(b?.filter);
}

export interface RevenuePerVisitorKpi {
  /** Revenue per visitor to show (pence), at `weights`. */
  value?: number;
  /** Gen 0's revenue per visitor at the same weights (pence). */
  baseline?: number;
  /** (value − baseline) / baseline. Only set when both sides are like for like and big enough. */
  delta?: number;
  /** Which summary `value` came from: the live generation, all time (fallback, never compared), or none. */
  basis: "generation" | "all" | "none";
  /** The human/agent mix both sides are weighted by. */
  weights?: VisitorMix;
  /** Short label for the tile when there is no delta (or what the delta is against). */
  note: string;
}

/**
 * Revenue per visitor for the live generation vs Gen 0, like for like:
 *   - both sides from the same filter kind (spec version), never all-time vs one generation;
 *   - unique visitors and pence revenue per segment, weighted by one mix (Gen 0's by default);
 *   - a delta only when both sides have `min` visitors in every weighted segment, else none ("–").
 *
 * `current` = summary for the live spec version, `baseline` = summary for Gen 0's spec version
 * (omit at Gen 0), `all` = all-time summary (display fallback only), `mix` = Gen 0 visitor counts
 * (e.g. `loop.history[0].humanVisitors / agentVisitors`).
 */
export function compareRevenuePerVisitor(input: {
  current?: AnalyticsSummary;
  baseline?: AnalyticsSummary;
  all?: AnalyticsSummary;
  mix?: Partial<VisitorMix>;
  min?: VisitorMix;
}): RevenuePerVisitorKpi {
  const min = input.min ?? RPV_MIN_VISITORS;
  const counts = (s?: AnalyticsSummary): Partial<VisitorMix> | undefined =>
    s ? { human: s.byKind.human.visitors, agent: s.byKind.agent.visitors } : undefined;
  const weights = mixWeights(input.mix) ?? mixWeights(counts(input.baseline)) ?? mixWeights(counts(input.current)) ?? mixWeights(counts(input.all));

  const value = standardizedRevenuePerVisitor(input.current, weights, min);
  if (value === undefined) {
    const all = standardizedRevenuePerVisitor(input.all, weights, min);
    return all === undefined
      ? { basis: "none", weights, note: "not enough visitors" }
      : { value: all, basis: "all", weights, note: "all generations" };
  }
  if (!input.baseline) return { value, basis: "generation", weights, note: "this generation" };
  if (!sameScope(input.current, input.baseline)) return { value, basis: "generation", weights, note: "baseline not comparable" };
  const baseline = standardizedRevenuePerVisitor(input.baseline, weights, min);
  if (baseline === undefined || !(baseline > 0)) return { value, baseline, basis: "generation", weights, note: "Gen 0 sample too small" };
  return { value, baseline, delta: (value - baseline) / baseline, basis: "generation", weights, note: "vs Gen 0" };
}
