/**
 * Shape catalog products for AI agents according to `PageSpec.agentSurface`.
 * Pure functions: no tracking, no storage.
 */
import type { AgentProduct, PageSpec } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE, getProduct, type Product } from "@/lib/catalog/products";
import { WANTABLE_FIELDS, type AgentProductDetail, type WantableField } from "./types";

/** Shipping for a basket subtotal under the given spec (free over the threshold, if any). */
export function shippingFor(subtotal: number, spec: PageSpec): number {
  const threshold = spec.cart.freeShippingThreshold;
  return threshold !== null && subtotal >= threshold ? 0 : SHIPPING_FEE;
}

export function productUrl(p: Product): string {
  return `/store/products/${p.slug}`;
}

/** Which optional AgentProduct fields the surface exposes. */
export function exposedFields(spec: PageSpec): Record<WantableField, boolean> {
  const s = spec.agentSurface;
  return {
    sizes: s.exposeStock,
    deliveryEtaDays: s.exposeDeliveryEta,
    returnPolicy: s.exposeReturnPolicy,
    landedPrice: s.exposeLandedPrice,
  };
}

const WANT_ALIASES: Record<string, WantableField> = {
  sizes: "sizes",
  size: "sizes",
  stock: "sizes",
  instock: "sizes",
  inventory: "sizes",
  availability: "sizes",
  deliveryetadays: "deliveryEtaDays",
  deliveryeta: "deliveryEtaDays",
  deliverydays: "deliveryEtaDays",
  delivery: "deliveryEtaDays",
  eta: "deliveryEtaDays",
  shippingtime: "deliveryEtaDays",
  returnpolicy: "returnPolicy",
  returns: "returnPolicy",
  freereturns: "returnPolicy",
  landedprice: "landedPrice",
  landedcost: "landedPrice",
  shipping: "landedPrice",
  shippingcost: "landedPrice",
  totalprice: "landedPrice",
};

/** Normalise a `want` list (accepts aliases agents commonly use: "stock", "eta", "returns", "shipping"…). */
export function normaliseWant(want: readonly string[] | string | undefined): WantableField[] {
  if (!want) return [];
  const list = typeof want === "string" ? want.split(",") : want;
  const out = new Set<WantableField>();
  for (const w of list) {
    const f = WANT_ALIASES[String(w).replace(/[^a-z]/gi, "").toLowerCase()];
    if (f) out.add(f);
  }
  return WANTABLE_FIELDS.filter((f) => out.has(f));
}

/** Wanted fields the surface hides. */
export function missingFields(spec: PageSpec, want: readonly string[] | string | undefined): WantableField[] {
  const exposed = exposedFields(spec);
  return normaliseWant(want).filter((f) => !exposed[f]);
}

export function toAgentProduct(p: Product, spec: PageSpec): AgentProduct {
  const s = spec.agentSurface;
  const out: AgentProduct = {
    id: p.id,
    name: p.name,
    category: p.category,
    url: productUrl(p),
    price: { amount: p.price, currency: "GBP" },
    rating: { value: p.rating, count: p.reviewCount },
    attributes: { ...p.attributes },
  };
  if (s.exposeStock) {
    out.sizes = Object.entries(p.stock).map(([size, quantity]) => ({ size, inStock: quantity > 0, quantity }));
  }
  if (s.exposeDeliveryEta) out.deliveryEtaDays = p.deliveryDays;
  if (s.exposeReturnPolicy) out.returnPolicy = { days: p.returnDays, free: p.freeReturns };
  if (s.exposeLandedPrice) {
    const shipping = shippingFor(p.price, spec);
    out.landedPrice = { amount: p.price + shipping, currency: "GBP", shipping };
  }
  return out;
}

export function toAgentProductDetail(p: Product, spec: PageSpec): AgentProductDetail {
  return {
    ...toAgentProduct(p, spec),
    tagline: p.tagline,
    description: p.description,
    features: [...p.features],
    colors: p.colors.map((c) => c.name),
    ...(p.compareAtPrice ? { compareAtPrice: p.compareAtPrice } : {}),
  };
}

/** Find a product by id, slug or (case-insensitive) name, since LLM agents often pass names. */
export function findProduct(ref: string): Product | undefined {
  const exact = getProduct(ref.trim());
  if (exact) return exact;
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    PRODUCTS.find((p) => p.name.toLowerCase() === needle) ??
    PRODUCTS.find((p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()))
  );
}

/**
 * Money arguments are pence. Agents (LLMs especially) sometimes send pounds; nothing in the
 * catalog costs under £10, so values below 1000 are read as pounds.
 */
export function normaliseMoney(value: number): number {
  return Math.round(value < 1000 ? value * 100 : value);
}

/** Normalise a free-text size ("UK 10", "10", "uk10", "one size") to a catalog size key. */
export function normaliseSize(size: string | undefined, product?: Product): string | undefined {
  if (size === undefined) return undefined;
  const raw = String(size).trim();
  if (!raw) return undefined;
  if (product) {
    const keys = Object.keys(product.stock);
    const direct = keys.find((k) => k.toLowerCase() === raw.toLowerCase());
    if (direct) return direct;
    if (keys.length === 1 && /one\s*size|^os$|^n\/?a$/i.test(raw)) return keys[0];
  }
  if (/one\s*size/i.test(raw)) return "One size";
  const m = raw.match(/(\d+(?:\.5)?)/);
  return m ? m[1] : raw;
}

export interface SearchQuery {
  query?: string;
  category?: string;
  maxPrice?: number;
  size?: string;
  terrain?: string;
}

const STOPWORDS = new Set([
  "a", "an", "and", "the", "for", "with", "of", "to", "in", "on", "by", "me", "my", "i", "some", "pair",
  "shoe", "shoes", "trainer", "trainers", "running", "run", "runner", "uk", "size", "under", "below",
  "less", "than", "max", "budget", "delivered", "delivery", "friday", "monday", "tuesday", "wednesday",
  "thursday", "saturday", "sunday", "tomorrow", "week", "days", "day", "need", "want", "looking", "buy",
  "free", "returns", "return", "within", "get", "cheap", "best", "price", "deal", "negotiate", "please",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function haystack(p: Product): string {
  return [p.name, p.category, p.tagline, p.description, ...p.features, ...Object.entries(p.attributes).map(([k, v]) => `${k} ${v}`)]
    .join(" ")
    .toLowerCase();
}

const CATEGORY_ALIASES: Record<string, string> = {
  road: "road",
  trail: "trail",
  racing: "racing",
  race: "racing",
  accessories: "accessories",
  accessory: "accessories",
  socks: "accessories",
  vest: "accessories",
};

/**
 * Keyword search over the catalog. Structured filters are hard constraints; the free-text
 * query ranks results and filters only when at least one product matches it.
 * Results are in relevance order, ties broken by bestseller rank.
 */
export function searchCatalog(q: SearchQuery): Product[] {
  let list = PRODUCTS.slice();
  if (q.category) {
    const c = q.category.toLowerCase().trim();
    if (c === "shoes" || c === "shoe" || c === "running shoes") list = list.filter((p) => p.category !== "accessories");
    else list = list.filter((p) => p.category === (CATEGORY_ALIASES[c] ?? c));
  }
  if (q.terrain) list = list.filter((p) => String(p.attributes.terrain ?? "").toLowerCase() === q.terrain!.toLowerCase().trim());
  if (q.maxPrice !== undefined) list = list.filter((p) => p.price <= q.maxPrice!);
  if (q.size) list = list.filter((p) => normaliseSize(q.size, p)! in p.stock);

  const terms = q.query ? tokens(q.query) : [];
  if (terms.length) {
    const scored = list.map((p) => {
      const h = haystack(p);
      return { p, score: terms.reduce((n, t) => n + (h.includes(t) ? 1 : 0), 0) };
    });
    if (scored.some((s) => s.score > 0)) {
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.p.bestsellerRank - b.p.bestsellerRank)
        .map((s) => s.p);
    }
  }
  return list.sort((a, b) => a.bestsellerRank - b.bestsellerRank);
}
