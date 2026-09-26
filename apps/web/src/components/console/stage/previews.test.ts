import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { pageForPatch, pageForSpecs } from "./previews";

describe("preview page choice", () => {
  it("shows checkout changes on the checkout page, not the bag", () => {
    expect(pageForPatch({ checkout: { steps: 1 } })).toBe("checkout");
    expect(pageForPatch({ cart: { showShippingUpfront: true }, checkout: { steps: 1 } })).toBe("cart");
    expect(pageForPatch({ agentSurface: { exposeStock: true } })).toBe("home");
  });

  it("opens the before/after on the page with the most visible changes", () => {
    const live = applyPatch(DEFAULT_SPEC, {
      checkout: { steps: 1, guestCheckout: true, expressPay: true },
      productPage: { showReviews: true },
      agentSurface: { exposeStock: true, exposeDeliveryEta: true, structuredData: true, exposeReturnPolicy: true },
    });
    expect(pageForSpecs(DEFAULT_SPEC, live)).toBe("checkout");
    expect(pageForSpecs(DEFAULT_SPEC, applyPatch(DEFAULT_SPEC, { agentSurface: { exposeStock: true } }))).toBe("home");
  });
});
