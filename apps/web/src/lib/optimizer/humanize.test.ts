import { describe, expect, it } from "vitest";
import { describeElement, elementPhrase, humanizeInsightText, rageClickTitle } from "./humanize";

const RAW = '/store/products/[id] button[data-darwin="size-option"][disabled] "UK 12"';

describe("humanize element names", () => {
  it("parses a data-darwin selector with state and visible text", () => {
    expect(describeElement(RAW)).toEqual({ label: "size", text: "UK 12", disabled: true, name: "size-option" });
    expect(describeElement("Add to bag")).toBeUndefined();
  });

  it("names elements in plain words", () => {
    expect(elementPhrase(RAW)).toBe("sold-out size UK 12");
    expect(elementPhrase('/store/cart button[data-darwin="cart-checkout"] "Checkout"')).toBe("Checkout button");
    expect(elementPhrase('button[data-darwin="express-pay-apple"][disabled]')).toBe("unavailable Apple Pay button");
    expect(elementPhrase("Add to bag")).toBe("Add to bag");
  });

  it("writes rage-click titles without CSS selectors", () => {
    expect(rageClickTitle("134", RAW)).toBe("134 shoppers kept tapping sold-out size UK 12");
    expect(rageClickTitle("22", "Add to bag")).toBe('22 shoppers rage-clicked "Add to bag"');
    expect(rageClickTitle("9", 'button[data-darwin="cta-add-to-cart"] "Add to bag"')).toBe("9 shoppers rage-clicked the Add to bag button");
  });

  it("rewrites titles stored before humanising, and leaves other text alone", () => {
    expect(humanizeInsightText(`134 shoppers rage-clicked "${RAW}"`)).toBe("134 shoppers kept tapping sold-out size UK 12");
    expect(humanizeInsightText("45% of full bags never reach checkout")).toBe("45% of full bags never reach checkout");
    expect(humanizeInsightText(`4.3% of human visitors hammered "${RAW}" (${RAW}) repeatedly: slow.`)).toMatch(
      /^4\.3% of human visitors tapped the sold-out size UK 12 again and again: they want it, but it's unavailable/,
    );
    expect(humanizeInsightText('2% of human visitors hammered "button[data-darwin="cart-checkout"]" (/store/cart) repeatedly: slow.')).toBe(
      "2% of human visitors hammered the Checkout button repeatedly: slow.",
    );
  });
});
