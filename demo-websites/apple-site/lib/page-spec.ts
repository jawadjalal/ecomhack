/**
 * PageSpec: Darwin's storefront config format (same schema as Darwin's `lib/contracts/page-spec.ts`).
 *
 * `storefront.config.json` holds one of these. Darwin's "ship the winner" PR rewrites that file, so every
 * knob below is rendered somewhere on this site. Keep this file in sync with Darwin's contract.
 */
import { z } from "zod";

export const PageSpecSchema = z.object({
  version: z.number().int().nonnegative(),
  label: z.string(),
  hero: z.object({
    headline: z.string().min(1).max(80),
    subheadline: z.string().max(200),
    ctaText: z.string().min(1).max(32),
    layout: z.enum(["split", "centered", "fullbleed"]),
    showSocialProof: z.boolean(),
  }),
  announcement: z.object({ enabled: z.boolean(), text: z.string().max(120) }),
  productGrid: z.object({
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    showRatings: z.boolean(),
    showQuickAdd: z.boolean(),
    sort: z.enum(["featured", "bestselling", "price-asc", "rating"]),
  }),
  productPage: z.object({
    ctaText: z.string().min(1).max(32),
    ctaPosition: z.enum(["above-fold", "below-description", "sticky"]),
    showReviews: z.boolean(),
    showSizeGuide: z.boolean(),
    showDeliveryEstimate: z.boolean(),
    showReturnsPolicy: z.boolean(),
    urgency: z.enum(["none", "low-stock"]),
    trustBadges: z.boolean(),
  }),
  cart: z.object({
    showShippingUpfront: z.boolean(),
    freeShippingThreshold: z.number().int().nonnegative().nullable(),
    upsell: z.boolean(),
  }),
  checkout: z.object({
    steps: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    guestCheckout: z.boolean(),
    expressPay: z.boolean(),
  }),
  theme: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    radius: z.enum(["none", "md", "full"]),
  }),
  agentSurface: z.object({
    structuredData: z.boolean(),
    exposeStock: z.boolean(),
    exposeDeliveryEta: z.boolean(),
    exposeReturnPolicy: z.boolean(),
    exposeLandedPrice: z.boolean(),
    negotiation: z.object({ enabled: z.boolean(), maxDiscountPct: z.number().min(0).max(30) }),
  }),
});

export type PageSpec = z.infer<typeof PageSpecSchema>;
