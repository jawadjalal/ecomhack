import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsEvent, WebRule } from "@/lib/contracts";
import { eventStore, track } from "@/lib/analytics/store";
import {
  assignWebVariant,
  changeEffect,
  classifySource,
  computeSite,
  createRule,
  deleteRule,
  EXPOSURE_EVENT,
  heuristicDraft,
  knownSites,
  listRules,
  matchesAudience,
  outlineFromHtml,
  resetWebRules,
  simulateWebTraffic,
  stripPreviewParams,
  suggestRules,
  updateRule,
  webState,
} from ".";

beforeEach(() => {
  resetWebRules();
  eventStore().clear();
});
afterEach(() => resetWebRules());

const SITE = "north-trail";
const draft = (over: Record<string, unknown> = {}) => ({
  site: SITE,
  name: "Facts banner",
  audience: { sources: ["ai"] },
  changes: [{ action: "banner", value: "Free delivery · Free returns" }],
  ...over,
});

describe("segment (server twin of the runtime)", () => {
  it.each([
    ["https://n.example/?utm_source=chatgpt.com", "", "ai"],
    ["https://n.example/", "https://www.perplexity.ai/search?q=x", "ai"],
    ["https://n.example/?gclid=abc", "https://www.google.com/", "paid"],
    ["https://n.example/?utm_medium=email&utm_source=klaviyo", "", "email"],
    ["https://n.example/", "https://www.google.co.uk/", "search"],
    ["https://n.example/", "https://l.instagram.com/", "social"],
    ["https://n.example/", "https://t.co/abc", "social"],
    ["https://n.example/", "https://blog.runner.example/post", "referral"],
    ["https://n.example/", "https://n.example/other", "direct"],
    ["https://n.example/", "", "direct"],
    ["https://n.example/?utm_term=trail+shoes", "", "search"],
  ])("classifies %s (referrer %s) as %s, like the runtime", (url, referrer, source) => {
    expect(classifySource({ url, referrer }).source).toBe(source);
  });

  it("matches audiences by source, query words and path", () => {
    const seg = { source: "search" as const, query: "waterproof trail shoes" };
    expect(matchesAudience({}, seg)).toBe(true);
    expect(matchesAudience({ sources: ["ai"] }, seg)).toBe(false);
    expect(matchesAudience({ sources: ["search"], queryIncludes: ["Waterproof"] }, seg)).toBe(true);
    expect(matchesAudience({ queryIncludes: ["road"] }, seg)).toBe(false);
    expect(matchesAudience({ paths: ["/products/"] }, seg, "/")).toBe(false);
  });

  it("splits test traffic roughly by allocation and shows shipped/always rules to everyone", () => {
    const rule = { id: "wr_x", mode: "test" as const, status: "running" as const, allocation: 0.5 };
    const treated = Array.from({ length: 2000 }, (_, i) => assignWebVariant(`v_${i}`, rule)).filter((v) => v === "treatment").length;
    expect(treated).toBeGreaterThan(900);
    expect(treated).toBeLessThan(1100);
    expect(assignWebVariant("v_1", { ...rule, status: "shipped" })).toBe("treatment");
    expect(assignWebVariant("v_1", { ...rule, mode: "always" })).toBe("treatment");
  });
});

describe("rule store", () => {
  it("validates rules: plain values, safe styles, sane selectors, 1–5 changes", () => {
    expect(() => createRule(draft({ changes: [] }))).toThrow();
    expect(() => createRule(draft({ changes: [{ action: "style", selector: "h1", value: "background:url(https://evil.example/x.png)" }] }))).toThrow(/style/);
    expect(() => createRule(draft({ changes: [{ action: "text", selector: "h1 { color: red }", value: "x" }] }))).toThrow(/selector/);
    expect(() => createRule(draft({ changes: [{ action: "text", value: "no selector" }] }))).toThrow(/selector/);
    expect(() => createRule(draft({ site: "../etc" }))).toThrow(/site/);
    expect(() => createRule(draft({ allocation: 1 }))).toThrow();
    const r = createRule(draft({ changes: [{ action: "banner", selector: "ignored", value: "Hi" }] }));
    expect(r.changes).toEqual([{ action: "banner", value: "Hi" }]);
    expect(r).toMatchObject({ status: "draft", mode: "test", allocation: 0.5, metric: "order_completed" });
  });

  it("stamps start and ship times, and locks a test's content once it has run", () => {
    const r = createRule(draft());
    const running = updateRule(r.id, { status: "running" });
    expect(running.startedAt).toBeTruthy();
    expect(() => updateRule(r.id, { changes: [{ action: "banner", value: "Different" }] })).toThrow(/locked/);
    const shipped = updateRule(r.id, { status: "shipped" });
    expect(shipped.shippedAt).toBeTruthy();
    expect(() => updateRule(r.id, { status: "running" })).toThrow(/paused/);
    expect(updateRule(r.id, { status: "paused" }).status).toBe("paused");
    expect(deleteRule(r.id)).toBe(true);
    expect(listRules(SITE)).toEqual([]);
  });
});

function ev(event: string, distinct_id: string, timestamp: string, properties: Record<string, unknown> = {}): AnalyticsEvent {
  return { uuid: `${event}-${distinct_id}-${timestamp}`, event, distinct_id, timestamp, properties: { darwin_site: SITE, synthetic: false, ...properties } };
}

describe("results", () => {
  it("recomputes arms server-side, counts only conversions after exposure, ignores other sites", () => {
    const rule: WebRule = { ...createRule(draft()), status: "running", startedAt: "2026-09-26T09:00:00.000Z" };
    // Find one visitor per arm.
    const ids = Array.from({ length: 50 }, (_, i) => `v_${i}`);
    const t = ids.find((v) => assignWebVariant(v, rule) === "treatment")!;
    const c = ids.find((v) => assignWebVariant(v, rule) === "control")!;
    const c2 = ids.filter((v) => assignWebVariant(v, rule) === "control")[1];
    const events = [
      ev("$pageview", t, "2026-09-26T10:00:00.000Z", { $current_url: "https://n.example/?utm_source=chatgpt.com" }),
      // The client claims the treatment arm and a different source: ignored / used only as reported.
      ev(EXPOSURE_EVENT, t, "2026-09-26T10:00:01.000Z", { rule_id: rule.id, web_source: "ai", variant: "control" }),
      ev("order_completed", t, "2026-09-26T10:05:00.000Z"),
      ev(EXPOSURE_EVENT, c, "2026-09-26T10:00:01.000Z", { rule_id: rule.id, web_source: "ai" }),
      ev("order_completed", c, "2026-09-26T09:59:00.000Z"), // before exposure: doesn't count
      ev(EXPOSURE_EVENT, c2, "2026-09-26T08:00:00.000Z", { rule_id: rule.id, web_source: "ai" }), // before the rule started
      ev(EXPOSURE_EVENT, "v_other", "2026-09-26T10:00:01.000Z", { rule_id: rule.id, web_source: "ai", darwin_site: "someone-else" }),
    ];
    const { results, overview } = computeSite(SITE, [rule], events);
    expect(results[0].treatment).toEqual({ visitors: 1, conversions: 1, conversionRate: 1 });
    expect(results[0].control).toEqual({ visitors: 1, conversions: 0, conversionRate: 0 });
    expect(results[0].bySource.ai?.treatment.visitors).toBe(1);
    expect(results[0].probabilityToBeat).toBeGreaterThan(0.5);
    expect(results[0].synthetic).toBe(false);
    expect(overview).toMatchObject({ visitors: 3, conversions: 2, url: "https://n.example/" });
    expect(overview.bySource.ai.visitors).toBe(3);
  });

  it("lists known sites from darwin.js events and rules", () => {
    createRule(draft({ site: "rules-only" }));
    const sites = knownSites(listRules(), [
      ev("$pageview", "v_1", "2026-09-26T10:00:00.000Z", { $current_url: "https://n.example/p?utm_source=x&x=1" }),
      ev("$pageview", "v_console", "2026-09-26T10:00:01.000Z", { $current_url: "https://n.example/?darwin_source=ai" }), // a console preview
    ]);
    expect(sites.map((s) => s.site)).toEqual([SITE, "rules-only"]);
    expect(sites[0]).toMatchObject({ visitors: 1, url: "https://n.example/p?x=1" });
    expect(stripPreviewParams("https://n.example/?utm_term=a&gclid=b&keep=1#top")).toBe("https://n.example/?keep=1");
  });
});

describe("drafting", () => {
  const outline = outlineFromHtml(`
    <header><button class="cart" id="checkout">Cart (0) · Checkout</button><div class="promo-popup newsletter">Sign up for 10% off<button class="close">×</button></div></header>
    <h1 class="hero-title text-4xl">Trail shoes built for mud</h1><p class="hero-sub">Grip that doesn't quit.</p>
    <script>var x = "<h1>not me</h1>"</script>
    <button class="btn add-to-cart" name="add" data-id="ridge">Add to cart</button><button>⌕</button>
    <a class="btn btn-primary" href="/checkout">Checkout</a>`);

  it("outlines a page's changeable elements with real selectors", () => {
    expect(outline.map((e) => e.selector)).toEqual(["button#checkout", "div.promo-popup", "button.close", "h1.hero-title", "p.hero-sub", "button.add-to-cart", "a.btn"]);
    expect(outline.find((e) => e.tag === "h1")?.text).toBe("Trail shoes built for mud");
  });

  it("turns plain English into a rule without an LLM", () => {
    const ai = heuristicDraft(SITE, "Visitors from ChatGPT should see a banner saying Free UK delivery over £60 and 60-day returns", outline);
    expect(ai).toMatchObject({ audience: { sources: ["ai"] }, mode: "test", author: "heuristic" });
    // Not on this page: kept in the merchant's words, but marked for them to confirm before it can go live.
    expect(ai.changes).toEqual([{ action: "banner", value: "[Confirm: Free UK delivery over £60 and 60-day returns]" }]);

    const search = heuristicDraft(SITE, "For Google searchers, put their search in the headline", outline);
    expect(search.audience.sources).toEqual(["search"]);
    expect(search.changes[0]).toMatchObject({ action: "text", selector: "h1.hero-title" });
    expect(search.changes[0].value).toContain("{query}");

    const multi = heuristicDraft(SITE, `Instagram and TikTok traffic: hide the newsletter popup, add a badge "★ 4.8 from 2,000 runners" and a banner 'Free returns'`, outline);
    expect(multi.audience.sources).toEqual(["social"]);
    expect(multi.changes).toEqual([
      { action: "hide", selector: "div.promo-popup" },
      { action: "badge", selector: "button.add-to-cart", value: "[Confirm: ★ 4.8 from 2,000 runners]" },
      { action: "banner", value: "[Confirm: Free returns]" },
    ]);

    const ads = heuristicDraft(SITE, "Always show google ads visitors a banner", outline);
    expect(ads).toMatchObject({ audience: { sources: ["paid"] }, mode: "always" });
  });

  it("suggests one playbook idea per source, biggest gap first, citing the data", () => {
    const overview = computeSite(SITE, [], []).overview;
    expect(suggestRules(SITE, overview, outline).map((r) => r.audience.sources?.[0])).toEqual(["ai", "search", "social", "paid", "email"]);
    overview.visitors = 1000;
    overview.conversionRate = 0.03;
    overview.bySource.social = { visitors: 400, conversions: 2, conversionRate: 0.005 };
    const [first] = suggestRules(SITE, overview, outline);
    expect(first.audience.sources).toEqual(["social"]);
    expect(first.changes[0]).toMatchObject({ action: "badge", selector: "button.add-to-cart" });
    expect(first.hypothesis).toMatch(/convert at 0\.5% vs 3\.0%/);
  });
});

describe("simulator", () => {
  it("models a change as helping only when it answers what that source came for", () => {
    const ai = { source: "ai" as const, query: "" };
    const search = { source: "search" as const, query: "trail shoes" };
    expect(changeEffect({ action: "banner", value: "Free delivery · 60-day returns" }, ai)).toBeGreaterThan(1);
    expect(changeEffect({ action: "banner", value: "New season colours" }, ai)).toBeLessThan(1);
    expect(changeEffect({ action: "text", selector: "h1", value: "{query}, in stock" }, search)).toBeGreaterThan(1.3);
    expect(changeEffect({ action: "text", selector: "h1", value: "{query}, in stock" }, { ...search, query: "" })).toBe(1);
  });

  it("sends labelled synthetic visitors through live rules only", () => {
    const rule = updateRule(createRule(draft()).id, { status: "running" });
    createRule(draft({ name: "Draft, not live" }));
    const out = simulateWebTraffic({ site: SITE, visitors: 2000, rules: listRules(SITE), url: "https://n.example/", seed: 42 });
    expect(out).toMatchObject({ visitors: 2000, synthetic: true });
    const events = eventStore().all();
    expect(events.every((e) => e.properties.synthetic === true && e.properties.darwin_site === SITE)).toBe(true);
    const exposures = events.filter((e) => e.event === EXPOSURE_EVENT);
    expect(new Set(exposures.map((e) => e.properties.rule_id))).toEqual(new Set([rule.id]));
    expect(exposures.every((e) => e.properties.web_source === "ai")).toBe(true);

    const state = webState(SITE);
    const res = state.results.find((r) => r.ruleId === rule.id)!;
    expect(res.synthetic).toBe(true);
    expect(res.control.visitors + res.treatment.visitors).toBe(exposures.length);
    expect(state.overview.syntheticVisitors).toBe(2000);
    expect(state.sites[0]).toMatchObject({ site: SITE, rules: 2 });
  });

  it("doesn't touch real events", () => {
    track({ event: "$pageview", distinct_id: "v_real", properties: { darwin_site: SITE, synthetic: false } });
    simulateWebTraffic({ site: SITE, visitors: 10, rules: [], url: "https://n.example/", seed: 1 });
    expect(eventStore().all().filter((e) => e.properties.synthetic === false)).toHaveLength(1);
  });
});
