/**
 * Tracking plans (what Darwin records for a store, and why) and the dashboards built from them.
 * Public API of lib/tracking, used by onboarding and /console/dashboards.
 */
import { createHash } from "node:crypto";
import type { TrackingPlan } from "@/lib/contracts";
import { kvGet, kvUpdate } from "@/lib/db/json-store";

export { buildPlan, heuristicPlan, amendPlan, heuristicAmend, applyToggles, dashboardsFor, planIntro, trackingDoc, trackingSummary, AUTOMATIC, FUNNEL } from "./plan";
export { computeDashboards } from "./dashboards";
export { askForChart, removeChart, type ChartAnswer } from "./charts";
export type { PlanInput } from "./plan";
export { TrackingPlanSchema } from "./schema";

const KEY = "tracking-plans";

export function getPlan(site: string): TrackingPlan | undefined {
  return kvGet<Record<string, TrackingPlan>>(KEY, () => ({}))[site];
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
