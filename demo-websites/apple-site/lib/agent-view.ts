/**
 * What AI shopping agents can read. Every field is gated by a PageSpec `agentSurface` knob, so Darwin's
 * agent fixes ("tell agents the delivery ETA", "publish the returns policy"…) show up here and in the
 * product JSON-LD after the PR merges.
 */
import type { PageSpec } from "./page-spec";
import { DELIVERY_FEE, PRODUCTS, RETURNS_DAYS, type Product } from "./catalog";
import { deliveryFee } from "./format";

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "http://localhost:3001";

export function agentProduct(p: Product, spec: PageSpec) {
  const a = spec.agentSurface;
  const shipping = deliveryFee(p.price, spec.cart.freeShippingThreshold);
  return {
    id: p.slug,
    name: p.name,
    url: `${SITE}/products/${p.slug}`,
    price: p.price,
    currency: "GBP",
    colours: p.colours.map((c) => c.name),
    ...(p.option ? { options: { [p.option.label.toLowerCase()]: p.option.choices.map((c) => ({ name: c.name, price: p.price + c.delta })) } } : {}),
    rating: p.rating,
    reviews: p.reviews,
    ...(a.exposeStock ? { stock: p.stock } : {}),
    ...(a.exposeDeliveryEta ? { delivery_eta: "Next working day when ordered by 3pm (UK)", delivery_eta_days: 1 } : {}),
    ...(a.exposeReturnPolicy ? { return_policy: `Free returns within ${RETURNS_DAYS} days, full refund` } : {}),
    ...(a.exposeLandedPrice ? { shipping, landed_price: p.price + shipping } : {}),
    ...(a.negotiation.enabled ? { negotiable: true, max_discount_pct: a.negotiation.maxDiscountPct } : {}),
  };
}

/** Fields an agent typically asks for that this config hides (what Darwin logs as `missing`). */
export function hiddenFields(spec: PageSpec): string[] {
  const a = spec.agentSurface;
  return [
    !a.exposeDeliveryEta && "delivery_eta",
    !a.exposeReturnPolicy && "return_policy",
    !a.exposeLandedPrice && "landed_price",
    !a.exposeStock && "stock",
    !a.structuredData && "structured_data",
  ].filter(Boolean) as string[];
}

export function agentCatalog(spec: PageSpec) {
  return {
    store: "Orchard (fictional demo store)",
    currency: "GBP",
    money: "integer pence",
    config_version: spec.version,
    ...(spec.agentSurface.exposeLandedPrice ? { standard_delivery: DELIVERY_FEE, free_delivery_over: spec.cart.freeShippingThreshold } : {}),
    not_provided: hiddenFields(spec),
    products: PRODUCTS.map((p) => agentProduct(p, spec)),
  };
}

/** schema.org Product (rendered only when agentSurface.structuredData is on). */
export function productJsonLd(p: Product, spec: PageSpec) {
  const a = spec.agentSurface;
  const shipping = deliveryFee(p.price, spec.cart.freeShippingThreshold);
  const inStock = Object.values(p.stock).some((n) => n > 0);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.tagline,
    sku: p.slug,
    brand: { "@type": "Brand", name: "Orchard" },
    aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating, reviewCount: p.reviews },
    offers: {
      "@type": "Offer",
      url: `${SITE}/products/${p.slug}`,
      priceCurrency: "GBP",
      price: (p.price / 100).toFixed(2),
      ...(a.exposeStock ? { availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", inventoryLevel: Object.values(p.stock).reduce((x, y) => x + y, 0) } : {}),
      ...(a.exposeDeliveryEta || a.exposeLandedPrice
        ? {
            shippingDetails: {
              "@type": "OfferShippingDetails",
              shippingDestination: { "@type": "DefinedRegion", addressCountry: "GB" },
              ...(a.exposeLandedPrice ? { shippingRate: { "@type": "MonetaryAmount", value: (shipping / 100).toFixed(2), currency: "GBP" } } : {}),
              ...(a.exposeDeliveryEta
                ? {
                    deliveryTime: {
                      "@type": "ShippingDeliveryTime",
                      handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 0, unitCode: "DAY" },
                      transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 1, unitCode: "DAY" },
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(a.exposeReturnPolicy
        ? {
            hasMerchantReturnPolicy: {
              "@type": "MerchantReturnPolicy",
              applicableCountry: "GB",
              returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
              merchantReturnDays: RETURNS_DAYS,
              returnFees: "https://schema.org/FreeReturn",
            },
          }
        : {}),
    },
  };
}
