import { DELIVERY_FEE } from "./catalog";

/** 109900 → "£1,099.00" (or "£1,099" with `whole`). */
export function gbp(pence: number, opts: { whole?: boolean } = {}): string {
  const whole = opts.whole && pence % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(pence / 100);
}

/** Delivery fee for a bag subtotal under a spec's free-delivery threshold (null = never free). */
export function deliveryFee(subtotal: number, freeThreshold: number | null): number {
  if (subtotal <= 0) return 0;
  return freeThreshold !== null && subtotal >= freeThreshold ? 0 : DELIVERY_FEE;
}

/** Order before 3pm → next working day; otherwise the one after. Returns e.g. "Tue 29 Sep". */
export function deliveryDate(now = new Date()): string {
  const d = new Date(now);
  let days = d.getHours() < 15 ? 1 : 2;
  while (days > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) days--;
  }
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "£36.64/mo. for 30 mo. at 0% interest" finance line (illustrative only). */
export function monthly(pence: number, months = 30): string {
  return `${gbp(Math.ceil(pence / months))}/mo. for ${months} mo. at 0% interest`;
}

export function stars(rating: number): string {
  const full = Math.round(rating);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}
