import { describe, expect, it } from "vitest";
import { normaliseMoney } from "./surface";

describe("normaliseMoney (pence in, but forgiving of pounds)", () => {
  it("reads plausible prices as pounds", () => {
    expect(normaliseMoney(119)).toBe(11900);
    expect(normaliseMoney(89.99)).toBe(8999);
    expect(normaliseMoney(1)).toBe(100);
  });
  it("keeps pence that can't be a price in pounds", () => {
    expect(normaliseMoney(500)).toBe(500); // a £5 lowball, not £500
    expect(normaliseMoney(900)).toBe(900); // a £9 budget, not £900
    expect(normaliseMoney(12000)).toBe(12000);
  });
  it("never goes negative or NaN", () => {
    expect(normaliseMoney(-5)).toBe(0);
    expect(normaliseMoney(Number.NaN)).toBe(0);
  });
});
