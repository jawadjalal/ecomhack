/**
 * Agent readiness audit (merchant tooling): can AI shopping agents find, understand and buy from a store?
 *
 *   const report = await auditStore("https://shop.example.com");
 *
 * Fetches a handful of pages in parallel (homepage, robots.txt, sitemap, llms.txt, agent card, MCP,
 * Shopify catalog, one product page), then scores them with the pure checks in ./checks.
 */
export { auditStore, auditWithArtifacts, normaliseStoreUrl } from "./audit";
export { BlockedUrlError, safeFetch } from "./fetcher";
export {
  evaluate,
  score,
  draftLlmsTxt,
  type Artifacts,
  type Fetched,
} from "./checks";
export {
  badgeSvg,
  certifyStore,
  certLevel,
  getCertificate,
  isExpired,
  recentCertificate,
  CERT_THRESHOLDS,
  CERT_VALID_DAYS,
  LEVEL_LABEL,
  type CertifyDeps,
} from "./certify";
export { clientKey, takeToken } from "./rate-limit";
