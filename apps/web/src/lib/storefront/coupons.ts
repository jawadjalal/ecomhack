/**
 * Discount codes the PACE demo store honours at checkout. Pure; money is integer pence.
 *
 * There is one real code: the newsletter welcome code (shown after signing up in the footer). The
 * discount comes off the merchandise subtotal; delivery (and the free-delivery threshold, which the
 * PageSpec owns) is worked out on the pre-discount subtotal, exactly as before a code is applied.
 */

export interface Coupon {
  code: string;
  /** Percent off the merchandise subtotal. */
  percentOff: number;
  /** Minimum merchandise subtotal (pence), if any. */
  minSubtotal?: number;
  /** Shown next to the discount line. */
  label: string;
}

export const WELCOME_CODE = "WELCOME10";

export const COUPONS: readonly Coupon[] = [{ code: WELCOME_CODE, percentOff: 10, label: "10% off: newsletter welcome" }];

export type CouponResult =
  | { ok: true; code: string; coupon: Coupon; discount: number }
  | { ok: false; code: string; reason: "empty" | "unknown" | "min_subtotal" | "empty_bag"; message: string };

/** Upper-case, no spaces, only [A-Z0-9_-], at most 24 characters: safe to show and to record. */
export function normalizeCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 24);
}

/** Pence off `subtotal` for a coupon (rounded to the nearest penny, never more than the subtotal). */
export function discountFor(coupon: Coupon, subtotal: number): number {
  if (!(subtotal > 0)) return 0;
  return Math.min(subtotal, Math.round((subtotal * coupon.percentOff) / 100));
}

const pounds = (pence: number) => `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;

/** Check a code against the store's real codes for a basket with this merchandise subtotal. */
export function validateCoupon(raw: unknown, subtotal: number, coupons: readonly Coupon[] = COUPONS): CouponResult {
  const code = normalizeCode(raw);
  if (!code) return { ok: false, code, reason: "empty", message: "Enter a discount code." };
  const coupon = coupons.find((c) => c.code === code);
  if (!coupon) return { ok: false, code, reason: "unknown", message: `“${code}” isn't a valid PACE discount code. Check the spelling and try again.` };
  if (!(subtotal > 0)) return { ok: false, code, reason: "empty_bag", message: "Add something to your bag first." };
  if (coupon.minSubtotal !== undefined && subtotal < coupon.minSubtotal) {
    return { ok: false, code, reason: "min_subtotal", message: `${code} needs a basket of ${pounds(coupon.minSubtotal)} or more.` };
  }
  return { ok: true, code, coupon, discount: discountFor(coupon, subtotal) };
}

/** Totals with a coupon applied (or not). `total` = subtotal − discount + shipping. */
export function withCoupon<T extends { subtotal: number; shipping: number }>(
  totals: T,
  code: string | null | undefined,
  coupons: readonly Coupon[] = COUPONS,
): T & { discount: number; coupon?: Coupon; total: number } {
  const r = code ? validateCoupon(code, totals.subtotal, coupons) : undefined;
  const discount = r?.ok ? r.discount : 0;
  return { ...totals, discount, ...(r?.ok ? { coupon: r.coupon } : {}), total: totals.subtotal - discount + totals.shipping };
}
