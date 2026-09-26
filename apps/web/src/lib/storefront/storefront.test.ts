import { describe, expect, it } from "vitest";
import { PRODUCTS, SHIPPING_FEE, getProduct } from "@/lib/catalog/products";
import { PageSpecSchema } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { allArtFiles } from "./art/catalog-art";
import { deliveryEstimate } from "./delivery";
import { decodePreviewSpec, encodePreviewSpec, previewUrl, withPersist } from "./preview";
import { priceCart, shippingFor } from "./pricing";
import { lowStockCallout, productImage, ratingDistribution, sortProducts, storeProducts } from "./products";

describe("previewSpec", () => {
  it("round-trips a full spec through base64url", () => {
    const spec = applyPatch(DEFAULT_SPEC, { hero: { headline: "Run £ ünïcode — fast" }, theme: { radius: "full" } });
    const token = encodePreviewSpec(spec);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePreviewSpec(token)).toEqual(spec);
  });

  it("rejects garbage, partial and invalid specs", () => {
    expect(decodePreviewSpec(undefined)).toBeNull();
    expect(decodePreviewSpec("not-base64!!")).toBeNull();
    const partial = Buffer.from(JSON.stringify({ hero: DEFAULT_SPEC.hero })).toString("base64url");
    expect(decodePreviewSpec(partial)).toBeNull();
    const invalid = Buffer.from(JSON.stringify({ ...DEFAULT_SPEC, checkout: { ...DEFAULT_SPEC.checkout, steps: 9 } })).toString("base64url");
    expect(decodePreviewSpec(invalid)).toBeNull();
  });

  it("builds preview URLs and keeps persisted params on links", () => {
    expect(previewUrl(DEFAULT_SPEC, "/store/cart")).toMatch(/^\/store\/cart\?previewSpec=/);
    expect(withPersist("/store", "")).toBe("/store");
    expect(withPersist("/store/cart", "variant=treatment")).toBe("/store/cart?variant=treatment");
    expect(withPersist("/store?category=road#collection", "debug=1")).toBe("/store?category=road&debug=1#collection");
  });
});

describe("pricing", () => {
  const withThreshold = (t: number | null, upfront = false) => applyPatch(DEFAULT_SPEC, { cart: { freeShippingThreshold: t, showShippingUpfront: upfront } });

  it("charges the flat fee unless over the free-shipping threshold", () => {
    expect(shippingFor(0, DEFAULT_SPEC)).toBe(0);
    expect(shippingFor(11500, DEFAULT_SPEC)).toBe(SHIPPING_FEE);
    expect(shippingFor(11500, withThreshold(10000))).toBe(0);
    expect(shippingFor(9500, withThreshold(10000))).toBe(SHIPPING_FEE);
  });

  it("prices lines and reports distance to free delivery", () => {
    const t = priceCart(
      [
        { productId: "p_tempo", color: "Chalk", size: "9", quantity: 1 },
        { productId: "p_socks", color: "Black", size: "One size", quantity: 2 },
        { productId: "p_missing", color: "x", size: "1", quantity: 1 },
      ],
      withThreshold(15000),
    );
    expect(t.lines).toHaveLength(2);
    expect(t.itemCount).toBe(3);
    expect(t.subtotal).toBe(9500 + 2 * 1800);
    expect(t.shipping).toBe(SHIPPING_FEE);
    expect(t.total).toBe(t.subtotal + SHIPPING_FEE);
    expect(t.remainingForFree).toBe(15000 - t.subtotal);
    expect(t.qualifiesForFree).toBe(false);
  });
});

describe("delivery estimate", () => {
  it("counts down to the 8pm London cutoff and skips Sundays", () => {
    // Fri 25 Sep 2026, 14:30 BST (13:30 UTC)
    const fri = deliveryEstimate(new Date("2026-09-25T13:30:00Z"), 2);
    expect(fri.countdown).toBe("5h 30m");
    expect(fri.weekday).toBe("Monday"); // Sat, (Sun skipped), Mon
    expect(fri.message).toBe("Order in the next 5h 30m, get it Monday");
  });

  it("rolls over to the next day after the cutoff", () => {
    // Tue 29 Sep 2026, 21:15 BST
    const late = deliveryEstimate(new Date("2026-09-29T20:15:00Z"), 1);
    expect(late.countdown).toBe("22h 45m");
    expect(late.weekday).toBe("Thursday");
    expect(late.date).toBe("Thu 1 Oct");
  });
});

describe("catalog helpers", () => {
  it("sorts by every PageSpec sort key", () => {
    expect(sortProducts(PRODUCTS, "featured").map((p) => p.id)).toEqual(PRODUCTS.map((p) => p.id));
    expect(sortProducts(PRODUCTS, "bestselling")[0].bestsellerRank).toBe(1);
    const byPrice = sortProducts(PRODUCTS, "price-asc").map((p) => p.price);
    expect(byPrice).toEqual([...byPrice].sort((a, b) => a - b));
    const byRating = sortProducts(PRODUCTS, "rating").map((p) => p.rating);
    expect(byRating).toEqual([...byRating].sort((a, b) => b - a));
    expect(storeProducts("featured", "trail").every((p) => p.category === "trail")).toBe(true);
  });

  it("picks the right low-stock callout", () => {
    const velocity = getProduct("p_velocity")!;
    expect(lowStockCallout(velocity)?.stock).toBe(1);
    expect(lowStockCallout(velocity, "8")).toEqual({ size: "8", stock: 5 });
    expect(lowStockCallout(getProduct("p_tempo")!, "8")).toBeNull();
  });

  it("maps colourways to art files that exist", () => {
    const files = new Set(allArtFiles().map((f) => `/products/${f.file}`));
    for (const p of PRODUCTS) {
      expect(files.has(p.image)).toBe(true);
      for (const c of p.colors) expect(files.has(productImage(p, c.name))).toBe(true);
    }
  });

  it("produces rating distributions that sum to 100", () => {
    for (const r of [4.3, 4.6, 4.8]) expect(ratingDistribution(r).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("default spec is valid", () => {
    expect(PageSpecSchema.safeParse(DEFAULT_SPEC).success).toBe(true);
  });
});
