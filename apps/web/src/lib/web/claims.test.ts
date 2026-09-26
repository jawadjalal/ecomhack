import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageElement, WebRule, WebRuleDraft } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { kvUpdate } from "@/lib/db/json-store";
import { GET as demoPage } from "@/app/demo/north-trail/route";
import { POST as createRoute } from "@/app/api/web/rules/route";
import { GET as runtimeRoute } from "@/app/api/web/runtime.js/route";
import { findClaims, NEEDS, needsMerchant, pageTexts, readyToPublish, unverifiedClaims } from "./claims";
import {
  AUTOPILOT,
  computeSite,
  createRule,
  draftRule,
  endRule,
  FOLLOW_UPS,
  forgetPages,
  getAutopilot,
  heuristicDraft,
  ideaDraft,
  ideasFor,
  listRules,
  outlineFromHtml,
  PLAYBOOK,
  rememberPage,
  resetAutopilot,
  resetWebRules,
  retractUnbackedCopy,
  setAutopilot,
  simulateWebTraffic,
  stepAutopilot,
  suggestRules,
  updateRule,
  webState,
  WebRuleError,
} from ".";

const llm = vi.hoisted(() => ({ on: false, out: undefined as unknown, prompts: [] as { system?: string; prompt: string }[] }));
vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.on,
  llmLabel: () => "llm:test",
  generateJson: async (req: { system?: string; prompt: string; schema: { parse: (x: unknown) => unknown } }) => {
    llm.prompts.push(req);
    return req.schema.parse(llm.out);
  },
}));

const SITE = "north-trail";
const TRAFFIC_SOURCES = ["ai", "search", "social", "paid", "email", "referral", "direct"] as const;
let demo: PageElement[] = [];

beforeEach(async () => {
  resetWebRules();
  resetAutopilot();
  forgetPages();
  eventStore().clear();
  llm.on = false;
  llm.out = undefined;
  llm.prompts = [];
  demo = outlineFromHtml(await (await demoPage(new Request("http://localhost/demo/north-trail"))).text());
});
afterEach(() => {
  resetWebRules();
  resetAutopilot();
  forgetPages();
});

/** A rule an older Darwin (or anyone, before the honesty gate) put live: saved as a draft, then forced live. */
function legacyLive(draft: WebRuleDraft | Record<string, unknown>, status: "running" | "shipped" = "running"): WebRule {
  const rule = createRule(draft, "draft");
  const live = { ...rule, status, startedAt: new Date().toISOString(), ...(status === "shipped" ? { shippedAt: new Date().toISOString() } : {}) };
  kvUpdate<WebRule[]>("web-rules", () => [], (all) => all.map((r) => (r.id === rule.id ? live : r)));
  return live;
}

/** Every claim-like phrase in a rule's copy that the page doesn't make, ignoring text left for the merchant. */
function invented(rule: Pick<WebRuleDraft, "changes">, outline: PageElement[]): string[] {
  return rule.changes.flatMap((c) => (needsMerchant(c.value) ? [] : unverifiedClaims(c.value, pageTexts(outline))));
}

describe("claim detection", () => {
  it("spots ratings, counts, awards, delivery and returns promises, discounts and stock levels", () => {
    for (const text of [
      "★ 4.8/5 from 2,000+ customers",
      "★4.8 from 2,000+ customers",
      "Loved by 2,000+ customers",
      "Rated 4.8 by 12,400 runners",
      "4.9 out of 5",
      "Free delivery · Free 60-day returns · Ships within 24 hours",
      "Straight answers: free returns, 2-year warranty",
      "{query}: in stock, ships today",
      "Get 20% off today",
      "Money-back guarantee",
      "Award-winning trail shoes",
      "Only 3 left",
      "Recommended by runners you trust",
      "Next-day delivery",
      "The pair everyone's talking about",
      "Best-selling shoe of 2025",
    ]) {
      expect(findClaims(text), text).not.toEqual([]);
    }
    for (const text of ["Here's what you searched for: {query}", "{query}", "Welcome back", "Picked for ChatGPT shoppers", "Trail shoes built for mud", "Add to cart", "Shop the range"]) {
      expect(findClaims(text), text).toEqual([]);
    }
  });

  it("a claim passes only when the page makes that same claim, word for word", () => {
    const page = pageTexts(demo);
    expect(page.join(" ")).toContain("Free UK delivery over £60 · Free 60-day returns · Dispatched within 24 hours");
    expect(unverifiedClaims("Free 60-day returns", page)).toEqual([]);
    expect(unverifiedClaims("Free UK delivery over £60 · Dispatched within 24 hours", page)).toEqual([]);
    expect(unverifiedClaims("Free UK delivery", page)).toEqual(["Free UK delivery"]); // drops the £60 threshold
    expect(unverifiedClaims("Free delivery · Free 60-day returns", page)).toEqual(["Free delivery"]);
    expect(unverifiedClaims("★ 4.8/5 from 2,000+ customers", page)).toEqual(expect.arrayContaining(["★ 4.8/5", "2,000+ customers"]));
    expect(unverifiedClaims("Ships in 24h", page)).toEqual(["Ships in 24h"]);
  });
});

describe("playbook: only the page's own facts, the visitor's context, or neutral copy", () => {
  it("never suggests a claim the page doesn't make; an idea that needs a fact asks the merchant instead", () => {
    const overview = computeSite(SITE, [], []).overview;
    for (const outline of [[], demo]) {
      for (const source of TRAFFIC_SOURCES) {
        for (let i = 0; i < ideasFor(source).length; i++) {
          const draft = ideaDraft(SITE, source, i, overview, outline)!;
          expect(invented(draft, outline), `${source}:${i}`).toEqual([]);
          if (!readyToPublish(draft, outline)) expect(draft.changes.some((c) => needsMerchant(c.value)), `${source}:${i}`).toBe(true);
        }
      }
      for (const draft of suggestRules(SITE, overview, outline)) expect(invented(draft, outline)).toEqual([]);
    }
    // No page facts: the reviews badge (what used to say "★ 4.8/5 from 2,000+ customers") asks for the real numbers.
    const social = ideaDraft(SITE, "social", 0, overview, [])!;
    expect(social.changes[0]).toMatchObject({ action: "badge", value: NEEDS.reviews });
    expect(social.hypothesis).toMatch(/fill in/i);
    expect(JSON.stringify([PLAYBOOK, FOLLOW_UPS].map((p) => Object.values(p).map((x) => x.build([]))))).not.toMatch(/★|2,000|4\.8/);
  });

  it("reuses a claim that IS on the page, verbatim", () => {
    const ai = ideaDraft(SITE, "ai", 0, undefined, demo)!;
    expect(ai.changes).toEqual([{ action: "banner", value: "Free UK delivery over £60 · Free 60-day returns · Dispatched within 24 hours" }]);
    expect(readyToPublish(ai, demo)).toBe(true);
    expect(ideaDraft(SITE, "ai", 1, undefined, demo)!.changes[0]).toMatchObject({ action: "badge", value: "Free 60-day returns" });

    const withReviews = outlineFromHtml(`<h1>Trail shoes</h1><div class="product-rating">★ 4.7 from 1,284 reviews</div><button class="add-to-cart">Add to cart</button>`);
    const social = ideaDraft(SITE, "social", 0, undefined, withReviews)!;
    expect(social.changes).toEqual([{ action: "badge", selector: "button.add-to-cart", value: "★ 4.7 from 1,284 reviews" }]);
    expect(readyToPublish(social, withReviews)).toBe(true);
  });

  it("a draft that needs the merchant can be saved, but not started until it's filled in", () => {
    const draft = ideaDraft(SITE, "social", 0, undefined, [])!;
    expect(() => createRule(draft, "running")).toThrow(WebRuleError);
    const saved = createRule(draft, "draft");
    expect(() => updateRule(saved.id, { status: "running" })).toThrow(/bracketed|fill in|confirm/i);
    // Filled in with a rating the page doesn't show: still not publishable, whoever typed it.
    const filled = updateRule(saved.id, { changes: [{ action: "badge", selector: draft.changes[0].selector, value: "★ 4.6 from 310 reviews" }] });
    expect(() => updateRule(filled.id, { status: "running" }, { outline: demo })).toThrow(/nothing on your page backs that up/);
    // In the page's own words, it can go live.
    updateRule(filled.id, { changes: [{ action: "badge", selector: draft.changes[0].selector, value: "Free 60-day returns" }] });
    expect(updateRule(filled.id, { status: "running" }, { outline: demo }).status).toBe("running");
  });
});

describe("autopilot never publishes an invented claim", () => {
  it("over many rounds, on the demo page and on a page it can't read", () => {
    for (const outline of [demo, []]) {
      resetWebRules();
      resetAutopilot();
      eventStore().clear();
      setAutopilot(SITE, true);
      for (let round = 0; round < 20; round++) {
        simulateWebTraffic({ site: SITE, visitors: 2000, rules: listRules(SITE), url: "https://n.example/", seed: 500 + round });
        stepAutopilot(SITE, outline);
        for (const rule of listRules(SITE)) {
          expect(invented(rule, outline), rule.name).toEqual([]);
          expect(readyToPublish(rule, outline), rule.name).toBe(true);
        }
      }
      const rules = listRules(SITE);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.status === "shipped" || r.status === "paused")).toBe(true);
      // The demo page shows no reviews, so the social-proof badge never starts.
      expect(rules.some((r) => r.changes.some((c) => /★|review/i.test(c.value ?? "")))).toBe(false);
      expect(getAutopilot(SITE).log.length).toBeLessThanOrEqual(AUTOPILOT.maxLog);
    }
  }, 60_000);

  it("takes down a live autopilot rule whose copy the page doesn't back up (the old ★ 4.8/5 badge)", () => {
    const old = legacyLive({
      site: SITE,
      name: "Reviews badge for social visitors",
      audience: { sources: ["social"] },
      changes: [{ action: "badge", selector: "button.add-to-cart", value: "★ 4.8/5 from 2,000+ customers" }],
      mode: "test",
      author: "autopilot",
    });
    const honest = createRule(
      { site: SITE, name: "Delivery & returns banner for AI assistants", audience: { sources: ["ai"] }, changes: [{ action: "banner", value: "Free 60-day returns" }], mode: "test", author: "autopilot" },
      "running",
      { outline: demo },
    );
    setAutopilot(SITE, true);
    const { actions } = stepAutopilot(SITE, demo);
    expect(listRules(SITE).find((r) => r.id === old.id)).toMatchObject({ status: "paused", outcome: { decision: "stopped", by: "autopilot" } });
    expect(listRules(SITE).find((r) => r.id === old.id)?.outcome?.reason).toMatch(/★ 4\.8\/5/);
    expect(listRules(SITE).find((r) => r.id === honest.id)?.status).toBe("running");
    expect(actions.find((a) => a.ruleId === old.id)).toMatchObject({ kind: "stopped" });
  });

  it("takes it down when autopilot is switched off too (no step needed), but not when the page can't be read", () => {
    const old = legacyLive({
      site: SITE,
      name: "Offer banner for ad clicks",
      audience: { sources: ["paid"] },
      changes: [{ action: "banner", value: "Free delivery on your first order" }],
      mode: "test",
      author: "autopilot",
    });
    setAutopilot(SITE, false);
    expect(retractUnbackedCopy(SITE, []).log.some((e) => e.ruleId === old.id)).toBe(false);
    expect(listRules(SITE)[0].status).toBe("running");
    const state = retractUnbackedCopy(SITE, demo);
    expect(state.log[0]).toMatchObject({ kind: "stopped", ruleId: old.id });
    expect(listRules(SITE)[0].status).toBe("paused");
  });
});

describe("honesty gate: no rule goes live with a claim the page doesn't make, whoever wrote it", () => {
  const fake = (author: string, value = "4.8★ from 2,000+ customers") => ({
    site: SITE,
    name: `Social proof (${author})`,
    audience: { sources: ["social"] },
    changes: [{ action: "badge", selector: "button.add-to-cart", value }],
    mode: "test",
    author,
  });

  it("refuses to start or ship it on every path: create, start, ship-the-winner", () => {
    rememberPage(SITE, demo);
    for (const author of ["manual", "autopilot", "llm:test", "suggestion"]) {
      expect(() => createRule(fake(author), "running"), author).toThrow(WebRuleError);
      const draft = createRule(fake(author), "draft");
      expect(() => updateRule(draft.id, { status: "running" }), author).toThrow(/“4\.8★”.*nothing on your page backs that up/);
      expect(() => updateRule(draft.id, { status: "shipped" }), author).toThrow(WebRuleError);
      expect(() => endRule(draft.id, { decision: "shipped", reason: "97% chance better", at: new Date().toISOString(), by: "manual" }), author).toThrow(WebRuleError);
    }
    for (const value of ["Ships in 24h", "{query}, ships today", "15% off your first order"]) {
      expect(() => createRule(fake("manual", value), "running"), value).toThrow(/nothing on your page backs that up/);
    }
    expect(listRules(SITE).every((r) => r.status === "draft")).toBe(true);
    // The page's own words go live.
    expect(createRule(fake("manual", "Dispatched within 24 hours"), "running").status).toBe("running");
  });

  it("with no page read yet, a claim can't go live (it can't be checked), but claim-free copy can", () => {
    try {
      createRule(fake("manual"), "running");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WebRuleError);
      expect((err as WebRuleError).status).toBe(422);
      expect((err as Error).message).toMatch(/couldn't read your page/);
    }
    expect(createRule(fake("manual", "Picked for Instagram shoppers"), "running").status).toBe("running");
  });

  it("POST /api/web/rules answers 422 for a live rule with an unbacked claim", async () => {
    rememberPage("shop-x", demo);
    const post = (value: string) =>
      createRoute(new Request("http://localhost/api/web/rules", { method: "POST", body: JSON.stringify({ rule: { ...fake("manual", value), site: "shop-x" }, status: "running" }) }));
    const bad = await post("Ships in 24h");
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/“Ships in 24h”/);
    expect((await post("Free 60-day returns")).status).toBe(201);
  });

  it("pauses live rules the page doesn't back up when the web state loads, any author, and logs why in plain English", async () => {
    const fakes = ["manual", "llm:test", "suggestion", "autopilot"].map((author) => legacyLive(fake(author)));
    const shipped = legacyLive(fake("manual", "Ships in 24h"), "shipped");
    const honest = legacyLive(fake("manual", "Free 60-day returns"));
    const pending = legacyLive(fake("manual", NEEDS.reviews));
    rememberPage(SITE, demo);

    // runtime.js (what browsers get) never serves them.
    const js = await (await runtimeRoute(new Request(`http://localhost/api/web/runtime.js?site=${SITE}`))).text();
    expect(js).not.toContain("2,000+");
    expect(js).not.toContain("Ships in 24h");
    expect(js).toContain("Free 60-day returns");

    const state = webState(SITE);
    for (const r of [...fakes, shipped, pending]) expect(state.rules.find((x) => x.id === r.id)?.status, r.author).toBe("paused");
    expect(state.rules.find((x) => x.id === honest.id)?.status).toBe("running");
    const log = state.autopilot.log.find((e) => e.ruleId === fakes[0].id)!;
    expect(log).toMatchObject({ kind: "stopped" });
    expect(log.message).toContain("it claimed “4.8★ from 2,000+ customers” and nothing on your site backs that up");
    expect(state.rules.find((x) => x.id === fakes[0].id)?.outcome).toMatchObject({
      decision: "stopped",
      reason: "Paused: it claimed “4.8★ from 2,000+ customers” and nothing on your site backs that up",
      traffic: "real",
      sample: 0,
    });
    expect(state.autopilot.log.find((e) => e.ruleId === pending.id)?.message).toMatch(/only you can fill in/);
  });

  it("stamps the traffic a decision was made on, so it stays labelled after simulated visitors are gone", () => {
    const rule = createRule({ ...fake("manual", "Free 60-day returns"), audience: {} }, "running", { outline: demo });
    simulateWebTraffic({ site: SITE, visitors: 400, rules: listRules(SITE), url: "https://n.example/", seed: 3 });
    const ended = endRule(rule.id, { decision: "stopped", reason: "stopped by the merchant", at: new Date().toISOString(), by: "manual" });
    expect(ended.outcome).toMatchObject({ traffic: "simulated", sample: expect.any(Number) });
    expect(ended.outcome!.sample).toBeGreaterThan(0);
    eventStore().clear(); // a restart: simulated events aren't kept on disk
    expect(listRules(SITE)[0].outcome).toMatchObject({ traffic: "simulated", sample: ended.outcome!.sample });
  });
});

describe("drafting from a prompt", () => {
  it("fills unspecified copy from the page, or asks the merchant; never makes it up", () => {
    const prompt = "People from ChatGPT should see our delivery and returns up front in a banner";
    expect(heuristicDraft(SITE, prompt, demo).changes).toEqual([{ action: "banner", value: "Free UK delivery over £60 · Free 60-day returns · Dispatched within 24 hours" }]);
    expect(heuristicDraft(SITE, prompt, []).changes).toEqual([{ action: "banner", value: NEEDS.delivery }]);
    const social = heuristicDraft(SITE, "Instagram visitors: add a reviews badge next to the button", []);
    expect(social.changes[0].value).toBe(NEEDS.reviews);
  });

  it("marks a claim the page doesn't make for the merchant to confirm, and keeps one it does", () => {
    const d = heuristicDraft(SITE, `Instagram and TikTok: add a badge "★ 4.8 from 2,000+ runners" and a banner 'Free 60-day returns'`, demo);
    expect(d.changes).toEqual([
      { action: "badge", selector: "button.add-to-cart", value: "[Confirm: ★ 4.8 from 2,000+ runners]" },
      { action: "banner", value: "Free 60-day returns" },
    ]);
    expect(() => createRule(d, "running")).toThrow(WebRuleError);
  });

  it("Darwin's own example prompts (Personalize chips, traffic insights) make honest drafts", () => {
    const examples = [
      "Visitors from ChatGPT: a banner with our delivery and returns terms",
      "Google searchers: put their search in the headline",
      'Instagram and TikTok: add a badge "Free 60-day returns" next to Add to cart',
      "Direct visitors: hide the newsletter popup",
      "Visitors from ChatGPT and other AI assistants: a banner with our delivery and returns terms",
      "Instagram and TikTok: add a badge with our star rating next to Add to cart",
      "Paid ad visitors: put their search in the headline and add a banner with the ad's offer",
      "Email visitors: a welcome-back banner",
      "Visitors from other websites: add a badge with our returns terms next to Add to cart",
    ];
    for (const outline of [demo, []]) {
      for (const prompt of examples) expect(invented(heuristicDraft(SITE, prompt, outline), outline), prompt).toEqual([]);
    }
    // On the demo store, the chips produce rules that can start straight away, in the page's own words.
    for (const prompt of examples.slice(0, 4)) expect(readyToPublish(heuristicDraft(SITE, prompt, demo), demo), prompt).toBe(true);
    expect(heuristicDraft(SITE, examples[0], demo).changes[0].value).toBe("Free UK delivery over £60 · Free 60-day returns · Dispatched within 24 hours");
  });

  it("LLM drafts: the model is told the rule, and invented claims still get marked", async () => {
    llm.on = true;
    llm.out = {
      name: "Social proof for Instagram",
      audience: { sources: ["social"] },
      changes: [
        { action: "badge", selector: "button.add-to-cart", value: "★ 4.9 from 10,000 happy runners" },
        { action: "banner", value: "Free UK delivery over £60 · Free 60-day returns" },
        { action: "text", selector: "h1.hero-title", value: "{query}" },
      ],
      mode: "test",
    };
    const res = await draftRule(SITE, "Make Instagram visitors trust us", { outline: demo });
    expect(res.source).toBe("llm");
    expect(res.rule.changes.map((c) => c.value)).toEqual(["[Confirm: ★ 4.9 from 10,000 happy runners]", "Free UK delivery over £60 · Free 60-day returns", "{query}"]);
    expect(llm.prompts[0].system).toMatch(/never invent/i);
    expect(llm.prompts[0].system).toMatch(/rating|review/i);
  });
});
