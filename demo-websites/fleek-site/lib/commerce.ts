/** Money, freight and delivery maths shared by server and client. Money is integer pence. */
import { bundleById, supplierById, type Bundle } from "./catalog";
import type { PageSpec } from "./spec";

export const gbp = (pence: number, opts: { decimals?: boolean } = {}) => {
  const decimals = opts.decimals ?? pence % 100 !== 0;
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 })}`;
};

export interface CartLine {
  id: string;
  qty: number;
  /**
   * A product that isn't in this catalog: added from the local mirror mode (mirror/runtime.js), which
   * reads name, price and piece count off the page. Its listed price already includes shipping.
   */
  ext?: { name: string; price: number; pieces: number; image?: string; url?: string };
}

/** A cart line from the mirror, shaped like a catalog bundle so the cart and checkout can render it. */
function externalBundle(l: CartLine): Bundle | undefined {
  const e = l.ext;
  if (!e || !Number.isFinite(e.price) || e.price <= 0) return undefined;
  return {
    id: l.id,
    name: String(e.name).slice(0, 120),
    category: "tees",
    supplier: "external",
    price: Math.round(e.price),
    was: null,
    pieces: Math.max(1, Math.round(e.pieces || 1)),
    weightKg: 0,
    grade: "A/B",
    era: "",
    sizes: "",
    brands: "",
    stock: 99,
    sold30d: 0,
    rating: 0,
    reviewCount: 0,
    garments: ["tee", "jeans", "jacket", "knit"],
    colors: ["#8a8a8a", "#6d8fb8", "#8a5a2b", "#b24a3b"],
    bg: "#eeeeee",
    description: [],
    reviews: [],
    image: e.image,
    url: e.url,
    shippingIncluded: true,
  };
}

export interface PricedLine {
  bundle: Bundle;
  qty: number;
  total: number;
}

export function priceLines(lines: CartLine[]): PricedLine[] {
  return lines.flatMap((l) => {
    const bundle = bundleById(l.id) ?? externalBundle(l);
    return bundle ? [{ bundle, qty: l.qty, total: bundle.price * l.qty }] : [];
  });
}

export interface Fees {
  subtotal: number;
  /** Tracked freight, priced by weight. */
  freight: number;
  /** Customs clearance and handling. */
  handling: number;
  /** Charged under SMALL_ORDER_LIMIT. */
  smallOrder: number;
  /** Buyer protection fee on shipping-included (mirror) items: 3%, min 99p. */
  protection: number;
  total: number;
  pieces: number;
  weightKg: number;
  freeFreight: boolean;
}

export const SMALL_ORDER_LIMIT = 15000;

export function fees(lines: PricedLine[], freeShippingThreshold: number | null): Fees {
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const weightKg = lines.reduce((s, l) => s + l.bundle.weightKg * l.qty, 0);
  const pieces = lines.reduce((s, l) => s + l.bundle.pieces * l.qty, 0);
  const freeFreight = freeShippingThreshold !== null && subtotal >= freeShippingThreshold;
  const shipped = lines.some((l) => !l.bundle.shippingIncluded);
  const freight = !shipped || freeFreight ? 0 : 1495 + Math.round(weightKg * 55);
  const handling = !shipped || freeFreight ? 0 : 450;
  const smallOrder = lines.length && subtotal < SMALL_ORDER_LIMIT ? 399 : 0;
  const included = lines.filter((l) => l.bundle.shippingIncluded).reduce((s, l) => s + l.total, 0);
  const protection = included ? Math.max(99, Math.round(included * 0.03)) : 0;
  return { subtotal, freight, handling, smallOrder, protection, total: subtotal + freight + handling + smallOrder + protection, pieces, weightKg, freeFreight };
}

/** Landed price of one bundle bought on its own (what an AI shopping agent compares). */
export function landedPrice(b: Bundle, freeShippingThreshold: number | null): number {
  return fees([{ bundle: b, qty: 1, total: b.price }], freeShippingThreshold).total;
}

function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

/** "Thu 2 Oct – Mon 6 Oct": supplier dispatch + 2–3 working days tracked freight. */
export function deliveryWindow(b: Bundle, now = new Date()): { from: Date; to: Date; label: string; dispatch: string } {
  const [d0, d1] = supplierById(b.supplier)?.dispatchDays ?? [2, 4];
  const from = addWorkingDays(now, d0 + 2);
  const to = addWorkingDays(now, d1 + 3);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return { from, to, label: `${fmt(from)} – ${fmt(to)}`, dispatch: d0 === d1 ? `${d0} working day${d0 > 1 ? "s" : ""}` : `${d0}–${d1} working days` };
}

export const RETURNS_POLICY =
  "Buyer protection on every bundle: if it doesn't match the listing (piece count, grade or mix), report it within 7 days of delivery for a refund or a replacement.";

/** cart.showShippingUpfront: say what delivery costs right on the card (Gen 0 says nothing until checkout). */
export function shippingNote(b: Bundle, spec: PageSpec): string | null {
  if (!spec.cart.showShippingUpfront) return null;
  const t = spec.cart.freeShippingThreshold;
  if (t !== null && b.price >= t) return "Free shipping";
  const fee = landedPrice(b, t) - b.price;
  return `+${gbp(fee, { decimals: true })} shipping${t !== null ? ` · free over ${gbp(t)}` : ""}`;
}
