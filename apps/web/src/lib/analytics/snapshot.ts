/**
 * The one set of store numbers chat, overview cards and funnels cite.
 *
 * Demo mode (nothing connected) and an explicit in-browser demo (`simulatedOk`) use simulated
 * shoppers and say so. A connected store cites real events only. Simulated events are never
 * folded into those rates. When a question has no real data, callers say `emptyLine` and stop.
 */
import type { AnalyticsEvent, AnalyticsSummary } from "@/lib/contracts";
import { demoStatus } from "@/lib/demo";
import { eventStore } from "./store";
import { summarize } from "./summary";

export type NumbersKind = "real" | "simulated" | "empty";

export interface BrandRate {
  name: string;
  shoppers: number;
  bought: number;
  rate: number;
}

export interface StoreSnapshot {
  kind: NumbersKind;
  /** One line to say when `kind` is "empty". Empty string otherwise. */
  emptyLine: string;
  /** True when the numbers are simulated and must be labelled. Never true for a mixed rate. */
  simulated: boolean;
  summary: AnalyticsSummary;
  /** AI shoppers by brand, from the same events as `summary`. */
  brands: BrandRate[];
}

/** Group agent names into the brands the console shows (Perplexity, ChatGPT, Claude, Gemini, Grok…). */
export function brandOf(agentName: string): string {
  const n = agentName.toLowerCase();
  if (/perplex/.test(n)) return "Perplexity";
  if (/chatgpt|openai|gpt|oai-/.test(n)) return "ChatGPT";
  if (/claude|anthropic/.test(n)) return "Claude";
  if (/gemini|google|bard/.test(n)) return "Gemini";
  if (/grok|xai/.test(n)) return "Grok";
  if (/copilot|bing|microsoft/.test(n)) return "Copilot";
  return agentName || "Other agent";
}

/** Distinct agent visitors and buyers, from the same events a summary was built on. */
export function brandRates(events: readonly AnalyticsEvent[], includeSynthetic: boolean): BrandRate[] {
  const seen = new Map<string, { name: string; bought: boolean }>();
  for (const e of events) {
    const p = e.properties ?? {};
    if (!includeSynthetic && p.synthetic === true) continue;
    if (p.visitor_kind !== "agent") continue;
    const name = brandOf(typeof p.agent_name === "string" && p.agent_name ? p.agent_name : "Other agent");
    let row = seen.get(e.distinct_id);
    if (!row) seen.set(e.distinct_id, (row = { name, bought: false }));
    if (e.event === "order_completed") row.bought = true;
  }
  const acc = new Map<string, BrandRate>();
  for (const row of seen.values()) {
    const b = acc.get(row.name) ?? { name: row.name, shoppers: 0, bought: 0, rate: 0 };
    b.shoppers += 1;
    if (row.bought) b.bought += 1;
    b.rate = b.shoppers ? b.bought / b.shoppers : 0;
    acc.set(row.name, b);
  }
  return [...acc.values()].sort((a, b) => b.rate - a.rate || b.shoppers - a.shoppers);
}

/**
 * @param simulatedOk  Include simulated shoppers (demo mode, `?mock=1`, or a simulation the merchant
 *   asked to see). Default: demo mode, where simulated shoppers are the whole dataset. Pass `false`
 *   on a connected store so real and simulated never share a rate.
 */
export function storeSnapshot(opts?: { simulatedOk?: boolean }, events: readonly AnalyticsEvent[] = eventStore().all()): StoreSnapshot {
  const simulatedOk = opts?.simulatedOk ?? demoStatus().mode === "demo";
  const real = summarize(events, { includeSynthetic: false });
  // A connected store never folds simulated shoppers into the live rate.
  if (!simulatedOk || real.overall.visitors > 0) {
    if (real.overall.visitors === 0) {
      return {
        kind: "empty",
        emptyLine: simulatedOk ? "Overall: no visitors yet." : "No real shoppers yet.",
        simulated: false,
        summary: real,
        brands: [],
      };
    }
    return { kind: "real", emptyLine: "", simulated: false, summary: real, brands: brandRates(events, false) };
  }
  const summary = summarize(events);
  if (summary.overall.visitors === 0) {
    return { kind: "empty", emptyLine: "Overall: no visitors yet.", simulated: false, summary, brands: [] };
  }
  return { kind: "simulated", emptyLine: "", simulated: true, summary, brands: brandRates(events, true) };
}
