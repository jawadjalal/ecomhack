/**
 * Traffic analytics — public API. OWNED BY: traffic PR.
 *
 *   computeTrafficReport  sources, referring sites, search queries, campaigns, countries, landing pages, devices
 *   sharedTrafficReport   the same, memoised for a few seconds and shared by concurrent callers (API routes use this)
 *   withGeo               stamp the edge's country header on ingested events (ingest routes call this)
 *   simulatedCountry      deterministic country for synthetic visitors
 */
export { computeTrafficReport, computeTrafficReportAsync, DEMO_STORE_SITE, NOT_PROVIDED, TRAFFIC_DIMENSIONS } from "./report";
export type { TrafficDimension, TrafficReport, TrafficReportOptions, TrafficRow, TrafficTotals } from "./report";
export { clearTrafficReports, sharedTrafficReport, TRAFFIC_REPORT_TTL_MS } from "./cache";
export { countryFlag, countryFromHeaders, countryName, simulatedCountry, withGeo } from "./geo";
export { hostOf, referrerName, utmSourceName } from "./referrers";
export { heuristicInsights, llmInsights } from "./insights";
export type { InsightCategory, InsightsResponse, TrafficInsight } from "./insights";
