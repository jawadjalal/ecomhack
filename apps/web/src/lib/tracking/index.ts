/**
 * Tracking plans (what Darwin records for a store, and why) and the dashboards built from them.
 * Public API of lib/tracking, used by onboarding and /console/dashboards.
 */
import type { TrackingPlan } from "@/lib/contracts";
import { kvGet, kvUpdate } from "@/lib/db/json-store";

export { heuristicPlan, amendPlan, heuristicAmend, applyToggles, dashboardsFor, planIntro, trackingDoc, trackingSummary, AUTOMATIC, FUNNEL } from "./plan";
export { computeDashboards } from "./dashboards";

const KEY = "tracking-plans";

export function getPlan(site: string): TrackingPlan | undefined {
  return kvGet<Record<string, TrackingPlan>>(KEY, () => ({}))[site];
}

export function savePlan(plan: TrackingPlan): TrackingPlan {
  kvUpdate<Record<string, TrackingPlan>>(KEY, () => ({}), (all) => ({ ...all, [plan.site]: plan }));
  return plan;
}

export function listPlans(): TrackingPlan[] {
  return Object.values(kvGet<Record<string, TrackingPlan>>(KEY, () => ({})));
}

export function resetPlans() {
  kvUpdate<Record<string, TrackingPlan>>(KEY, () => ({}), () => ({}));
}
