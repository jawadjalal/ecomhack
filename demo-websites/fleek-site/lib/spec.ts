/**
 * PageSpec: Darwin's config format (same shape as Darwin's `PageSpec` contract). Everything this store
 * does that affects conversion reads from it, so a Darwin "ship the winner" PR that edits
 * `storefront.config.json` changes the store with no code change.
 */
import gen0 from "../configs/gen0.json";

export type HeroLayout = "split" | "centered" | "fullbleed";
export type CtaPosition = "above-fold" | "below-description" | "sticky";
export type GridSort = "featured" | "bestselling" | "price-asc" | "rating";

export interface PageSpec {
  version: number;
  label: string;
  hero: { headline: string; subheadline: string; ctaText: string; layout: HeroLayout; showSocialProof: boolean };
  announcement: { enabled: boolean; text: string };
  productGrid: { columns: 2 | 3 | 4; showRatings: boolean; showQuickAdd: boolean; sort: GridSort };
  productPage: {
    ctaText: string;
    ctaPosition: CtaPosition;
    showReviews: boolean;
    showSizeGuide: boolean;
    showDeliveryEstimate: boolean;
    showReturnsPolicy: boolean;
    urgency: "none" | "low-stock";
    trustBadges: boolean;
  };
  cart: { showShippingUpfront: boolean; freeShippingThreshold: number | null; upsell: boolean };
  checkout: { steps: 1 | 2 | 3; guestCheckout: boolean; expressPay: boolean };
  theme: { accent: string; radius: "none" | "md" | "full" };
  agentSurface: {
    structuredData: boolean;
    exposeStock: boolean;
    exposeDeliveryEta: boolean;
    exposeReturnPolicy: boolean;
    exposeLandedPrice: boolean;
    negotiation: { enabled: boolean; maxDiscountPct: number };
  };
}

/** Generation 0: the committed baseline with the planted mistakes (configs/gen0.json). */
export const GEN0_SPEC = gen0 as PageSpec;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge `over` onto `base`, keeping only keys (and value types) the base knows about. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, b] of Object.entries(base)) {
    const v = over[k];
    if (v === undefined) continue;
    if (isObj(b)) out[k] = merge(b, v);
    else if (b === null || v === null || typeof v === typeof b) out[k] = v;
  }
  return out as T;
}

const oneOf = <T extends string | number>(v: T, allowed: readonly T[], fallback: T): T => (allowed.includes(v) ? v : fallback);

/**
 * Parse any JSON into a safe PageSpec: unknown keys dropped, missing keys from Gen 0, enums clamped.
 * A bad edit to the config file degrades to Gen 0 behaviour instead of crashing the store.
 */
export function normalizeSpec(raw: unknown): PageSpec {
  const s = merge(GEN0_SPEC, raw);
  s.hero.layout = oneOf(s.hero.layout, ["split", "centered", "fullbleed"] as const, "centered");
  s.productGrid.columns = oneOf(s.productGrid.columns, [2, 3, 4] as const, 3);
  s.productGrid.sort = oneOf(s.productGrid.sort, ["featured", "bestselling", "price-asc", "rating"] as const, "featured");
  s.productPage.ctaPosition = oneOf(s.productPage.ctaPosition, ["above-fold", "below-description", "sticky"] as const, "below-description");
  s.productPage.urgency = oneOf(s.productPage.urgency, ["none", "low-stock"] as const, "none");
  s.checkout.steps = oneOf(s.checkout.steps, [1, 2, 3] as const, 3);
  s.theme.radius = oneOf(s.theme.radius, ["none", "md", "full"] as const, "md");
  if (!/^#[0-9a-fA-F]{6}$/.test(s.theme.accent)) s.theme.accent = GEN0_SPEC.theme.accent;
  return s;
}

/** Readable label for the footer badge: "Gen 0 · Baseline". */
export function specBadge(spec: PageSpec): string {
  const m = spec.label.match(/^\s*gen(?:eration)?\s*(\d+)\s*[:\-–—]\s*(.*)$/i);
  if (m) return `Gen ${m[1]} · ${m[2] || "Darwin"}`;
  return `v${spec.version} · ${spec.label}`;
}
