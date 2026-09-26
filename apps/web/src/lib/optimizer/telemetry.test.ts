import { describe, expect, it } from "vitest";
import type { AnalyticsEvent, AnalyticsSummary } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { computeKpis } from "@/lib/analytics/summary";
import { diagnose, insightKind } from "./insights";
import { agentTelemetryFromEvents, withAgentTelemetry } from "./telemetry";

let n = 0;
function ev(event: string, id: string, properties: AnalyticsEvent["properties"]): AnalyticsEvent {
  return { uuid: `u${n++}`, event, distinct_id: id, timestamp: new Date().toISOString(), properties: { spec_version: 0, ...properties } };
}

function agentSession(id: string, missing: string[], reason?: string): AnalyticsEvent[] {
  const a = { visitor_kind: "agent" as const };
  return [
    ev("agent_request", id, { ...a, tool: "search_products", ok: true }),
    ev("agent_request", id, { ...a, tool: "get_product", ok: true, ...(missing.length ? { missing } : {}) }),
    ...(reason ? [ev("agent_abandoned", id, { ...a, reason })] : [ev("order_completed", id, { ...a, revenue: 11500 })]),
  ];
}

const EVENTS: AnalyticsEvent[] = [
  ...Array.from({ length: 40 }, (_, i) => agentSession(`a${i}`, ["deliveryEtaDays"], "no delivery ETA exposed; can't verify the brief")).flat(),
  ...Array.from({ length: 10 }, (_, i) => agentSession(`b${i}`, ["deliveryEtaDays", "landedPrice"])).flat(),
  ...Array.from({ length: 10 }, (_, i) => agentSession(`c${i}`, [])).flat(),
  ...Array.from({ length: 200 }, (_, i) => [ev("$pageview", `h${i}`, { visitor_kind: "human" })]).flat(),
];

function bareSummary(events: AnalyticsEvent[]): AnalyticsSummary {
  const agent = computeKpis(events.filter((e) => e.properties.visitor_kind === "agent"));
  const human = computeKpis(events.filter((e) => e.properties.visitor_kind !== "agent"));
  return { from: "", to: "", totalEvents: events.length, overall: computeKpis(events), byKind: { human, agent }, friction: [], agentTools: [] };
}

describe("agent telemetry fallback", () => {
  it("derives per-tool stats and distinct-agent friction from raw events", () => {
    const t = agentTelemetryFromEvents(EVENTS);
    const getProduct = t.agentTools.find((x) => x.tool === "get_product")!;
    expect(getProduct.calls).toBe(60);
    expect(getProduct.missing).toEqual({ deliveryEtaDays: 50, landedPrice: 10 });
    expect(t.friction).toContainEqual(
      expect.objectContaining({ kind: "agent_missing_field", audience: "agent", detail: "deliveryEtaDays", count: 50, share: 50 / 60 }),
    );
    expect(t.friction).toContainEqual(
      expect.objectContaining({ kind: "agent_abandoned", count: 40, detail: "no delivery ETA exposed; can't verify the brief" }),
    );
  });

  it("feeds agent insights that cite the real numbers", () => {
    const summary = withAgentTelemetry(bareSummary(EVENTS), { specVersion: 0 }, EVENTS);
    const insights = diagnose(summary, DEFAULT_SPEC);
    const eta = insights.find((i) => insightKind(i) === "agent_missing_eta")!;
    expect(eta.title).toBe("83% of AI shoppers asked for delivery ETA: we don't expose it");
    expect(eta.evidence).toContainEqual({ label: "Abandoned over it", value: "40" });
    expect(insights.some((i) => insightKind(i) === "agent_missing_landed_price")).toBe(true);
    expect(insights.some((i) => insightKind(i) === "agent_blind")).toBe(false);
  });

  it("leaves summaries that already carry agent telemetry untouched", () => {
    const s = { ...bareSummary(EVENTS), agentTools: [{ tool: "x", calls: 1, errors: 0, missing: {} }] };
    expect(withAgentTelemetry(s, {}, EVENTS)).toBe(s);
  });
});
