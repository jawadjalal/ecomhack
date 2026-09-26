/**
 * Agent telemetry fallback.
 *
 * The analytics module owns `friction` and `agentTools`. Until (or unless) it fills them, derive the
 * agent signals the analyst needs straight from raw events, so agent insights still cite real numbers:
 *   - `agent_request.properties.{tool, ok, missing[]}`  → per-tool calls/errors/missing + missing-field friction
 *   - `agent_abandoned.properties.reason`               → abandon friction, one signal per reason
 * If the summary already carries any agent telemetry it is returned untouched.
 */
import type { AgentToolStat, AnalyticsEvent, AnalyticsFilter, AnalyticsSummary, FrictionSignal } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { filterEvents } from "@/lib/analytics/summary";

export function hasAgentTelemetry(s: AnalyticsSummary): boolean {
  return (s.agentTools?.length ?? 0) > 0 || (s.friction ?? []).some((f) => f.audience === "agent");
}

export function agentTelemetryFromEvents(events: readonly AnalyticsEvent[]): {
  agentTools: AgentToolStat[];
  friction: FrictionSignal[];
} {
  const agents = new Set<string>();
  const tools = new Map<string, AgentToolStat>();
  const missingBy = new Map<string, Set<string>>();
  const abandonBy = new Map<string, Set<string>>();
  const addTo = (m: Map<string, Set<string>>, key: string, who: string) => {
    let s = m.get(key);
    if (!s) m.set(key, (s = new Set()));
    s.add(who);
  };

  for (const e of events) {
    const p = e.properties;
    if ((p.visitor_kind ?? "human") !== "agent") continue;
    agents.add(e.distinct_id);
    if (e.event === "agent_request") {
      const name = typeof p.tool === "string" && p.tool ? p.tool : "unknown";
      let t = tools.get(name);
      if (!t) tools.set(name, (t = { tool: name, calls: 0, errors: 0, missing: {} }));
      t.calls += 1;
      if (p.ok === false) t.errors += 1;
      for (const field of Array.isArray(p.missing) ? p.missing : []) {
        if (typeof field !== "string" || !field) continue;
        t.missing[field] = (t.missing[field] ?? 0) + 1;
        addTo(missingBy, field, e.distinct_id);
      }
    } else if (e.event === "agent_abandoned") {
      const reason = typeof p.reason === "string" && p.reason.trim() ? p.reason.trim().slice(0, 120) : "no reason given";
      addTo(abandonBy, reason, e.distinct_id);
    }
  }

  const n = Math.max(1, agents.size);
  const friction: FrictionSignal[] = [
    ...[...missingBy].map(([field, ids]) => ({
      kind: "agent_missing_field" as const,
      audience: "agent" as const,
      location: "agent API",
      count: ids.size,
      share: ids.size / n,
      detail: field,
    })),
    ...[...abandonBy].map(([reason, ids]) => ({
      kind: "agent_abandoned" as const,
      audience: "agent" as const,
      location: "agent session",
      count: ids.size,
      share: ids.size / n,
      detail: reason,
    })),
  ];
  return { agentTools: [...tools.values()], friction };
}

/** The summary, plus agent telemetry derived from raw events when the summary has none. */
export function withAgentTelemetry(
  summary: AnalyticsSummary,
  filter: AnalyticsFilter,
  events: readonly AnalyticsEvent[] = eventStore().all(),
): AnalyticsSummary {
  if (hasAgentTelemetry(summary)) return summary;
  const t = agentTelemetryFromEvents(filterEvents(events, filter));
  if (!t.agentTools.length && !t.friction.length) return summary;
  return { ...summary, agentTools: t.agentTools, friction: [...(summary.friction ?? []), ...t.friction] };
}
