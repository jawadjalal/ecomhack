/**
 * "Show me coupon codes per minute": the merchant asks for a chart in plain English and it's added to
 * their dashboards. It charts events the plan already records, picks the chart from the words used
 * (funnel, by device, by source, clicks, revenue, AI agents), and if they ask for something the store
 * doesn't send yet, adds that event to the plan too, with its one line of code.
 */
import type { DashboardBreakdown, DashboardInterval, DashboardKind, DashboardSpec, TrackingEvent, TrackingPlan } from "@/lib/contracts";

/** Time series words ("per day", "over time"). "Per minute" alone stays the live events chart. */
const TIME = /\b(over time|per (hour|day|week)|each (hour|day)|daily|hourly|weekly|trends?|trending|by (day|hour)|day by day|timeline)\b/;

/** The newer, question-shaped charts, most specific first. */
const ASK_WORDS: [RegExp, DashboardKind][] = [
  [/\b(how long|time to (buy|order|convert|purchase|check ?out)|takes? (people |shoppers |customers |them )?to (buy|order|convert|purchase))\b/, "time_to_convert"],
  [/\b(new (vs|versus|and|or) (returning|repeat)|lifecycle|dormant|resurrect\w*|gone quiet|returning (shoppers|visitors|customers|people))\b/, "lifecycle"],
  [/\b(come back|comes back|came back|coming back|retention|retain\w*|repeat (visitors|shoppers|customers|buyers)|loyal\w*)\b/, "retention"],
  [/\b(paths?|journeys?|flows?|go next|go after|after (the|a|they|viewing|visiting|seeing)|next (page|step)|where (do|does) (people|shoppers|visitors|they|customers) go)\b/, "paths"],
  [/\b(when do|what time|times? of (the )?day|hour of (the )?day|busiest|peak (hours?|times?)|days? of (the )?week|weekdays?)\b/, "hourly"],
];

const INTERVAL: [RegExp, DashboardInterval][] = [
  [/\b(per|each|by|every) minute\b/, "minute"],
  [/\b((per|each|by|every) hour|hourly)\b/, "hour"],
  [/\b((per|each|by|every) (day|week)|daily|weekly|day by day)\b/, "day"],
];

const SPLIT: [RegExp, DashboardBreakdown][] = [
  [/\b(ai|agents?|bots?|humans? (vs|versus|and)|people (vs|versus|and))\b/, "visitor_kind"],
  [/\b(devices?|mobile|desktop|tablet|phones?)\b/, "device"],
  [/\b(sources?|channels?|referr\w*)\b/, "source"],
  [/\b(by|per) page\b/, "page"],
];

/** Everyday words for events every plan has (or that the merchant may mean). */
const SYNONYMS: [RegExp, string][] = [
  [/\b(add(s|ed)? to (cart|basket|bag)|carts?|baskets?)\b/, "product_added"],
  [/\b(orders?|ordered|buy\w*|bought|purchases?|sales|revenue|takings|money)\b/, "order_completed"],
  [/\bcheck ?outs?\b/, "checkout_started"],
  [/\b(product (page|view)s?|views? (a )?products?)\b/, "product_viewed"],
  [/\b(coupons?|discount codes?|promo codes?|vouchers?)\b/, "coupon_applied"],
  [/\b(visitors?|visits?|traffic|shoppers?|people|customers|page ?views?|views?|pages?|sessions?|shop)\b/, "$pageview"],
];

/** Property words ("which sizes") → the property to count. */
const PROPERTY: Record<string, string> = {
  size: "size",
  colour: "color",
  color: "color",
  product: "product_id",
  page: "page",
  device: "device",
  source: "source",
  channel: "source",
  code: "code",
  coupon: "code",
  country: "country",
  step: "step",
  query: "query",
  search: "query",
  term: "query",
  plan: "plan",
  reason: "reason",
  price: "price",
  variant: "variant",
  category: "category",
  agent: "visitor_kind",
};
const singular = (w: string) => w.replace(/(ies)$/, "y").replace(/(ches|shes|xes|ses)$/, (x) => x.slice(0, -2)).replace(/s$/, "");

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
    .replace(/\b(per|by|each|every|over|time|minute|minutes|hour|hours|day|days|week|daily|hourly|today|this|last|so far|total|trend|chart|graph|how many|number of|count of|the|a|an|of|show|me|which|most|top)\b/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);

export interface ChartAnswer {
  plan: TrackingPlan;
  reply: string;
  /** The new dashboard's id (to scroll to it). */
  id?: string;
}

/** The property a breakdown counts: "which sizes…" → size, "top products" → product_id. */
function propertyFor(m: string, event: TrackingEvent | undefined): string | undefined {
  const w = m.match(/\b(?:which|what|top(?: \d+)?|most (?:popular|common)|by|per|split by|breakdown of)\s+([a-z_]+)/)?.[1];
  const key = w ? singular(w) : undefined;
  if (key && PROPERTY[key]) return PROPERTY[key];
  if (key && event?.properties?.includes(key)) return key;
  return undefined;
}

/** Which chart the words ask for. Specific questions first, then time series, then the older kinds. */
function kindFor(m: string, plan: TrackingPlan, message: string): DashboardKind {
  const ask = ASK_WORDS.find(([re]) => re.test(m))?.[1];
  if (ask) return ask;
  const time = TIME.test(m);
  if (!time && /\b(which|top \d+|top|most (popular|common)|breakdown|split by)\b/.test(m)) {
    const prop = propertyFor(m, mentioned(plan, message)[0]);
    // "Which sources convert best" / "which devices" keep their own dashboards.
    if (prop && !["source", "device"].includes(prop)) return "breakdown";
    if (!prop && mentioned(plan, message).length) return "breakdown";
  }
  if (!time && /\b(how many|how much|total|today|this (week|hour)|(last|past) (hour|week|7 days)|so far|right now)\b/.test(m)) return "number";
  if (time) return "trend";
  return KIND_WORDS.find(([re]) => re.test(m))?.[1] ?? "events";
}

/** Kinds that chart one or more events (and may need one added to the plan). */
const EVENT_KINDS: DashboardKind[] = ["events", "trend", "number", "hourly", "breakdown"];

export function askForChart(plan: TrackingPlan, message: string): ChartAnswer {
  const m = ` ${words(message)} `;
  const kind = kindFor(m, plan, message);
  let events = mentioned(plan, message).filter((e) => e.enabled || e.automatic);
  // "AI agents" is a split, not an event: agents are told apart on their page views.
  if (kind !== "events") {
    const views = plan.events.find((e) => e.name === "$pageview");
    events = [...new Map(events.map((e) => (e.name === "agent_visit" && views ? views : e)).map((e) => [e.name, e])).values()];
  }
  let added: TrackingEvent | undefined;
  let next = plan;

  const heading = title(message);
  if (!heading) return { plan, reply: `Tell me what to chart, e.g. "coupon codes per minute" or "funnel from product view to order".` };
  // Whole-site views (devices, sources, clicks…) exist once: point to the one already there.
  if (["kpis", "sources", "humans-agents", "heatmap", "experiments", "revenue", "devices"].includes(kind)) {
    const have = plan.dashboards.find((d) => d.kind === kind);
    if (have) return { plan, id: have.id, reply: `You already have “${have.title}”: it's highlighted below.` };
  }
  // Everyday words ("orders", "add to cart", "people") for the kinds that chart an event.
  if (EVENT_KINDS.includes(kind) && kind !== "events" && events.length === 0) {
    const name = SYNONYMS.find(([re]) => re.test(m))?.[1];
    const have = name && plan.events.find((e) => e.name === name);
    if (have) {
      events = [have];
      if (!have.enabled) next = { ...plan, events: plan.events.map((e) => (e.name === name ? { ...e, enabled: true } : e)) };
    } else if (name === "coupon_applied") {
      added = { name, label: "Coupon applied", why: "Which codes drive orders, and which only cut margin.", category: "goal", automatic: false, properties: ["code", "valid"], snippet: `window.darwin?.capture("coupon_applied", { code: …, valid: … });`, enabled: true, fromPrompt: true };
      next = { ...plan, events: [...plan.events, added] };
      events = [added];
    }
  }
  if (EVENT_KINDS.includes(kind) && events.length === 0) {
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
    ...(kind === "events" || kind === "trend" ? { events: events.map((e) => e.name) } : {}),
    ...(["number", "hourly", "breakdown"].includes(kind) ? { events: [events[0].name] } : {}),
    ...(kind === "time_to_convert" ? { events: ["order_completed"] } : {}),
    ...shape(kind, m, plan, message, events[0]),
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

/** The options a new kind takes from the words: interval, split, period, property, where a path starts. */
function shape(kind: DashboardKind, m: string, plan: TrackingPlan, message: string, event: TrackingEvent | undefined): Partial<DashboardSpec> {
  const money = /\b(revenue|sales|takings|money|gbp|£)\b/.test(m) ? { property: "revenue" } : {};
  switch (kind) {
    case "trend": {
      const interval = INTERVAL.find(([re]) => re.test(m))?.[1];
      const breakdown = SPLIT.find(([re]) => re.test(m))?.[1];
      const display = /\b(bars?|columns?)\b/.test(m) ? "bars" : /\blines?\b/.test(m) ? "line" : undefined;
      return { ...(interval ? { interval } : {}), ...(breakdown ? { breakdown } : {}), ...(display ? { display } : {}), ...money };
    }
    case "number": {
      const period = /\b((this|last|past) hour|right now)\b/.test(m) ? "hour" : /\b((this|last|past) week|7 days)\b/.test(m) ? "week" : "today";
      const unique = event?.name === "$pageview" && /\b(visitors?|shoppers?|people|customers)\b/.test(m) ? { property: "distinct_id" } : {};
      return { period, ...unique, ...money };
    }
    case "breakdown":
      return { property: propertyFor(m, event) ?? event?.properties?.[0] ?? "device" };
    case "paths": {
      const page = message.match(/(^|\s)(\/[\w\-/]*)/)?.[2];
      if (page) return { from: page };
      if (/\b(home ?page|landing)\b/.test(m)) return { from: "/" };
      const ev = mentioned(plan, message)[0]?.name ?? SYNONYMS.find(([re]) => re.test(m))?.[1];
      return { from: ev && ev !== "$pageview" ? ev : "product_viewed" };
    }
    default:
      return {};
  }
}

/** Remove a chart the merchant asked for (built-in dashboards come from the plan's events). */
export function removeChart(plan: TrackingPlan, id: string): TrackingPlan {
  return { ...plan, dashboards: plan.dashboards.filter((d) => !(d.custom && d.id === id)), updatedAt: new Date().toISOString() };
}
