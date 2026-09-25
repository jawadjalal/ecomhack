/**
 * Analytics summary: KPIs + funnel per visitor kind.
 * Baseline implementation from the scaffold. The analytics PR extends `friction` and `agentTools`.
 */
import {
  FUNNEL_STEPS,
  type AnalyticsEvent,
  type AnalyticsFilter,
  type AnalyticsSummary,
  type SegmentKpis,
  type VisitorKind,
} from "@/lib/contracts";
import { eventStore } from "./store";

export function filterEvents(events: readonly AnalyticsEvent[], f: AnalyticsFilter = {}): AnalyticsEvent[] {
  return events.filter((e) => {
    const p = e.properties;
    if (f.from && e.timestamp < f.from) return false;
    if (f.to && e.timestamp > f.to) return false;
    if (f.visitorKind && (p.visitor_kind ?? "human") !== f.visitorKind) return false;
    if (f.experimentId && p.experiment_id !== f.experimentId) return false;
    if (f.variant && p.variant !== f.variant) return false;
    if (f.specVersion !== undefined && p.spec_version !== f.specVersion) return false;
    if (f.includeSynthetic === false && p.synthetic) return false;
    return true;
  });
}

export function computeKpis(events: readonly AnalyticsEvent[]): SegmentKpis {
  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const reached = new Map<string, Set<string>>(FUNNEL_STEPS.map((s) => [s, new Set()]));
  let orders = 0;
  let revenue = 0;

  // Agents never fire $pageview; treat their first agent_request as the entry step.
  for (const e of events) {
    visitors.add(e.distinct_id);
    if (e.properties.$session_id) sessions.add(e.properties.$session_id);
    const step = e.event === "agent_request" ? "$pageview" : e.event;
    reached.get(step)?.add(e.distinct_id);
    if (e.event === "order_completed") {
      orders++;
      revenue += Number(e.properties.revenue ?? 0);
    }
  }

  const first = Math.max(1, reached.get(FUNNEL_STEPS[0])!.size);
  const funnel = FUNNEL_STEPS.map((step, i) => {
    const n = reached.get(step)!.size;
    const prev = i === 0 ? n : reached.get(FUNNEL_STEPS[i - 1])!.size;
    return { step, visitors: n, rateFromStart: n / first, rateFromPrevious: prev ? n / prev : 0 };
  });

  const buyers = reached.get("order_completed")!.size;
  return {
    visitors: visitors.size,
    sessions: sessions.size,
    orders,
    revenue,
    conversionRate: visitors.size ? buyers / visitors.size : 0,
    averageOrderValue: orders ? revenue / orders : 0,
    funnel,
  };
}

export function getAnalyticsSummary(filter: AnalyticsFilter = {}): AnalyticsSummary {
  const events = filterEvents(eventStore().all(), filter);
  const byKind = (kind: VisitorKind) => computeKpis(events.filter((e) => (e.properties.visitor_kind ?? "human") === kind));
  return {
    from: events[0]?.timestamp ?? new Date().toISOString(),
    to: events.at(-1)?.timestamp ?? new Date().toISOString(),
    totalEvents: events.length,
    overall: computeKpis(events),
    byKind: { human: byKind("human"), agent: byKind("agent") },
    friction: [], // TODO(analytics): rage clicks, shipping shock, agent missing fields…
    agentTools: [], // TODO(analytics): per-tool calls/errors/missing fields
    filter,
  };
}
