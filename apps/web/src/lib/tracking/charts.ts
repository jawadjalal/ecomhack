/**
 * "Show me coupon codes per minute": the merchant asks for a chart in plain English and it's added to
 * their dashboards. It charts events the plan already records, picks the chart from the words used
 * (funnel, by device, by source, clicks, revenue, AI agents), and if they ask for something the store
 * doesn't send yet, adds that event to the plan too, with its one line of code.
 */
import type { DashboardKind, DashboardSpec, TrackingEvent, TrackingPlan } from "@/lib/contracts";

const KIND_WORDS: [RegExp, DashboardKind][] = [
  [/\bfunnel|drop.?off|steps?\b/, "funnel"],
  [/\b(devices?|mobile|desktop|tablet|phones?)\b/, "devices"],
  [/\b(sources?|channels?|referr|where .* come from|traffic)\b/, "sources"],
  [/\b(clicks?|heat ?map|rage)\b/, "heatmap"],
  [/\b(revenue|sales|money|takings|gmv)\b/, "revenue"],
  [/\b(ai|agents?|bots?|chatgpt)\b/, "humans-agents"],
  [/\b(tests?|experiments?|a\/b)\b/, "experiments"],
];

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Plan events the message names, in the order it names them. */
function mentioned(plan: TrackingPlan, message: string): TrackingEvent[] {
  const m = ` ${words(message)} `;
  const hits: { e: TrackingEvent; at: number }[] = [];
  for (const e of plan.events) {
    const keys = [words(e.label), words(e.name.replace(/^\$/, "").replace(/_/g, " "))].filter((k) => k.length > 3);
    // Also match the label's main noun ("coupon" for "Coupon applied", "wishlist" for "Saved to wishlist").
    const nouns = words(e.label)
      .split(" ")
      .filter((w) => w.length > 5 && !["viewed", "placed", "started", "opened", "checked", "picked"].includes(w));
    const at = Math.min(...[...keys, ...nouns].map((k) => m.indexOf(` ${k}`)).filter((i) => i >= 0), Infinity);
    if (at !== Infinity) hits.push({ e, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.e);
}

/** The message without "show me a chart of…", capitalised; "" when nothing's left. */
const title = (message: string) => {
  const t = message
    .trim()
    .replace(/^(please\s+)?(can you\s+)?(show( me)?|add|make|give me|chart|plot|graph|build)\s+(a |an |the )?(chart|graph|dashboard|plot)?\s*(of|for|with|showing)?\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
  return /[a-z]{3}/i.test(t) ? (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 48) : "";
};

const eventName = (s: string) =>
  words(s)
    .replace(/\b(per|by|each|every|over|time|minute|minutes|hour|day|daily|chart|graph|how many|number of|count of|the|a|an|of|show|me)\b/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);

export interface ChartAnswer {
  plan: TrackingPlan;
  reply: string;
  /** The new dashboard's id (to scroll to it). */
  id?: string;
}

export function askForChart(plan: TrackingPlan, message: string): ChartAnswer {
  const m = ` ${words(message)} `;
  const kind: DashboardKind = KIND_WORDS.find(([re]) => re.test(m))?.[1] ?? "events";
  let events = mentioned(plan, message).filter((e) => e.enabled || e.automatic);
  let added: TrackingEvent | undefined;
  let next = plan;

  const heading = title(message);
  if (!heading) return { plan, reply: `Tell me what to chart, e.g. "coupon codes per minute" or "funnel from product view to order".` };
  // Whole-site views (devices, sources, clicks…) exist once: point to the one already there.
  if (!["events", "funnel"].includes(kind)) {
    const have = plan.dashboards.find((d) => d.kind === kind);
    if (have) return { plan, id: have.id, reply: `You already have “${have.title}”: it's highlighted below.` };
  }
  if (kind === "events" && events.length === 0) {
    const name = eventName(heading);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return { plan, reply: `Tell me what to chart, e.g. "coupon codes per minute" or "funnel from product view to order".` };
    const existing = plan.events.find((e) => e.name === name);
    added = existing ?? {
      name,
      label: heading,
      why: `You asked for a chart of it.`,
      category: "goal",
      automatic: false,
      properties: [],
      snippet: `window.darwin?.capture("${name}");`,
      enabled: true,
      fromPrompt: true,
    };
    next = { ...plan, events: existing ? plan.events.map((e) => (e.name === name ? { ...e, enabled: true } : e)) : [...plan.events, added] };
    events = [added];
  }

  const n = plan.dashboards.filter((d) => d.custom).length + 1;
  const spec: DashboardSpec = {
    id: `custom-${n}-${Date.now().toString(36)}`,
    kind,
    title: heading,
    why: `You asked: “${message.trim().slice(0, 120)}”`,
    custom: true,
    ...(kind === "funnel" ? { events: events.length >= 2 ? events.map((e) => e.name) : ["$pageview", "product_viewed", "product_added", "checkout_started", "order_completed"] } : {}),
    ...(kind === "events" ? { events: events.map((e) => e.name) } : {}),
  };
  const planOut: TrackingPlan = { ...next, dashboards: [...next.dashboards, spec], updatedAt: new Date().toISOString() };
  const needsCode = added && !plan.events.some((e) => e.name === added!.name);
  return {
    plan: planOut,
    id: spec.id,
    reply: needsCode
      ? `Added “${spec.title}”. Your store doesn't send ${added!.name} yet: add ${added!.snippet} where it happens, and the chart fills in.`
      : `Added “${spec.title}” to your dashboards.`,
  };
}

/** Remove a chart the merchant asked for (built-in dashboards come from the plan's events). */
export function removeChart(plan: TrackingPlan, id: string): TrackingPlan {
  return { ...plan, dashboards: plan.dashboards.filter((d) => !(d.custom && d.id === id)), updatedAt: new Date().toISOString() };
}
