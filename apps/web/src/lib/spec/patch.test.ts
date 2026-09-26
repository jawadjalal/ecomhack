import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC } from "./default-spec";
import { applyPatch, describeDiff, tryApplyPatch } from "./patch";
import { assignVariant } from "@/lib/experiments/assign";

describe("spec patches", () => {
  it("deep-merges and validates", () => {
    const next = applyPatch(DEFAULT_SPEC, { cart: { showShippingUpfront: true, freeShippingThreshold: 6000 } });
    expect(next.cart).toEqual({ showShippingUpfront: true, freeShippingThreshold: 6000, upsell: false });
    expect(next.hero).toEqual(DEFAULT_SPEC.hero);
    expect(describeDiff(DEFAULT_SPEC, next)).toEqual([
      "cart.showShippingUpfront: false → true",
      "cart.freeShippingThreshold: null → 6000",
    ]);
  });

  it("rejects invalid patches", () => {
    expect(tryApplyPatch(DEFAULT_SPEC, { checkout: { steps: 7 as 1 } })).toBeNull();
  });
});

describe("assignment", () => {
  it("is sticky and roughly balanced", () => {
    expect(assignVariant("v_1", "exp_a")).toBe(assignVariant("v_1", "exp_a"));
    const n = Array.from({ length: 4000 }, (_, i) => assignVariant(`v_${i}`, "exp_a")).filter((v) => v === "treatment").length;
    expect(n).toBeGreaterThan(1800);
    expect(n).toBeLessThan(2200);
  });

  it("does not cluster sequential ids into long runs", () => {
    const arms = Array.from({ length: 2000 }, (_, i) => assignVariant(`sim_h_${i}`, "exp_a"));
    let longest = 1;
    let run = 1;
    for (let i = 1; i < arms.length; i++) {
      run = arms[i] === arms[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(16);
  });
});
