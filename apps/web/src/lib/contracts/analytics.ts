/**
 * Read-side analytics contract: what the analytics module computes and everyone else reads.
 */
import type { VisitorKind } from "./events";

export interface FunnelStepStat {
  step: string;
  /** Unique visitors (distinct_id) who reached this step. */
  visitors: number;
  /** visitors / visitors at first step. */
  rateFromStart: number;
  /** visitors / visitors at previous step. */
  rateFromPrevious: number;
}

export interface SegmentKpis {
  visitors: number;
  sessions: number;
  orders: number;
  revenue: number;
  /** orders / visitors. */
  conversionRate: number;
  averageOrderValue: number;
  funnel: FunnelStepStat[];
}

/** A place where visitors struggle, derived from raw events. */
export interface FrictionSignal {
  kind:
    | "rage_click" // repeated clicks on the same element
    | "dead_end" // pageleave with no next funnel step
    | "shipping_shock" // abandon right after shipping_cost_revealed
    | "agent_missing_field" // agent asked for data we don't expose
    | "agent_error" // agent tool call failed
    | "agent_abandoned";
  audience: VisitorKind;
  /** Where: pathname, element selector, or agent tool name. */
  location: string;
  /** How many distinct visitors hit this. */
  count: number;
  /** Share of that audience's visitors affected, 0..1. */
  share: number;
  /** Example detail, e.g. missing field name. */
  detail?: string;
}

export interface AgentToolStat {
  tool: string;
  calls: number;
  errors: number;
  /** Fields agents asked for that were missing, with counts. */
  missing: Record<string, number>;
}

export interface AnalyticsSummary {
  /** ISO window the summary covers. */
  from: string;
  to: string;
  totalEvents: number;
  overall: SegmentKpis;
  byKind: Record<VisitorKind, SegmentKpis>;
  friction: FrictionSignal[];
  agentTools: AgentToolStat[];
  /** Filter that produced this summary (e.g. spec version or experiment arm). */
  filter?: AnalyticsFilter;
}

export interface AnalyticsFilter {
  from?: string;
  to?: string;
  visitorKind?: VisitorKind;
  experimentId?: string;
  variant?: string;
  specVersion?: number;
  /** Include synthetic (simulated) traffic. Default true. */
  includeSynthetic?: boolean;
}
