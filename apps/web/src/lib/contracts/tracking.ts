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

export type DashboardKind = "kpis" | "funnel" | "sources" | "humans-agents" | "heatmap" | "experiments" | "revenue" | "events" | "devices";

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
  /** Nothing recorded yet for this dashboard. */
  empty: boolean;
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
// POST  /api/dashboards { site, remove: id }               → { plan } remove an asked-for chart  (admin)
// POST  /api/onboarding/restore { plan }                   → { restored, plan } browser copy → this instance, only if it has none (admin)
// GET   /api/onboarding/verify?site=…&url=…              → { verified, via?: "events"|"tag", host, checkedAt, detail } ownership proof, cached ~10 s (admin)
