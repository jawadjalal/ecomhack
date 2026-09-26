import { describe, expect, it } from "vitest";
import { MAX_CLIENT_MONEY, sanitizeClientEvents } from "./trust";

const ev = (revenue: unknown) => ({ event: "order_completed", distinct_id: "v1", properties: { revenue, price: revenue } as Record<string, unknown> }) as Parameters<typeof sanitizeClientEvents>[0][number];

describe("sanitizeClientEvents money", () => {
  it("keeps sane revenue", () => {
    const [e] = sanitizeClientEvents([ev(11900)], "external");
    expect(e.properties.revenue).toBe(11900);
  });
  it("drops absurd, negative or non-numeric revenue", () => {
    for (const bad of [1e15, MAX_CLIENT_MONEY + 1, -500, "lots", Number.NaN]) {
      const [e] = sanitizeClientEvents([ev(bad)], "external");
      expect(e.properties.revenue).toBeUndefined();
      expect(e.properties.price).toBeUndefined();
    }
  });
});
