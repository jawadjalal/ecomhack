/**
 * Tracking plans and the dashboards built from them: the heart of onboarding.
 *
 *   merchant's words + their repo → TrackingPlan (what to record, and why) → install PR (darwin.js + the plan)
 *   → dashboards built from the plan → live data.
 */

export type TrackingCategory = "automatic" | "funnel" | "goal" | "revenue";

export interface TrackingEvent {
  /** Event name as sent: "$pageview", "product_added", "newsletter_signup". */
  name: string;
  /** Plain English: "Added to cart". */
  label: string;
  /** Why it's worth recording, tied to the merchant's goal when there is one. */
  why: string;
  category: TrackingCategory;
  /** darwin.js records it with no code (page views, clicks, sources, AI agents). */
  automatic: boolean;
  /** Properties worth sending with it. */
  properties?: string[];
  /** The line to add to the store (custom events only). */
  snippet?: string;
  enabled: boolean;
  /** Added because of something the merchant said (shown highlighted). */
  fromPrompt?: boolean;
}

export type DashboardKind =
  | "kpis"
  | "funnel"
  | "sources"
  | "humans-agents"
  | "heatmap"
  | "experiments"
  | "revenue"
  | "events"
  | "devices"
  /** Any event over time, optionally split (people vs agents, device, source), with the period before. */
  | "trend"
  /** One big number vs the period before, with a tiny sparkline. */
  | "number"
  /** Cohort grid: people first seen on a day, and how many came back N days later. */
  | "retention"
  /** The commonest journeys after a page or event. */
  | "paths"
  /** New / returning / coming back / gone quiet shoppers per period. */
  | "lifecycle"
  /** Top values of one property for an event ("which sizes are added to cart most"). */
  | "breakdown"
  /** How long people take from first visit to ordering. */
  | "time_to_convert"
  /** Day × hour grid of when an event happens. */
  | "hourly";

/** What a trend / breakdown is split by. */
export type DashboardBreakdown = "visitor_kind" | "device" | "source" | "page";
export type DashboardInterval = "minute" | "hour" | "day";

export interface DashboardSpec {
  id: string;
  kind: DashboardKind;
  title: string;
  /** One line: what question it answers for this merchant. */
  why: string;
  /** funnel: the steps in order; events: the events to chart. */
  events?: string[];
  /** Asked for by the merchant ("show coupon codes per minute"): kept when the plan changes, removable. */
  custom?: boolean;
  /** trend: split the line by this. */
  breakdown?: DashboardBreakdown;
  /** breakdown: the event property to count values of ("size"), or a DashboardBreakdown. */
  property?: string;
  /** trend / number: bucket size (auto from the data when unset). */
  interval?: DashboardInterval;
  /** trend: "line" (default) or "bars". */
  display?: "line" | "bars";
  /** number: the period counted. */
  period?: "hour" | "today" | "week";
  /** paths: start from this page ("/products") or event ("product_viewed"). */
  from?: string;
  /** The named dashboard (tab) this card belongs to, e.g. "My coupon launch". Unset: built-in tabs by kind. */
  board?: string;
}

export interface TrackingPlan {
  /** darwin.js data-darwin-site. */
  site: string;
  repo?: string;
  /** The store's URL when darwin.js goes in with one script tag instead of a GitHub pull request. */
  siteUrl?: string;
  /** Framework Darwin detected (or assumed), e.g. "Next.js (App Router)". */
  framework?: string;
  /** What the merchant told Darwin about the store. */
  prompt?: string;
  /** Whop business connected: payments and refunds arrive by webhook. */
  whop?: string;
  /** What Darwin heard in the prompt ("checkout", "mobile"), in order. */
  goals?: string[];
  /** False when Darwin couldn't read the repo (no GitHub access): framework is assumed, analytics unknown. */
  repoRead?: boolean;
  /** Analytics the store already runs (from its repo): darwin.js runs alongside, nothing is replaced. */
  existingAnalytics?: string[];
  events: TrackingEvent[];
  dashboards: DashboardSpec[];
  /** "heuristic" or "llm:<model>". */
  author: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ dashboard data */

export interface SeriesPoint {
  /** ISO minute. */
  t: string;
  v: number;
}

export interface DashboardData {
  id: string;
  kind: DashboardKind;
  title: string;
  why: string;
  custom?: boolean;
  /** kpis */
  kpis?: { label: string; value: string; hint?: string }[];
  /** funnel: visitors reaching each step (in order). */
  steps?: { event: string; label: string; visitors: number; rate: number }[];
  /** sources / humans-agents / devices: rows with visitors and conversion. */
  rows?: { key: string; label: string; visitors: number; conversions: number; rate: number }[];
  /** heatmap: most clicked elements. */
  clicks?: { label: string; selector: string; clicks: number; share: number; rage: number }[];
  /** experiments: running and finished web tests. */
  tests?: { name: string; audience: string; status: string; control: number; treatment: number; probability?: number; lift?: number }[];
  /** revenue / events: time series per minute, and totals. */
  series?: { name: string; label: string; total: number; points: SeriesPoint[] }[];
  /** trend: buckets and one series per breakdown value, plus the same span just before. */
  trend?: {
    interval: DashboardInterval;
    display: "line" | "bars";
    breakdown?: DashboardBreakdown;
    buckets: string[];
    series: { key: string; label: string; total: number; values: number[] }[];
    total: number;
    previousTotal: number;
    previous: number[];
    /** Values are revenue in pence. */
    money?: boolean;
  };
  /** number: the headline figure. */
  number?: { label: string; value: number; previous: number; change?: number; period: string; spark: number[]; money?: boolean };
  /** retention: cohorts by first-seen day; returned[n] = people seen again on day n (n = 0 is the first day). */
  retention?: { cohorts: { day: string; size: number; returned: number[] }[]; days: number };
  /** paths: top journeys after `from`, each a list of step labels, with how many people took it. */
  paths?: { from: string; fromLabel: string; total: number; paths: { steps: string[]; count: number }[] };
  /** lifecycle: shoppers per bucket, by state. Dormant is shown as a negative bar. */
  lifecycle?: { interval: DashboardInterval; rows: { t: string; new: number; returning: number; resurrecting: number; dormant: number }[] };
  /** breakdown: top values (max 8) of one property for an event. */
  bars?: { property: string; propertyLabel: string; event: string; total: number; items: { key: string; label: string; count: number; share: number }[] };
  /** time_to_convert: histogram of first visit → order. */
  histogram?: { bins: { label: string; count: number }[]; total: number; medianMs?: number };
  /** hourly: rows = days (Mon…Sun), cols = hours 0–23, counts in UTC. */
  grid?: { days: string[]; cells: number[][]; max: number; peak?: { day: string; hour: number; count: number }; total: number };
  /** A plain-words hint when the card is empty for a reason the merchant can fix. */
  note?: string;
  /** Share of the events behind this card that were simulated (0–1); undefined when none. */
  simulated?: number;
  /** Nothing recorded yet for this dashboard. */
  empty: boolean;
  /** The named dashboard (tab) this card belongs to; see DashboardSpec.board. */
  board?: string;
  /** funnel: the events behind the steps (for tabs). */
  events?: string[];
}

/** GET /api/dashboards?site=…&drill=<funnel id>&step=<n>: who dropped between step n-1 and n, and why. */
export interface FunnelDrill {
  dashboardId: string;
  step: number;
  /** Step label before the drop ("" for the first step). */
  from: string;
  to: string;
  /** Visitors who reached the step before. */
  previous: number;
  dropped: number;
  humans: number;
  agents: number;
  /** dropped / previous (0–1). */
  share: number;
  /** How many of the dropped visitors were simulated. */
  simulated: number;
  reasons: { text: string; count: number }[];
  journeys: { id: string; kind: "human" | "agent"; simulated: boolean; at: string; steps: string[] }[];
}

export interface DashboardsResponse {
  site: string;
  plan?: TrackingPlan;
  dashboards: DashboardData[];
  /** Events seen so far for the site, by name (for the "recording data" checklist). */
  seen: Record<string, number>;
  /** How many of the site's events were simulated. */
  syntheticEvents: number;
  totalEvents: number;
}

// POST  /api/onboarding/plan { prompt?, repoUrl | siteUrl, whop?, answers?, regenerate? } → { plan, reply, cached, note?, snippet? } same inputs → same plan (admin)
// PATCH /api/onboarding/plan { site, message }             → { plan, reply } chat amend         (admin)
// PUT   /api/onboarding/plan { plan }                      → { plan } toggles saved            (admin)
// GET   /api/dashboards?site=…                             → DashboardsResponse               (admin)
// POST  /api/dashboards { site, message }                  → { plan, reply, id } ask for a chart (admin)
// GET   /api/dashboards?site=…&drill=<id>&step=<n>          → { drill: FunnelDrill } funnel drop drill-down (admin)
// POST  /api/dashboards { site, board: name }              → { plan, reply, ids, board } new named dashboard (admin)
// POST  /api/dashboards { site, remove: id }               → { plan } remove an asked-for chart  (admin)
// POST  /api/onboarding/restore { plan }                   → { restored, plan } browser copy → this instance, only if it has none (admin)
// GET   /api/onboarding/verify?site=…&url=…              → { verified, via?: "events"|"tag", host, checkedAt, detail } ownership proof, cached ~10 s (admin)
// GET   /api/onboarding/inspect?url=…                     → { host, reachable, platform, signals, title? } store platform from its homepage, cached 10 min (admin)
