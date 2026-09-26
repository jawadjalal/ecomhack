/**
 * Funnel drill-down and dashboard tabs. Pure functions over the site's events and plan: who dropped between two
 * steps (people vs AI agents), what they did last, and a few recent journeys. Only real recorded events; the
 * simulated share is reported so the console can label it.
 */
import type { AnalyticsEvent, FunnelDrill, TrackingPlan } from "@/lib/contracts";
import { isPreview } from "@/lib/web";
import { askForChart, type ChartAnswer } from "./charts";
export { BOARDS, boardsFor, boardNames } from "./boards";

const DEMO_STORE_SITE = "pace-store";

function siteEvents(site: string, all: readonly AnalyticsEvent[]): AnalyticsEvent[] {
  const isWhop = (e: AnalyticsEvent) => typeof e.properties?.whop_event === "string";
  const onSite =
    site === DEMO_STORE_SITE
      ? (e: AnalyticsEvent) => (!e.properties?.darwin_site || e.properties.darwin_site === site) && !isWhop(e)
      : (e: AnalyticsEvent) => e.properties?.darwin_site === site && !isWhop(e);
  return all.filter((e) => onSite(e) && !isPreview(e.properties?.$current_url));
}

const REASON_KEYS = ["abandon_reason", "reason", "drop_reason", "exit_reason"];
/** Housekeeping events: not a step anyone would call a step. */
const NOISE = new Set(["$pageleave", "$autocapture", "$darwin_web_exposure", "$identify", "$set"]);

/** Who reached step `step - 1` but not `step` of a funnel card, and why. step 0 = everyone who started. */
export function funnelDrill(site: string, plan: TrackingPlan | undefined, dashboardId: string, step: number, all: readonly AnalyticsEvent[]): FunnelDrill | undefined {
  const spec = plan?.dashboards.find((d) => d.id === dashboardId && d.kind === "funnel");
  const steps = spec?.events ?? [];
  if (!steps.length || step < 0 || step >= steps.length) return undefined;
  const label = (name: string) =>
    name === "$pageview" ? "Visited" : name === "$rageclick" ? "Repeated angry taps" : (plan?.events.find((e) => e.name === name)?.label ?? name.replace(/^\$/, "").replace(/_/g, " "));

  const byVisitor = new Map<string, AnalyticsEvent[]>();
  for (const e of siteEvents(site, all)) {
    const list = byVisitor.get(e.distinct_id);
    if (list) list.push(e);
    else byVisitor.set(e.distinct_id, [e]);
  }
  const people = [...byVisitor.entries()].filter(([, evs]) => evs.some((e) => e.event === "$pageview" || e.properties?.visitor_kind === "agent"));
  const reach = (evs: AnalyticsEvent[], upto: number) => steps.slice(0, upto + 1).every((s) => evs.some((e) => e.event === s));
  const prevPool = step === 0 ? people : people.filter(([, evs]) => reach(evs, step - 1));
  const dropped = step === 0 ? [] : prevPool.filter(([, evs]) => !reach(evs, step));
  const isAgent = (evs: AnalyticsEvent[]) => evs.some((e) => e.properties?.visitor_kind === "agent");
  const sorted = (evs: AnalyticsEvent[]) => [...evs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const reasons = new Map<string, number>();
  for (const [, evs] of dropped) {
    const s = sorted(evs);
    const explicit = [...s].reverse().map((e) => REASON_KEYS.map((k) => e.properties?.[k]).find((v) => typeof v === "string" && v.trim()))
      .find(Boolean) as string | undefined;
    const meaningful = s.filter((e) => !NOISE.has(e.event));
    const last = meaningful[meaningful.length - 1] ?? s[s.length - 1];
    const angry = s.some((e) => e.event === "$rageclick");
    const key = explicit
      ? `${isAgent(evs) ? "AI agent" : "Shopper"} said: ${explicit}`
      : angry
        ? `Repeated angry taps, then left`
        : `Left after “${label(last?.event ?? "")}”`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const journeys = dropped
    .map(([id, evs]) => ({ id, evs: sorted(evs) }))
    .sort((a, b) => (b.evs[b.evs.length - 1]?.timestamp ?? "").localeCompare(a.evs[a.evs.length - 1]?.timestamp ?? ""))
    .slice(0, 3)
    .map(({ id, evs }) => {
      const labels: string[] = [];
      for (const e of evs) {
        if (NOISE.has(e.event)) continue;
        const l = label(e.event);
        if (labels[labels.length - 1] !== l) labels.push(l);
      }
      return {
        id,
        kind: (isAgent(evs) ? "agent" : "human") as "agent" | "human",
        simulated: evs.some((e) => e.properties?.synthetic === true),
        at: evs[evs.length - 1]?.timestamp ?? "",
        steps: labels.slice(-6),
      };
    });
  const agents = dropped.filter(([, evs]) => isAgent(evs)).length;
  const simulated = dropped.filter(([, evs]) => evs.some((e) => e.properties?.synthetic === true)).length;
  return {
    dashboardId,
    step,
    from: step ? label(steps[step - 1]) : "",
    to: label(steps[step]),
    previous: prevPool.length,
    dropped: dropped.length,
    humans: dropped.length - agents,
    agents,
    share: prevPool.length ? dropped.length / prevPool.length : 0,
    simulated,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([text, count]) => ({ text, count })),
    journeys,
  };
}

/**
 * A new named dashboard ("my coupon launch"): 2 to 4 charts picked from what the merchant typed, each tagged with
 * the name. Reuses askForChart, so the charts are the same ones the "Ask for a chart" bar would make.
 */
export function newBoard(plan: TrackingPlan, name: string): { plan: TrackingPlan; reply: string; ids: string[]; board: string } {
  const board = name.trim().replace(/\s+/g, " ").slice(0, 40);
  const coupon = /coupon|discount|promo|code/i.test(board);
  const asks = [
    coupon ? "Coupon codes per day" : board,
    "Orders per day, people vs AI agents",
    "Steps from product view to order",
    coupon ? "When do people use coupons" : "When do people shop",
  ];
  let next = plan;
  const ids: string[] = [];
  for (const q of asks) {
    const before = new Set(next.dashboards.map((d) => d.id));
    const out: ChartAnswer = askForChart(next, q);
    if (!out.id || before.has(out.id)) continue;
    next = { ...out.plan, dashboards: out.plan.dashboards.map((d) => (d.id === out.id ? { ...d, board } : d)) };
    ids.push(out.id);
    if (ids.length >= 4) break;
  }
  const reply = ids.length
    ? `Made “${board}” with ${ids.length} chart${ids.length === 1 ? "" : "s"}. Ask for more charts to add them here.`
    : `I couldn't find charts for “${board}”. Try naming an event, like “coupon codes per day”.`;
  return { plan: next, reply, ids, board };
}

/** Put a chart the merchant just asked for into the tab they were looking at. */
export function assignBoard(plan: TrackingPlan, id: string | undefined, board: string | undefined): TrackingPlan {
  if (!id || !board || board === "Your charts") return plan;
  return { ...plan, dashboards: plan.dashboards.map((d) => (d.id === id && d.custom ? { ...d, board } : d)) };
}
