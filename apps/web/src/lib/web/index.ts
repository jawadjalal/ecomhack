/**
 * Web personalization & experiments for any site running darwin.js. Public API of lib/web.
 *
 *   rules (store.ts) → runtime.js (runtime.ts, per site) → $darwin_web_exposure + conversions
 *   → results (results.ts, arms recomputed server-side) → ship or stop.
 */
import type { WebRulesResponse } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { computeSite, knownSites } from "./results";
import { listRules } from "./store";
import { getAutopilot } from "./autopilot";

export { buildRuntime, runtimeRules } from "./runtime";
export { classifySource, matchesAudience, assignWebVariant, fillValue, type Segment } from "./segment";
export {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  endRule,
  resetWebRules,
  WebRuleError,
  SiteSchema,
  WebRuleDraftSchema,
  WebRulePatchSchema,
  MAX_RULES_PER_SITE,
} from "./store";
export { computeSite, knownSites, stripPreviewParams, isPreview, EXPOSURE_EVENT } from "./results";
export { computeHeatmap, MAX_HEATMAP_ELEMENTS } from "./heatmap";
export { draftRule, heuristicDraft, suggestRules, rankSources, ideaDraft, ideasFor, PLAYBOOK, FOLLOW_UPS } from "./drafts";
export { getAutopilot, setAutopilot, stepAutopilot, resetAutopilot, judge, AUTOPILOT } from "./autopilot";
export { pageOutline, outlineFromHtml } from "./outline";
export { findClaims, unverifiedClaims, needsMerchant, readyToPublish, pageFacts, NEEDS } from "./claims";
export { simulateWebTraffic, changeEffect, MAX_SIM_VISITORS } from "./simulate";

/** The demo "any store" (plain HTML, not the PageSpec store) served at /demo/north-trail. */
export const DEMO_SITE = "north-trail";
export const DEMO_PATH = "/demo/north-trail";

/** Everything the personalize console shows for one site. */
export function webState(site: string): WebRulesResponse {
  const events = eventStore().all();
  const all = listRules();
  const rules = all.filter((r) => r.site === site);
  const { overview, results } = computeSite(site, rules, events);
  return { site, rules, results, overview, sites: knownSites(all, events), autopilot: getAutopilot(site) };
}

export { readJson, errorResponse, requestOrigin } from "./http";

/** The page to preview or fetch for a site: the latest real page seen, else the demo store for the demo site. */
export function siteUrl(site: string, origin: string, known?: string): string | undefined {
  if (known) return known;
  if (site === DEMO_SITE) return `${origin}${DEMO_PATH}`;
  return undefined;
}
