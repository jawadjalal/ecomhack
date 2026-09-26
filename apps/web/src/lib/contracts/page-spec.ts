/**
 * PageSpec: the declarative description of the storefront.
 *
 * This is the one object the whole loop revolves around:
 *   - the storefront renders from it (humans),
 *   - the agent API exposes data according to `agentSurface` (AI shoppers),
 *   - the simulator's behaviour model reacts to it,
 *   - the optimizer proposes changes to it as a `SpecPatch`,
 *   - the GitHub integration ships winning specs as a PR editing `storefront.config.json`.
 *
 * Keeping changes declarative (instead of free-form code edits) is what makes the
 * self-improvement loop safe and demoable: every change is validated, diffable,
 * A/B testable and reversible.
 */
import { z } from "zod";

export const HeroSchema = z.object({
  headline: z.string().min(1).max(80),
  subheadline: z.string().max(200),
  ctaText: z.string().min(1).max(32),
  layout: z.enum(["split", "centered", "fullbleed"]),
  /** Star rating + "12,000 runners" strip under the hero. */
  showSocialProof: z.boolean(),
});

export const AnnouncementSchema = z.object({
  enabled: z.boolean(),
  text: z.string().max(120),
});

export const ProductGridSchema = z.object({
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  showRatings: z.boolean(),
  showQuickAdd: z.boolean(),
  sort: z.enum(["featured", "bestselling", "price-asc", "rating"]),
});

export const ProductPageSchema = z.object({
  ctaText: z.string().min(1).max(32),
  /** Where the add-to-cart button sits. "below-description" is a classic friction point. */
  ctaPosition: z.enum(["above-fold", "below-description", "sticky"]),
  showReviews: z.boolean(),
  showSizeGuide: z.boolean(),
  showDeliveryEstimate: z.boolean(),
  showReturnsPolicy: z.boolean(),
  urgency: z.enum(["none", "low-stock"]),
  trustBadges: z.boolean(),
});

export const CartSchema = z.object({
  /** Show shipping cost in the cart instead of revealing it at the last checkout step. */
  showShippingUpfront: z.boolean(),
  /** Free shipping over this amount (pence). null = never free. */
  freeShippingThreshold: z.number().int().nonnegative().nullable(),
  /** "Complete the look" cross-sell in the cart. */
  upsell: z.boolean(),
});

export const CheckoutSchema = z.object({
  steps: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  guestCheckout: z.boolean(),
  expressPay: z.boolean(),
});

export const ThemeSchema = z.object({
  /** CSS colour for primary actions. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  radius: z.enum(["none", "md", "full"]),
});

/** What AI shopping agents can see and do. Optimizable just like the human UI. */
export const AgentSurfaceSchema = z.object({
  /** schema.org Product JSON-LD on product pages. */
  structuredData: z.boolean(),
  /** Per-size stock levels in catalog responses. */
  exposeStock: z.boolean(),
  /** Delivery ETA (days) in catalog responses. */
  exposeDeliveryEta: z.boolean(),
  /** Return policy in catalog responses. */
  exposeReturnPolicy: z.boolean(),
  /** Total price incl. shipping in catalog responses (agents compare landed cost). */
  exposeLandedPrice: z.boolean(),
  negotiation: z.object({
    enabled: z.boolean(),
    /** Max discount the merchant agent may concede, percent. */
    maxDiscountPct: z.number().min(0).max(30),
  }),
});

export const PageSpecSchema = z.object({
  /** Monotonic version; bumped every time a spec is promoted to live. */
  version: z.number().int().nonnegative(),
  /** Human label, e.g. "Baseline" or "Gen 3: shipping upfront". */
  label: z.string(),
  hero: HeroSchema,
  announcement: AnnouncementSchema,
  productGrid: ProductGridSchema,
  productPage: ProductPageSchema,
  cart: CartSchema,
  checkout: CheckoutSchema,
  theme: ThemeSchema,
  agentSurface: AgentSurfaceSchema,
});

export type PageSpec = z.infer<typeof PageSpecSchema>;

/** A deep-partial PageSpec. `version`/`label` are set by the system, not patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
export type SpecPatch = DeepPartial<Omit<PageSpec, "version" | "label">>;
