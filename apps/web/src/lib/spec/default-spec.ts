import type { PageSpec } from "@/lib/contracts";

/**
 * Generation 0: a plausible but un-optimised store.
 *
 * It deliberately ships with the friction real stores have, so the loop has
 * something to find:
 *   - shipping cost only revealed at the last checkout step ("shipping shock")
 *   - add-to-cart button below the description
 *   - no reviews on product pages, no delivery estimate
 *   - 3-step checkout, account required
 *   - agent surface hides stock, delivery ETA, returns and landed price; no negotiation
 */
export const DEFAULT_SPEC: PageSpec = {
  version: 0,
  label: "Baseline",
  hero: {
    headline: "Engineered for every stride",
    subheadline: "Performance running shoes designed in London.",
    ctaText: "Explore collection",
    layout: "centered",
    showSocialProof: false,
  },
  announcement: { enabled: false, text: "" },
  productGrid: { columns: 3, showRatings: false, showQuickAdd: false, sort: "featured" },
  productPage: {
    ctaText: "Add to bag",
    ctaPosition: "below-description",
    showReviews: false,
    showSizeGuide: false,
    showDeliveryEstimate: false,
    showReturnsPolicy: false,
    urgency: "none",
    trustBadges: false,
  },
  cart: { showShippingUpfront: false, freeShippingThreshold: null, upsell: false },
  checkout: { steps: 3, guestCheckout: false, expressPay: false },
  theme: { accent: "#111827", radius: "md" },
  agentSurface: {
    structuredData: false,
    exposeStock: false,
    exposeDeliveryEta: false,
    exposeReturnPolicy: false,
    exposeLandedPrice: false,
    negotiation: { enabled: false, maxDiscountPct: 0 },
  },
};
