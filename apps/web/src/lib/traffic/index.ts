/**
 * Traffic analytics — public API. OWNED BY: traffic PR.
 *
 *   computeTrafficReport  sources, referring sites, search queries, campaigns, countries, landing pages, devices
 *   withGeo               stamp the edge's country header on ingested events (ingest routes call this)
 *   simulatedCountry      deterministic country for synthetic visitors
 */
export { computeTrafficReport, DEMO_STORE_SITE, NOT_PROVIDED, TRAFFIC_DIMENSIONS } from "./report";
export type { TrafficDimension, TrafficReport, TrafficRow, TrafficTotals } from "./report";
export { countryFlag, countryFromHeaders, countryName, simulatedCountry, withGeo } from "./geo";
export { hostOf, referrerName, utmSourceName } from "./referrers";
