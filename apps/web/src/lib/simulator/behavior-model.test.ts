import { describe, expect, it } from "vitest";
import { PageSpecSchema } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE } from "@/lib/catalog/products";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import {
  PERSONAS,
  accountWallPass,
  bestKnownSpec,
  checkoutPagePass,
  copyFactor,
  shippingFor,
  stageProbability,
  type Device,
  type Stage,
} from "./behavior-model";

const DEVICES: Device[] = ["Mobile", "Desktop", "Tablet"];
const STAGES: Stage[] = ["browse", "add", "cart", "checkout", "step", "pay"];
const shoe = PRODUCTS[0];

describe("behaviour model", () => {
  it("bestKnownSpec is a valid PageSpec", () => {
    expect(() => PageSpecSchema.parse(bestKnownSpec())).not.toThrow();
  });

  it("theme accent and radius are neutral everywhere", () => {
    const themed = applyPatch(DEFAULT_SPEC, { theme: { accent: "#dc2626", radius: "full" } });
    for (const persona of PERSONAS)
      for (const device of DEVICES)
        for (const stage of STAGES) {
          const ctx = { device, product: shoe, subtotal: shoe.price };
          expect(stageProbability(stage, themed, persona, ctx)).toBe(stageProbability(stage, DEFAULT_SPEC, persona, ctx));
        }
  });

  it("CTA below the description hurts mobile add-to-cart; sticky helps", () => {
    const ctx = { device: "Mobile" as const, product: shoe };
    const at = (ctaPosition: "above-fold" | "below-description" | "sticky") =>
      stageProbability("add", applyPatch(DEFAULT_SPEC, { productPage: { ctaPosition } }), "mobile-skimmer", ctx);
    expect(at("below-description")).toBeLessThan(at("above-fold"));
    expect(at("sticky")).toBeGreaterThan(at("above-fold"));
  });

  it("low-stock urgency is double-edged", () => {
    const urgent = applyPatch(DEFAULT_SPEC, { productPage: { urgency: "low-stock" } });
    const ctx = { device: "Desktop" as const, product: shoe };
    expect(stageProbability("add", urgent, "impulse-buyer", ctx)).toBeGreaterThan(stageProbability("add", DEFAULT_SPEC, "impulse-buyer", ctx));
    expect(stageProbability("add", urgent, "researcher", ctx)).toBeLessThan(stageProbability("add", DEFAULT_SPEC, "researcher", ctx));
  });

  it("a 4-column grid helps desktop and hurts mobile", () => {
    const four = applyPatch(DEFAULT_SPEC, { productGrid: { columns: 4 } });
    const p = (spec: typeof four, device: Device) => stageProbability("browse", spec, "researcher", { device });
    expect(p(four, "Desktop")).toBeGreaterThan(p(DEFAULT_SPEC, "Desktop"));
    expect(p(four, "Mobile")).toBeLessThan(p(DEFAULT_SPEC, "Mobile"));
  });

  it("guest checkout removes the account wall; fewer steps pass more often", () => {
    expect(accountWallPass(DEFAULT_SPEC, "impulse-buyer", "Mobile")).toBeLessThan(0.85);
    expect(accountWallPass(applyPatch(DEFAULT_SPEC, { checkout: { guestCheckout: true } }), "impulse-buyer", "Mobile")).toBe(1);
    const flow = (steps: 1 | 3) => {
      const spec = applyPatch(DEFAULT_SPEC, { checkout: { steps } });
      return Math.pow(checkoutPagePass(spec, "mobile-skimmer", "Mobile"), steps);
    };
    expect(flow(1)).toBeGreaterThan(flow(3));
  });

  it("free shipping applies at the threshold", () => {
    expect(shippingFor(DEFAULT_SPEC, 50_000)).toBe(SHIPPING_FEE);
    const spec = applyPatch(DEFAULT_SPEC, { cart: { freeShippingThreshold: 7500 } });
    expect(shippingFor(spec, 7499)).toBe(SHIPPING_FEE);
    expect(shippingFor(spec, 7500)).toBe(0);
  });

  it("copy effects are small and stable", () => {
    for (const text of ["Add to bag", "Buy now", "Get yours", "Add to cart"]) {
      const f = copyFactor(text, 0.03);
      expect(f).toBeGreaterThanOrEqual(0.97);
      expect(f).toBeLessThanOrEqual(1.03);
      expect(copyFactor(text, 0.03)).toBe(f);
    }
  });
});
