/**
 * Agent readiness audit: how well can AI shopping agents find, understand and buy from a store?
 * Produced by POST /api/readiness { url } (lib/readiness).
 */

export type ReadinessCategory = "access" | "understand" | "act";
export type CheckStatus = "pass" | "warn" | "fail";

export interface ReadinessFix {
  /** What to do, in one or two sentences. */
  summary: string;
  /** Copy-paste snippet (robots.txt lines, JSON-LD, llms.txt…), when one helps. */
  snippet?: string;
  snippetLang?: "text" | "json" | "html";
  /** Darwin can do this for the merchant (hosted agent layer / PR). */
  darwinCanFix?: boolean;
}

export interface ReadinessCheck {
  id: string;
  category: ReadinessCategory;
  title: string;
  status: CheckStatus;
  /** Points available for this check (weights sum to 100 across all scored checks). */
  weight: number;
  /** What we found, in plain words. */
  detail: string;
  /** Short facts backing the verdict ("robots.txt blocks OAI-SearchBot on /"). */
  evidence?: string[];
  fix?: ReadinessFix;
  /** Shown but not scored (e.g. emerging standards, business choices). */
  informational?: boolean;
}

export type StorePlatform = "shopify" | "woocommerce" | "bigcommerce" | "magento" | "wix" | "squarespace" | "nextjs" | "unknown";

export interface ReadinessReport {
  url: string;
  origin: string;
  platform: StorePlatform;
  /** 0–100. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  categories: Record<ReadinessCategory, { score: number; max: number }>;
  checks: ReadinessCheck[];
  /** The product page we inspected, if we found one. */
  productUrl?: string;
  /** Things we generated for the merchant from what we found. */
  generated: { llmsTxt: string };
  /** ISO-8601. */
  checkedAt: string;
  durationMs: number;
}

// POST /api/readiness { url } → ReadinessReport  (429 when rate limited, 400 for a bad or private URL)

/* ------------------------------------------------------------------ certificate */

// POST /api/readiness/certify { url } → ReadinessCertificate (lib/readiness/certify)

export type CertificateLevel = "gold" | "silver" | "bronze" | "none";

/** One tool call Grok made during an MCP shopping trial. */
export interface CertificateTrialStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Short result summary (or why the certifier blocked the call, e.g. checkout). */
  note: string;
  /** The certifier refused to run it (checkout/payment tools are never called). */
  blocked?: boolean;
  thought?: string;
}

/** Could an agent find this, from the trial or the page text? */
export interface CertificateCriterion {
  id: "price" | "variants" | "delivery" | "returns";
  label: string;
  status: "found" | "missing" | "not_applicable";
  evidence?: string;
}

export interface CertificateTrial {
  /** "mcp": Grok shopped over the store's MCP endpoint. "page": Grok read the storefront pages. */
  mode: "mcp" | "page";
  passed: boolean;
  summary: string;
  criteria: CertificateCriterion[];
  /** MCP transcript (mode "mcp"). */
  steps?: CertificateTrialStep[];
  durationMs: number;
}

export interface ReadinessCertificate {
  id: string;
  url: string;
  origin: string;
  level: CertificateLevel;
  /** Audit score 0–100 and grade at issue time. */
  score: number;
  grade: ReadinessReport["grade"];
  platform: StorePlatform;
  /** Plain-English verdict. */
  verdict: string;
  /** Absent for heuristic certificates (no LLM key, or the trial failed to run). */
  trial?: CertificateTrial;
  /** llmLabel() of the model that judged it ("llm:grok-4"), or "heuristic". */
  model: string;
  /** True when the level comes from the audit score alone. */
  heuristic: boolean;
  /** Why the heuristic path was used, when it was. */
  note?: string;
  /** ISO-8601. */
  issuedAt: string;
  /** ISO-8601, issuedAt + 90 days. */
  expiresAt: string;
}
