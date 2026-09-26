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
