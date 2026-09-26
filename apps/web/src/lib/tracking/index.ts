/**
 * Tracking plans (what Darwin records for a store, and why) and the dashboards built from them.
 * Public API of lib/tracking, used by onboarding and /console/dashboards.
 */
import { createHash } from "node:crypto";
import type { TrackingPlan } from "@/lib/contracts";
import { kvGet, kvUpdate } from "@/lib/db/json-store";
import { heuristicPlan } from "./plan";

export { buildPlan, heuristicPlan, amendPlan, heuristicAmend, applyToggles, dashboardsFor, planIntro, trackingDoc, trackingSummary, AUTOMATIC, FUNNEL } from "./plan";
export { computeDashboards } from "./dashboards";
export { askForChart, removeChart, type ChartAnswer } from "./charts";
export { funnelDrill, newBoard, assignBoard } from "./drill";
export { boardsFor, boardNames, BOARDS } from "./boards";
export type { PlanInput } from "./plan";
export { TrackingPlanSchema } from "./schema";

const KEY = "tracking-plans";

/** The built-in demo store at /store (same id as lib/traffic's DEMO_STORE_SITE). Its events carry no darwin_site. */
export const DEMO_STORE_SITE = "pace-store";

/** Dashboard kinds that read darwin.js-only data (sources, heatmap, web rules): not on the demo store. */
const DARWIN_JS_ONLY = new Set(["sources", "heatmap", "experiments"]);

/**
 * The demo store's plan when nobody has planned it in onboarding: what the storefront already records
 * (page views, the product, cart, checkout, order funnel, AI agents), so /console/dashboards?site=pace-store
 * shows the same shoppers as the Overview from the first visit. Not saved: it doesn't count as a connected site.
 */
export function demoStorePlan(): TrackingPlan {
  const plan = heuristicPlan({
    site: DEMO_STORE_SITE,
    // Only goals the storefront already records (mobile adds the devices dashboard, no new events).
    prompt: "PACE, the demo running-shoe store at /store. People shop on mobile and desktop; AI agents shop too.",
    framework: "Next.js (App Router)",
    repoRead: false,
  });
  const epoch = new Date(0).toISOString();
  return { ...plan, dashboards: plan.dashboards.filter((d) => !DARWIN_JS_ONLY.has(d.kind)), createdAt: epoch, updatedAt: epoch };
}

export function getPlan(site: string): TrackingPlan | undefined {
  return kvGet<Record<string, TrackingPlan>>(KEY, () => ({}))[site] ?? (site === DEMO_STORE_SITE ? demoStorePlan() : undefined);
}

export function savePlan(plan: TrackingPlan): TrackingPlan {
  kvUpdate<Record<string, TrackingPlan>>(KEY, () => ({}), (all) => ({ ...all, [plan.site]: plan }));
  return plan;
}

/** The browser's copy of a plan, saved only when this instance has none for the site (see remember.ts). */
export function restorePlan(plan: TrackingPlan): { restored: boolean; plan: TrackingPlan } {
  const have = getPlan(plan.site);
  if (have) return { restored: false, plan: have };
  return { restored: true, plan: savePlan(plan) };
}

/* ------------------------------------------------------------------ stable plans */

const CACHE_KEY = "tracking-plan-cache";
const CACHE_MAX = 200;

/** Same key for the same store, description (case and spacing ignored) and answers, so regenerating is stable. */
export function planCacheKey(input: { site: string; source: "url" | "repo"; prompt?: string; whop?: string; answers?: unknown; context?: unknown }): string {
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
  const raw = JSON.stringify([input.site, input.source, norm(input.prompt), norm(input.whop), stable(input.answers ?? null), stable(input.context ?? null)]);
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function cachedPlan(key: string): TrackingPlan | undefined {
  return kvGet<Record<string, TrackingPlan>>(CACHE_KEY, () => ({}))[key];
}

export function cachePlan(key: string, plan: TrackingPlan): TrackingPlan {
  kvUpdate<Record<string, TrackingPlan>>(CACHE_KEY, () => ({}), (all) => {
    const next = { ...all };
    delete next[key];
    next[key] = plan;
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete next[k];
    return next;
  });
  return plan;
}

export function resetPlanCache() {
  kvUpdate<Record<string, TrackingPlan>>(CACHE_KEY, () => ({}), () => ({}));
}

export function listPlans(): TrackingPlan[] {
  return Object.values(kvGet<Record<string, TrackingPlan>>(KEY, () => ({})));
}

export function resetPlans() {
  kvUpdate<Record<string, TrackingPlan>>(KEY, () => ({}), () => ({}));
}
