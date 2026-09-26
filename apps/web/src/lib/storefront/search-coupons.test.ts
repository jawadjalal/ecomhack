import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/lib/catalog/products";
import { COUPONS, WELCOME_CODE, discountFor, normalizeCode, validateCoupon, withCoupon, type Coupon } from "./coupons";
import { isValidEmail, newsletterSignupProps } from "./newsletter";
import { MAX_QUERY_LENGTH, normalizeQuery, searchProducts } from "./search";

const names = (q: string) => searchProducts(q, PRODUCTS).map((p) => p.name);

describe("store search", () => {
  it("finds products by name, case-insensitively, from a prefix", () => {
    expect(names("aurora")).toEqual(["Aurora Daily Trainer"]);
    expect(names("VELO")).toEqual(["Velocity Carbon"]);
    expect(names("  tempo   lite ")).toEqual(["Tempo Lite"]);
  });

  it("finds products by category, name matches first", () => {
    const trail = names("trail");
    expect(trail[0]).toBe("Ridge Trail Pro");
    expect(trail).toContain("Summit Ultra");
    expect(trail).not.toContain("Aurora Daily Trainer");
    expect(names("accessories").sort()).toEqual(["Blister Shield Socks (3-pack)", "Flow Hydration Vest 5L"]);
  });

  it("matches plurals, descriptions and attributes; every word must match", () => {
    expect(names("sock")).toEqual(["Blister Shield Socks (3-pack)"]);
    expect(names("vests")).toEqual(["Flow Hydration Vest 5L"]);
    expect(names("waterproof")).toContain("Ridge Trail Pro");
    expect(names("trail shoes")).toEqual(expect.arrayContaining(["Ridge Trail Pro", "Summit Ultra"]));
    expect(names("trail shoes")).not.toContain("Blister Shield Socks (3-pack)");
    expect(names("carbon racing")).toEqual(["Velocity Carbon"]);
    expect(names("aurora socks")).toEqual([]);
  });

  it("returns nothing for empty or unmatched queries, everything for catalogue-wide words", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    expect(names("?!")).toEqual([]);
    expect(names("zzzz")).toEqual([]);
    expect(names("running")).toHaveLength(PRODUCTS.length);
  });

  it("keeps the incoming (spec sort) order for equally good matches", () => {
    const reversed = [...PRODUCTS].reverse();
    const road = searchProducts("road", reversed).map((p) => p.id);
    const expected = reversed.filter((p) => p.category === "road").map((p) => p.id);
    expect(road.slice(0, expected.length).sort()).toEqual([...expected].sort());
  });

  it("normalizes and caps queries", () => {
    expect(normalizeQuery("  a\n  b ")).toBe("a b");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery(["a"])).toBe("");
  });
});

describe("discount codes", () => {
  it("accepts the real welcome code in any case / spacing and takes 10% off the subtotal", () => {
    const r = validateCoupon("  welcome 10 ", 11500);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toBe(WELCOME_CODE);
    expect(r.discount).toBe(1150);
  });

  it("rejects unknown and empty codes with a clear message", () => {
    const bad = validateCoupon("FREESHOES", 11500);
    expect(bad).toMatchObject({ ok: false, reason: "unknown", code: "FREESHOES" });
    if (!bad.ok) expect(bad.message).toMatch(/isn't a valid/);
    expect(validateCoupon("", 11500)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateCoupon("   ", 11500)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateCoupon(WELCOME_CODE, 0)).toMatchObject({ ok: false, reason: "empty_bag" });
  });

  it("enforces a minimum spend when a code has one", () => {
    const coupons: Coupon[] = [{ code: "BIG20", percentOff: 20, minSubtotal: 20000, label: "20% off £200+" }];
    expect(validateCoupon("big20", 19999, coupons)).toMatchObject({ ok: false, reason: "min_subtotal" });
    expect(validateCoupon("big20", 20000, coupons)).toMatchObject({ ok: true, discount: 4000 });
  });

  it("sanitizes what it would record", () => {
    expect(normalizeCode("<script>alert(1)</script>")).toBe("SCRIPTALERT1SCRIPT");
    expect(normalizeCode("a".repeat(100))).toHaveLength(24);
    expect(normalizeCode(42)).toBe("");
  });

  it("rounds to whole pence and never discounts more than the subtotal", () => {
    expect(discountFor(COUPONS[0], 999)).toBe(100);
    expect(discountFor({ code: "ALL", percentOff: 150, label: "" }, 1000)).toBe(1000);
    expect(discountFor(COUPONS[0], 0)).toBe(0);
  });

  it("applies to the cart total: subtotal − discount + shipping", () => {
    const totals = { subtotal: 11500, shipping: 495, total: 11995 };
    expect(withCoupon(totals, WELCOME_CODE)).toMatchObject({ discount: 1150, total: 10845 });
    expect(withCoupon(totals, "NOPE")).toMatchObject({ discount: 0, total: 11995 });
    expect(withCoupon(totals, null)).toMatchObject({ discount: 0, total: 11995 });
  });
});

describe("newsletter", () => {
  it("validates email addresses", () => {
    expect(isValidEmail("alex.runner@example.com")).toBe(true);
    expect(isValidEmail(" a@b.co ")).toBe(true);
    expect(isValidEmail("alex@example")).toBe(false);
    expect(isValidEmail("alex example.com")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });

  it("never puts the email in the event", () => {
    const props = newsletterSignupProps("footer");
    expect(props).toEqual({ placement: "footer" });
    expect(JSON.stringify(props)).not.toMatch(/@/);
  });
});
