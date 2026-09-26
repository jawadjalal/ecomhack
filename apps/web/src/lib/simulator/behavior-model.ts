/**
 * Darwin behaviour model for synthetic HUMAN shoppers.
 *
 * Maps a PageSpec to per-persona funnel probabilities. It is deliberately small and readable, because
 * the demo's claim ("conversion climbs because the page got better") is only as honest as this file.
 *
 * How it works
 * ------------
 * 1. Five personas (traffic share, device mix, intent) each have a BASE probability for every funnel
 *    stage, measured against a "plain" page: CTA above the fold, guest checkout, shipping visible,
 *    no reviews/badges/extras.
 * 2. Every PageSpec knob that matters has a documented `KnobEffect`: an ODDS multiplier on one stage,
 *    optionally different per persona and per device, with a one-line CRO rationale.
 *    p' = sigmoid(logit(p_base) + Σ ln(multiplier)). Odds (not probabilities) are multiplied so
 *    effects stack with diminishing returns and never push p outside (0, 1).
 * 3. A few mechanics are not simple odds tweaks and live in small tables below: the account wall,
 *    shipping shock, checkout length, express pay adoption, upsell/top-up behaviour.
 *
 * Outcomes depend ONLY on the spec a visitor is served (plus their persona/device and the catalog).
 * There is no notion of "variant" or "experiment" anywhere in this file.
 *
 * Double-edged knobs (so not every change wins): low-stock urgency (impulse +, researcher −),
 * 4-column grid (desktop +, mobile −), cart upsell (AOV +, conversion slightly −), price-asc sort
 * (bargain +, premium perception −), full-bleed hero (desktop +, mobile −). Copy changes (CTA text,
 * headlines) have a tiny, unpredictable effect: ±3–4% odds from a hash of the text.
 * Theme accent/radius are neutral.
 *
 * Calibration (see simulator tests): DEFAULT_SPEC humans convert ~2.0–2.6% (orders/visitors);
 * `bestKnownSpec()` ~4.5–5.5%.
 */
import type { PageSpec, SpecPatch } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { hashString } from "./rng";

/* ------------------------------------------------------------------ personas */

export const PERSONAS = ["bargain-hunter", "mobile-skimmer", "researcher", "impulse-buyer", "gift-shopper"] as const;
export type Persona = (typeof PERSONAS)[number];
export type Device = "Mobile" | "Desktop" | "Tablet";

/**
 * Funnel stages with a modelled probability:
 *   browse   landing → views at least one product
 *   add      considering a product → adds it to the cart
 *   cart     added → opens the cart
 *   checkout cart → starts checkout
 *   step     per checkout page → continues (see CHECKOUT_PAGE_EQUIVALENTS)
 *   pay      final payment → order completes
 */
export type Stage = "browse" | "add" | "cart" | "checkout" | "step" | "pay";

export interface PersonaProfile {
  id: Persona;
  description: string;
  /** Share of human traffic. */
  share: number;
  devices: Record<Device, number>;
  /** Stage probabilities on a plain, friction-free page (desktop). */
  base: Record<Stage, number>;
  /** How many product pages they look at before deciding: [count, weight]. */
  productsViewed: [number, number][];
  /** Multiplier on how long they dwell on pages. */
  dwell: number;
}

export const PERSONA_PROFILES: Record<Persona, PersonaProfile> = {
  "bargain-hunter": {
    id: "bargain-hunter",
    description: "Price-driven. Hunts compare-at discounts, hates surprise shipping, loves free-shipping thresholds.",
    share: 0.24,
    devices: { Mobile: 0.55, Desktop: 0.4, Tablet: 0.05 },
    base: { browse: 0.62, add: 0.13, cart: 0.86, checkout: 0.6, step: 0.95, pay: 0.95 },
    productsViewed: [[1, 0.45], [2, 0.35], [3, 0.2]],
    dwell: 1.1,
  },
  "mobile-skimmer": {
    id: "mobile-skimmer",
    description: "Thumb-scrolling on a phone. Needs the buy button in reach, short checkout, express pay.",
    share: 0.28,
    devices: { Mobile: 0.92, Desktop: 0.03, Tablet: 0.05 },
    base: { browse: 0.58, add: 0.135, cart: 0.82, checkout: 0.62, step: 0.95, pay: 0.96 },
    productsViewed: [[1, 0.75], [2, 0.2], [3, 0.05]],
    dwell: 0.6,
  },
  researcher: {
    id: "researcher",
    description: "Reads everything. Wants reviews, size guide, returns and delivery info. Distrusts urgency.",
    share: 0.22,
    devices: { Mobile: 0.3, Desktop: 0.65, Tablet: 0.05 },
    base: { browse: 0.72, add: 0.125, cart: 0.9, checkout: 0.66, step: 0.96, pay: 0.96 },
    productsViewed: [[1, 0.25], [2, 0.4], [3, 0.35]],
    dwell: 1.8,
  },
  "impulse-buyer": {
    id: "impulse-buyer",
    description: "Buys on a feeling. Moved by social proof, scarcity, quick add and one-tap pay.",
    share: 0.16,
    devices: { Mobile: 0.7, Desktop: 0.25, Tablet: 0.05 },
    base: { browse: 0.64, add: 0.17, cart: 0.88, checkout: 0.68, step: 0.95, pay: 0.96 },
    productsViewed: [[1, 0.7], [2, 0.25], [3, 0.05]],
    dwell: 0.7,
  },
  "gift-shopper": {
    id: "gift-shopper",
    description: "Buying for someone else. Needs a delivery date, easy returns and sizing help.",
    share: 0.1,
    devices: { Mobile: 0.45, Desktop: 0.5, Tablet: 0.05 },
    base: { browse: 0.66, add: 0.115, cart: 0.9, checkout: 0.64, step: 0.95, pay: 0.95 },
    productsViewed: [[1, 0.4], [2, 0.4], [3, 0.2]],
    dwell: 1.2,
  },
};

/**
 * Device odds applied to every persona's base. Phones convert worse at every step that needs
 * typing or precision (industry mobile CR is roughly half of desktop).
 */
export const DEVICE_ODDS: Record<Device, Partial<Record<Stage, number>>> = {
  Desktop: {},
  Tablet: { add: 0.95, step: 0.9 },
  Mobile: { browse: 0.95, add: 0.88, checkout: 0.9, step: 0.72, pay: 0.95 },
};

/* ------------------------------------------------------------------ knob effects */

/** Where on the site the visitor is deciding (quick add from the grid skips the product page). */
export type Surface = "grid" | "pdp";

export interface FunnelContext {
  device: Device;
  /** Product being considered (add stage). */
  product?: Product;
  /** Add-stage surface. Default "pdp". */
  surface?: Surface;
  /** Cart subtotal in pence (checkout stage). */
  subtotal?: number;
}

type Multipliers = Partial<Record<Persona, number>>;

export interface KnobEffect {
  id: string;
  /** Spec path(s) this effect reads, for display. */
  knob: string;
  stage: Stage;
  /** Only for add-stage effects: which surface shows the element. Default: both. */
  surface?: Surface;
  when: (spec: PageSpec, ctx: FunnelContext) => boolean;
  /** Odds multiplier for everyone (default 1). */
  all?: number;
  /** Extra odds multiplier per persona (default 1). */
  persona?: Multipliers;
  /** Extra odds multiplier per device (default 1). */
  device?: Partial<Record<Device, number>>;
  /** Spec-dependent multiplier (copy effects). */
  factor?: (spec: PageSpec) => number;
  rationale: string;
}

/** Free shipping applies when the threshold is set and the subtotal reaches it. */
export function shippingFor(spec: PageSpec, subtotal: number): number {
  const t = spec.cart.freeShippingThreshold;
  return t !== null && subtotal >= t ? 0 : SHIPPING_FEE;
}

const FREE_DELIVERY_RE = /free\s+(uk\s+|next[- ]day\s+|express\s+)?(delivery|shipping)/i;
const RETURNS_RE = /return/i;
const SALE_RE = /(sale|%\s*off|discount|save\s+£?\d)/i;

/**
 * Copy has a small, hard-to-predict effect: ±`amplitude` odds, derived from a hash of the text so
 * it is stable for a given wording. This is why "just change the CTA text" rarely wins a test.
 */
export function copyFactor(text: string, amplitude: number): number {
  const u = (hashString(text.trim().toLowerCase()) % 10_000) / 10_000; // [0, 1)
  return 1 + amplitude * (2 * u - 1);
}

export const KNOB_EFFECTS: KnobEffect[] = [
  /* ---------------- landing → product (browse) */
  {
    id: "hero-social-proof",
    knob: "hero.showSocialProof",
    stage: "browse",
    when: (s) => s.hero.showSocialProof,
    all: 1.03,
    persona: { "impulse-buyer": 1.12, "mobile-skimmer": 1.02, "gift-shopper": 1.02 },
    rationale: "Star rating + '12,000 runners' reassures first-time visitors; impulse buyers follow the crowd.",
  },
  {
    id: "hero-fullbleed",
    knob: "hero.layout",
    stage: "browse",
    when: (s) => s.hero.layout === "fullbleed",
    device: { Desktop: 1.05, Tablet: 1.0, Mobile: 0.95 },
    rationale: "Full-bleed imagery looks great on desktop but pushes products below the fold on phones. ~Neutral overall.",
  },
  {
    id: "hero-copy",
    knob: "hero.headline / hero.subheadline / hero.ctaText",
    stage: "browse",
    when: () => true,
    factor: (s) => copyFactor(`${s.hero.headline}|${s.hero.subheadline}|${s.hero.ctaText}`, 0.04),
    rationale: "Copy matters a little and unpredictably (±4% odds, fixed per wording).",
  },
  {
    id: "announcement-generic",
    knob: "announcement",
    stage: "browse",
    when: (s) => s.announcement.enabled && s.announcement.text.trim().length > 0,
    all: 1.02,
    rationale: "An announcement bar is mild reassurance that the store is active.",
  },
  {
    id: "announcement-free-delivery",
    knob: "announcement.text",
    stage: "browse",
    when: (s) => s.announcement.enabled && FREE_DELIVERY_RE.test(s.announcement.text),
    persona: { "bargain-hunter": 1.12, "gift-shopper": 1.04, "impulse-buyer": 1.02, "mobile-skimmer": 1.02 },
    rationale: "Promising free delivery up front pulls price-sensitive shoppers into the catalogue.",
  },
  {
    id: "announcement-returns",
    knob: "announcement.text",
    stage: "browse",
    when: (s) => s.announcement.enabled && RETURNS_RE.test(s.announcement.text),
    persona: { "gift-shopper": 1.08, researcher: 1.04 },
    rationale: "Returns messaging lowers perceived risk for gift buyers.",
  },
  {
    id: "announcement-sale",
    knob: "announcement.text",
    stage: "browse",
    when: (s) => s.announcement.enabled && SALE_RE.test(s.announcement.text),
    persona: { "bargain-hunter": 1.1, "impulse-buyer": 1.05 },
    rationale: "Discount language attracts deal seekers.",
  },
  {
    id: "grid-2-columns",
    knob: "productGrid.columns",
    stage: "browse",
    when: (s) => s.productGrid.columns === 2,
    device: { Mobile: 1.05, Tablet: 1.0, Desktop: 0.94 },
    rationale: "Two big tiles read well on phones but waste space on desktop.",
  },
  {
    id: "grid-4-columns",
    knob: "productGrid.columns",
    stage: "browse",
    when: (s) => s.productGrid.columns === 4,
    device: { Mobile: 0.8, Tablet: 0.92, Desktop: 1.05 },
    rationale: "Four columns shows more on desktop, but tiles become thumbnail-sized and mis-tapped on phones.",
  },
  {
    id: "grid-ratings",
    knob: "productGrid.showRatings",
    stage: "browse",
    when: (s) => s.productGrid.showRatings,
    all: 1.03,
    persona: { researcher: 1.06, "impulse-buyer": 1.03 },
    rationale: "Stars on tiles give a reason to click; researchers use them to shortlist.",
  },
  {
    id: "sort-bestselling",
    knob: "productGrid.sort",
    stage: "browse",
    when: (s) => s.productGrid.sort === "bestselling",
    all: 1.03,
    persona: { "impulse-buyer": 1.05, "mobile-skimmer": 1.03 },
    rationale: "Leading with proven sellers matches what most visitors came for.",
  },
  {
    id: "sort-price-asc",
    knob: "productGrid.sort",
    stage: "browse",
    when: (s) => s.productGrid.sort === "price-asc",
    all: 0.95,
    persona: { "bargain-hunter": 1.25 },
    rationale: "Cheapest-first delights bargain hunters but makes a premium brand look discount (and lowers AOV).",
  },
  {
    id: "sort-rating",
    knob: "productGrid.sort",
    stage: "browse",
    when: (s) => s.productGrid.sort === "rating",
    all: 1.02,
    persona: { researcher: 1.08 },
    rationale: "Top-rated first helps careful shoppers.",
  },

  /* ---------------- product → add to cart */
  {
    id: "cta-below-description",
    knob: "productPage.ctaPosition",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.ctaPosition === "below-description",
    device: { Mobile: 0.87, Tablet: 0.92, Desktop: 0.97 },
    persona: { "mobile-skimmer": 0.96 },
    rationale: "On a phone the add-to-cart button is several thumb-scrolls down; skimmers never find it (rage clicks).",
  },
  {
    id: "cta-sticky",
    knob: "productPage.ctaPosition",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.ctaPosition === "sticky",
    device: { Mobile: 1.04, Tablet: 1.02, Desktop: 1.01 },
    rationale: "A sticky buy bar keeps the CTA in thumb reach while reading.",
  },
  {
    id: "pdp-cta-copy",
    knob: "productPage.ctaText",
    stage: "add",
    surface: "pdp",
    when: () => true,
    factor: (s) => copyFactor(s.productPage.ctaText, 0.03),
    rationale: "Button wording has a small, unpredictable effect (±3% odds).",
  },
  {
    id: "pdp-reviews",
    knob: "productPage.showReviews",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.showReviews,
    all: 1.02,
    persona: { researcher: 1.14, "gift-shopper": 1.05 },
    rationale: "Reviews are the #1 information need for considered purchases.",
  },
  {
    id: "pdp-size-guide",
    knob: "productPage.showSizeGuide",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.showSizeGuide,
    persona: { researcher: 1.07, "gift-shopper": 1.1 },
    rationale: "Fit uncertainty blocks shoe purchases, especially when buying for someone else.",
  },
  {
    id: "pdp-delivery-estimate",
    knob: "productPage.showDeliveryEstimate",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.showDeliveryEstimate,
    persona: { "gift-shopper": 1.16, researcher: 1.03 },
    rationale: "'Arrives Thursday' answers the gift shopper's first question.",
  },
  {
    id: "pdp-returns-policy",
    knob: "productPage.showReturnsPolicy",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.showReturnsPolicy,
    persona: { "gift-shopper": 1.1, researcher: 1.05, "bargain-hunter": 1.02 },
    rationale: "Visible free returns de-risks buying the wrong size.",
  },
  {
    id: "pdp-urgency-low-stock",
    knob: "productPage.urgency",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.urgency === "low-stock",
    persona: {
      "impulse-buyer": 1.3,
      "mobile-skimmer": 1.04,
      "bargain-hunter": 1.02,
      researcher: 0.8,
      "gift-shopper": 0.95,
    },
    rationale: "Scarcity nudges impulse buyers but reads as a pressure tactic to researchers. Double-edged.",
  },
  {
    id: "pdp-trust-badges",
    knob: "productPage.trustBadges",
    stage: "add",
    surface: "pdp",
    when: (s) => s.productPage.trustBadges,
    persona: { "gift-shopper": 1.04, researcher: 1.03 },
    rationale: "Secure-payment / guarantee badges are small reassurance for less confident buyers.",
  },
  {
    id: "grid-quick-add",
    knob: "productGrid.showQuickAdd",
    stage: "add",
    surface: "grid",
    when: (s) => s.productGrid.showQuickAdd,
    all: 1.04,
    persona: { "impulse-buyer": 1.06, "mobile-skimmer": 1.04 },
    rationale: "Adding straight from the grid removes a page load and bypasses a bad product page.",
  },
  {
    id: "product-compare-at",
    knob: "(catalog) product.compareAtPrice",
    stage: "add",
    when: (_s, c) => Boolean(c.product?.compareAtPrice),
    persona: { "bargain-hunter": 1.3, "impulse-buyer": 1.06 },
    rationale: "A struck-through price is the bargain hunter's trigger.",
  },
  {
    id: "free-shipping-qualifies",
    knob: "cart.freeShippingThreshold",
    stage: "add",
    when: (s, c) => s.cart.freeShippingThreshold !== null && (c.product?.price ?? 0) >= s.cart.freeShippingThreshold,
    all: 1.02,
    persona: { "bargain-hunter": 1.12, "gift-shopper": 1.03 },
    rationale: "'This item ships free' removes a cost objection before it forms.",
  },
  {
    id: "free-shipping-near",
    knob: "cart.freeShippingThreshold",
    stage: "add",
    when: (s, c) => s.cart.freeShippingThreshold !== null && (c.product?.price ?? 0) < s.cart.freeShippingThreshold,
    persona: { "bargain-hunter": 1.04 },
    rationale: "A reachable threshold is a mild motivator (and drives top-ups in the cart).",
  },

  /* ---------------- cart → checkout */
  {
    id: "shipping-known-in-cart",
    knob: "cart.showShippingUpfront",
    stage: "checkout",
    when: (s, c) => s.cart.showShippingUpfront && shippingFor(s, c.subtotal ?? 0) > 0,
    persona: {
      "bargain-hunter": 0.82,
      "mobile-skimmer": 0.96,
      researcher: 0.97,
      "impulse-buyer": 0.96,
      "gift-shopper": 0.96,
    },
    rationale: "Showing £4.95 in the cart loses a few price-sensitive shoppers early, but removes the last-step shock.",
  },
  {
    id: "free-shipping-unlocked",
    knob: "cart.freeShippingThreshold",
    stage: "checkout",
    when: (s, c) => shippingFor(s, c.subtotal ?? 0) === 0,
    all: 1.04,
    persona: { "bargain-hunter": 1.15, "gift-shopper": 1.02 },
    rationale: "'You've unlocked free delivery' is a strong push to check out.",
  },
  {
    id: "cart-upsell",
    knob: "cart.upsell",
    stage: "checkout",
    when: (s) => s.cart.upsell,
    all: 0.97,
    rationale: "Cross-sells raise AOV (see UPSELL_TAKE) but add a distraction before checkout. Double-edged.",
  },
  {
    id: "express-buttons-in-cart",
    knob: "checkout.expressPay",
    stage: "checkout",
    when: (s) => s.checkout.expressPay,
    device: { Mobile: 1.04, Tablet: 1.02, Desktop: 1.0 },
    rationale: "Apple/Google Pay buttons in the cart make starting checkout one tap.",
  },
];

/* ------------------------------------------------------------------ non-odds mechanics */

/**
 * ACCOUNT WALL. `checkout.guestCheckout: false` forces account creation after checkout starts
 * (before any payment method, including express). P(pass) per persona, then × device odds.
 * Forced sign-up is one of the top documented checkout abandonment reasons (~1 in 4 abandoners).
 */
export const ACCOUNT_WALL_PASS: Record<Persona, number> = {
  "bargain-hunter": 0.88,
  "mobile-skimmer": 0.82,
  researcher: 0.9,
  "impulse-buyer": 0.8,
  "gift-shopper": 0.86,
};
export const ACCOUNT_WALL_DEVICE_ODDS: Record<Device, number> = { Desktop: 1, Tablet: 0.92, Mobile: 0.85 };

/**
 * SHIPPING SHOCK. When shipping is NOT shown in the cart and the order does not qualify for free
 * delivery, the £4.95 fee first appears on the last checkout step. P(abandon right there).
 * Unexpected extra costs are the #1 cited reason for checkout abandonment.
 * In an express-pay sheet the fee is visible before confirming, so the shock is halved.
 */
export const SHIPPING_SHOCK_ABANDON: Record<Persona, number> = {
  "bargain-hunter": 0.26,
  "mobile-skimmer": 0.11,
  researcher: 0.08,
  "impulse-buyer": 0.08,
  "gift-shopper": 0.1,
};
export const EXPRESS_SHOCK_FACTOR = 0.5;

/**
 * CHECKOUT LENGTH. Each page is a drop point; a single long page carries about half the friction of
 * three. Total pass = p_step ^ equivalents(steps).
 */
export const CHECKOUT_PAGE_EQUIVALENTS: Record<1 | 2 | 3, number> = { 1: 1.8, 2: 2.4, 3: 3 };

export const CHECKOUT_STEP_NAMES: Record<1 | 2 | 3, string[]> = {
  1: ["checkout"],
  2: ["details", "payment"],
  3: ["contact", "delivery", "payment"],
};

/** EXPRESS PAY. P(uses Apple/Google Pay when offered) by device, × persona multiplier. */
export const EXPRESS_ADOPTION: Record<Device, number> = { Mobile: 0.25, Tablet: 0.18, Desktop: 0.08 };
export const EXPRESS_PERSONA: Record<Persona, number> = {
  "bargain-hunter": 0.9,
  "mobile-skimmer": 1.3,
  researcher: 0.7,
  "impulse-buyer": 1.4,
  "gift-shopper": 0.9,
};
/** Express flows complete with this probability (biometric confirm) instead of steps + pay. */
export const EXPRESS_COMPLETE = 0.9;

/** QUICK ADD. P(adds from the grid instead of opening the product page) when quick add is shown. */
export const QUICK_ADD_USE: Record<Persona, number> = {
  "bargain-hunter": 0.08,
  "mobile-skimmer": 0.25,
  researcher: 0.02,
  "impulse-buyer": 0.3,
  "gift-shopper": 0.04,
};

/** UPSELL. P(adds the suggested accessory) when `cart.upsell`. Raises AOV. */
export const UPSELL_TAKE: Record<Persona, number> = {
  "bargain-hunter": 0.06,
  "mobile-skimmer": 0.07,
  researcher: 0.08,
  "impulse-buyer": 0.2,
  "gift-shopper": 0.14,
};

/**
 * FREE-SHIPPING TOP-UP. When the cart is within `maxGap` of the threshold, some shoppers add an
 * accessory to qualify (classic AOV lever). Emergent: a threshold just above typical cart value
 * lifts AOV and removes shipping shock for those who top up.
 */
export const TOPUP = {
  maxGap: 3500,
  take: {
    "bargain-hunter": 0.5,
    "mobile-skimmer": 0.15,
    researcher: 0.18,
    "impulse-buyer": 0.22,
    "gift-shopper": 0.2,
  } as Record<Persona, number>,
};

/* ------------------------------------------------------------------ product choice */

/** Grid order for a sort mode (index 0 = top-left). */
export function gridOrder(spec: PageSpec): Product[] {
  const list = [...PRODUCTS];
  switch (spec.productGrid.sort) {
    case "bestselling":
      return list.sort((a, b) => a.bestsellerRank - b.bestsellerRank);
    case "price-asc":
      return list.sort((a, b) => a.price - b.price);
    case "rating":
      return list.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    default:
      return list;
  }
}

/**
 * Relative interest of a persona in a product at a given grid position. Earlier tiles get more
 * clicks (stronger on phones, which scroll less). Personas have different tastes.
 */
export function productAffinity(persona: Persona, product: Product, position: number, device: Device): number {
  const decay = device === "Mobile" ? 0.35 : 0.2;
  let w = 1 / (1 + decay * position);
  const accessory = product.category === "accessories";
  switch (persona) {
    case "bargain-hunter":
      w *= (product.compareAtPrice ? 2.5 : 1) * Math.pow(10_000 / product.price, 0.8) * (accessory ? 0.5 : 1);
      break;
    case "mobile-skimmer":
      w *= Math.pow(1 / product.bestsellerRank, 0.3) * (accessory ? 0.6 : 1);
      break;
    case "researcher":
      w *= Math.pow(product.reviewCount / 500, 0.3) * Math.pow(product.rating / 4.5, 6) * (accessory ? 0.4 : 1);
      break;
    case "impulse-buyer":
      w *= Math.pow(1 / product.bestsellerRank, 0.5) * (product.category === "racing" ? 1.5 : 1) * (accessory ? 0.7 : 1);
      break;
    case "gift-shopper":
      w *= accessory ? 2.2 : product.category === "racing" ? 0.6 : product.category === "road" ? 1.2 : 1;
      break;
  }
  return w;
}

/** UK shoe size distribution for shoppers (and gift recipients). */
export const SHOE_SIZES: [string, number][] = [
  ["6", 0.07],
  ["7", 0.14],
  ["8", 0.2],
  ["9", 0.23],
  ["10", 0.2],
  ["11", 0.11],
  ["12", 0.05],
];

/* ------------------------------------------------------------------ evaluation */

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function effectMultiplier(e: KnobEffect, spec: PageSpec, persona: Persona, device: Device): number {
  return (e.all ?? 1) * (e.persona?.[persona] ?? 1) * (e.device?.[device] ?? 1) * (e.factor ? e.factor(spec) : 1);
}

function effectApplies(e: KnobEffect, stage: Stage, spec: PageSpec, ctx: FunnelContext): boolean {
  if (e.stage !== stage) return false;
  if (e.surface && e.surface !== (ctx.surface ?? "pdp")) return false;
  return e.when(spec, ctx);
}

/** Probability that a visitor of `persona` passes `stage` on `spec`, given context. */
export function stageProbability(stage: Stage, spec: PageSpec, persona: Persona, ctx: FunnelContext): number {
  let x = logit(PERSONA_PROFILES[persona].base[stage]) + Math.log(DEVICE_ODDS[ctx.device][stage] ?? 1);
  for (const e of KNOB_EFFECTS) {
    if (effectApplies(e, stage, spec, ctx)) x += Math.log(effectMultiplier(e, spec, persona, ctx.device));
  }
  return sigmoid(x);
}

/** P(passes the forced-account wall). 1 when guest checkout is allowed. */
export function accountWallPass(spec: PageSpec, persona: Persona, device: Device): number {
  if (spec.checkout.guestCheckout) return 1;
  return sigmoid(logit(ACCOUNT_WALL_PASS[persona]) + Math.log(ACCOUNT_WALL_DEVICE_ODDS[device]));
}

/** P(continues past one checkout page) for a flow of `steps` pages. */
export function checkoutPagePass(spec: PageSpec, persona: Persona, device: Device): number {
  const pStep = stageProbability("step", spec, persona, { device });
  const steps = spec.checkout.steps;
  return Math.pow(pStep, CHECKOUT_PAGE_EQUIVALENTS[steps] / steps);
}

/** P(uses express pay) — 0 when not offered. */
export function expressAdoption(spec: PageSpec, persona: Persona, device: Device): number {
  if (!spec.checkout.expressPay) return 0;
  return Math.min(0.85, EXPRESS_ADOPTION[device] * EXPRESS_PERSONA[persona]);
}

export interface ActiveEffect {
  id: string;
  knob: string;
  stage: Stage;
  multiplier: number;
  rationale: string;
}

/**
 * Which knob effects are active on a spec for a persona/device (context-free effects only, plus
 * product/cart effects evaluated for a typical £115 shoe). Useful for explaining results.
 */
export function activeEffects(spec: PageSpec, persona: Persona, device: Device): ActiveEffect[] {
  const typical = PRODUCTS[0];
  const out: ActiveEffect[] = [];
  for (const e of KNOB_EFFECTS) {
    const ctx: FunnelContext = { device, product: typical, subtotal: typical.price, surface: e.surface ?? "pdp" };
    if (!e.when(spec, ctx)) continue;
    const m = effectMultiplier(e, spec, persona, device);
    if (Math.abs(m - 1) < 1e-6) continue;
    out.push({ id: e.id, knob: e.knob, stage: e.stage, multiplier: m, rationale: e.rationale });
  }
  return out;
}

/* ------------------------------------------------------------------ reference specs */

/** Everything the model knows to be good, with double-edged knobs left at their safe setting. */
export const BEST_KNOWN_PATCH: SpecPatch = {
  hero: { showSocialProof: true },
  announcement: { enabled: true, text: "Free UK delivery over £75 · Free 60-day returns" },
  productGrid: { columns: 3, showRatings: true, showQuickAdd: true, sort: "bestselling" },
  productPage: {
    ctaPosition: "sticky",
    showReviews: true,
    showSizeGuide: true,
    showDeliveryEstimate: true,
    showReturnsPolicy: true,
    urgency: "none",
    trustBadges: true,
  },
  cart: { showShippingUpfront: true, freeShippingThreshold: 7500, upsell: false },
  checkout: { steps: 1, guestCheckout: true, expressPay: true },
  agentSurface: {
    structuredData: true,
    exposeStock: true,
    exposeDeliveryEta: true,
    exposeReturnPolicy: true,
    exposeLandedPrice: true,
    negotiation: { enabled: true, maxDiscountPct: 10 },
  },
};

/** The best spec the model knows about. Used by tests and the calibration table. */
export function bestKnownSpec(base: PageSpec = DEFAULT_SPEC): PageSpec {
  return { ...applyPatch(base, BEST_KNOWN_PATCH), label: "Best known (simulator)" };
}

/**
 * Single-knob changes from DEFAULT_SPEC with the direction the model predicts for HUMAN conversion.
 * Used by tests and the calibration table.
 */
export const SINGLE_KNOB_CHANGES: { name: string; patch: SpecPatch; expect: "up" | "down" | "neutral" }[] = [
  { name: "guest checkout", patch: { checkout: { guestCheckout: true } }, expect: "up" },
  { name: "sticky CTA", patch: { productPage: { ctaPosition: "sticky" } }, expect: "up" },
  {
    name: "shipping upfront + free over £75",
    patch: { cart: { showShippingUpfront: true, freeShippingThreshold: 7500 } },
    expect: "up",
  },
  { name: "reviews on PDP", patch: { productPage: { showReviews: true } }, expect: "up" },
  { name: "1-step checkout", patch: { checkout: { steps: 1 } }, expect: "up" },
  { name: "express pay", patch: { checkout: { expressPay: true } }, expect: "up" },
  { name: "4-column grid", patch: { productGrid: { columns: 4 } }, expect: "down" },
  { name: "hero full-bleed", patch: { hero: { layout: "fullbleed" } }, expect: "neutral" },
  { name: "accent colour", patch: { theme: { accent: "#dc2626", radius: "full" } }, expect: "neutral" },
];
