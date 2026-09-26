import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { computeHeatmap, EXPOSURE_EVENT, outlineFromHtml, simulateWebTraffic } from ".";

const SITE = "north-trail";
let n = 0;
function ev(event: string, distinct_id: string, props: Record<string, unknown> = {}): AnalyticsEvent {
  return {
    uuid: `u${n++}`,
    event,
    distinct_id,
    timestamp: `2026-09-26T10:00:${String(n % 60).padStart(2, "0")}.000Z`,
    properties: { darwin_site: SITE, $pathname: "/", $current_url: "https://n.example/", synthetic: false, ...props },
  };
}
const click = (id: string, selector: string, text = "", extra: Record<string, unknown> = {}) => ev("$autocapture", id, { $selector: selector, $el_tag: "button", $el_text: text, ...extra });

beforeEach(() => eventStore().clear());

describe("click heatmap", () => {
  it("counts clicks per element, by source and page, and leaves out previews and other sites", () => {
    const events = [
      ev("$pageview", "v_ai", { $current_url: "https://n.example/?utm_source=chatgpt.com" }),
      ev("$pageview", "v_social", { $referrer: "https://l.instagram.com/" }),
      ev(EXPOSURE_EVENT, "v_search", { web_source: "search", rule_id: "r1" }),
      click("v_ai", "main#shop > article.card > button.add-to-cart", "Add to cart"),
      click("v_social", "aside.promo-popup > button.close", "×"),
      click("v_social", "main#shop > article.card > button.add-to-cart", "Add to cart"),
      click("v_search", "main#shop > article.card > button.add-to-cart", "Add to cart"),
      click("v_social", "h1.hero-title", "Trail shoes", { $pathname: "/other" }),
      ev("$rageclick", "v_social", { $selector: "h1.hero-title", $el_tag: "h1" }),
      click("v_console", "button#checkout", "Checkout", { $current_url: "https://n.example/?darwin_source=ai&darwin_variant=treatment" }),
      click("v_else", "button#checkout", "Checkout", { darwin_site: "someone-else" }),
    ];
    const all = computeHeatmap(SITE, events);
    expect(all).toMatchObject({ clicks: 5, rageClicks: 1, visitors: 3, syntheticClicks: 0 });
    expect(all.elements[0]).toMatchObject({ selector: "main#shop > article.card > button.add-to-cart", text: "Add to cart", clicks: 3, visitors: 3, share: 0.6 });
    expect(all.elements.find((e) => e.selector === "h1.hero-title")).toMatchObject({ clicks: 1, rageClicks: 1 });
    expect(all.elements.some((e) => e.selector === "button#checkout")).toBe(false);

    const social = computeHeatmap(SITE, events, { source: "social", path: "/" });
    expect(social.elements.map((e) => [e.selector, e.clicks])).toEqual([
      ["aside.promo-popup > button.close", 1],
      ["main#shop > article.card > button.add-to-cart", 1],
      ["h1.hero-title", 0], // a rage click on "/" with no plain click there
    ]);
    expect(computeHeatmap(SITE, events, { source: "search" }).clicks).toBe(1); // source from the exposure
  });

  it("simulated visitors click the page's real elements, differently by source, labelled synthetic", () => {
    const outline = outlineFromHtml(`<button class="cart" id="checkout">Cart (0) · Checkout</button>
      <aside class="promo-popup"><button class="close">×</button>Get 10% off</aside>
      <h1 class="hero-title">Trail shoes</h1><a class="shop-now" href="#shop">Shop the range</a>
      <button class="add-to-cart">Add to cart</button>`);
    simulateWebTraffic({ site: SITE, visitors: 2000, rules: [], url: "https://n.example/", outline, seed: 9 });
    const heat = computeHeatmap(SITE, eventStore().all());
    expect(heat.syntheticClicks).toBe(heat.clicks);
    expect(new Set(heat.elements.map((e) => e.selector))).toEqual(new Set(["button.close", "a.shop-now", "h1.hero-title", "button.add-to-cart", "button#checkout"]));
    expect(heat.rageClicks).toBeGreaterThan(0);
    const popupShare = (s: "ai" | "social") => {
      const h = computeHeatmap(SITE, eventStore().all(), { source: s });
      return (h.elements.find((e) => e.selector === "button.close")?.clicks ?? 0) / h.visitors;
    };
    expect(popupShare("social")).toBeGreaterThan(popupShare("ai"));
  });
});
