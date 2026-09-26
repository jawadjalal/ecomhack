/** Cart maths. Pure; money is integer pence. */
import { PRODUCTS, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import type { PageSpec } from "@/lib/contracts";

export interface CartLine {
  productId: string;
  color: string;
  size: string;
  quantity: number;
}

export interface PricedLine extends CartLine {
  key: string;
  product: Product;
  unitPrice: number;
  lineTotal: number;
}

export interface CartTotals {
  lines: PricedLine[];
  itemCount: number;
  subtotal: number;
  /** Shipping that will be charged for this basket (0 when free). */
  shipping: number;
  total: number;
  /** Free-shipping threshold from the spec (pence) or null. */
  threshold: number | null;
  /** Pence left to reach free shipping (0 when reached or no threshold). */
  remainingForFree: number;
  qualifiesForFree: boolean;
}

export const lineKey = (l: Pick<CartLine, "productId" | "color" | "size">) => `${l.productId}|${l.color}|${l.size}`;

export function shippingFor(subtotal: number, spec: Pick<PageSpec, "cart">): number {
  if (subtotal <= 0) return 0;
  const t = spec.cart.freeShippingThreshold;
  return t !== null && subtotal >= t ? 0 : SHIPPING_FEE;
}

export function priceCart(lines: CartLine[], spec: Pick<PageSpec, "cart">): CartTotals {
  const priced: PricedLine[] = [];
  for (const l of lines) {
    const product = PRODUCTS.find((p) => p.id === l.productId);
    if (!product || l.quantity <= 0) continue;
    priced.push({ ...l, key: lineKey(l), product, unitPrice: product.price, lineTotal: product.price * l.quantity });
  }
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = shippingFor(subtotal, spec);
  const threshold = spec.cart.freeShippingThreshold;
  const remainingForFree = threshold === null ? 0 : Math.max(0, threshold - subtotal);
  return {
    lines: priced,
    itemCount: priced.reduce((s, l) => s + l.quantity, 0),
    subtotal,
    shipping,
    total: subtotal + shipping,
    threshold,
    remainingForFree,
    qualifiesForFree: threshold !== null && subtotal > 0 && remainingForFree === 0,
  };
}
