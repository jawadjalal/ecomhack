import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageElement, WebRuleDraft } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { GET as demoPage } from "@/app/demo/north-trail/route";
import { findClaims, NEEDS, needsMerchant, pageTexts, readyToPublish, unverifiedClaims } from "./claims";
import {
  AUTOPILOT,
  computeSite,
  createRule,
  draftRule,
  FOLLOW_UPS,
  getAutopilot,
  heuristicDraft,
  ideaDraft,
  ideasFor,
  listRules,
  outlineFromHtml,
  PLAYBOOK,
  resetAutopilot,
  resetWebRules,
  retractUnbackedCopy,
  setAutopilot,
  simulateWebTraffic,
  stepAutopilot,
  suggestRules,
  updateRule,
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
  eventStore().clear();
  llm.on = false;
  llm.out = undefined;
  llm.prompts = [];
  demo = outlineFromHtml(await (await demoPage(new Request("http://localhost/demo/north-trail"))).text());
});
afterEach(() => {
  resetWebRules();
  resetAutopilot();
});

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
    const filled = updateRule(saved.id, { changes: [{ action: "badge", selector: draft.changes[0].selector, value: "★ 4.6 from 310 reviews" }] });
    expect(updateRule(filled.id, { status: "running" }).status).toBe("running");
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
    const old = createRule(
      { site: SITE, name: "Reviews badge for social visitors", audience: { sources: ["social"] }, changes: [{ action: "badge", selector: "button.add-to-cart", value: "★ 4.8/5 from 2,000+ customers" }], mode: "test", author: "autopilot" },
      "running",
    );
    const honest = createRule(
      { site: SITE, name: "Delivery & returns banner for AI assistants", audience: { sources: ["ai"] }, changes: [{ action: "banner", value: "Free 60-day returns" }], mode: "test", author: "autopilot" },
      "running",
    );
    setAutopilot(SITE, true);
    const { actions } = stepAutopilot(SITE, demo);
    expect(listRules(SITE).find((r) => r.id === old.id)).toMatchObject({ status: "paused", outcome: { decision: "stopped", by: "autopilot" } });
    expect(listRules(SITE).find((r) => r.id === old.id)?.outcome?.reason).toMatch(/★ 4\.8\/5/);
    expect(listRules(SITE).find((r) => r.id === honest.id)?.status).toBe("running");
    expect(actions.find((a) => a.ruleId === old.id)).toMatchObject({ kind: "stopped" });
  });

  it("takes it down when autopilot is switched off too (no step needed), but not when the page can't be read", () => {
    const old = createRule(
      { site: SITE, name: "Offer banner for ad clicks", audience: { sources: ["paid"] }, changes: [{ action: "banner", value: "Free delivery on your first order" }], mode: "test", author: "autopilot" },
      "running",
    );
    setAutopilot(SITE, false);
    expect(retractUnbackedCopy(SITE, []).log.some((e) => e.ruleId === old.id)).toBe(false);
    expect(listRules(SITE)[0].status).toBe("running");
    const state = retractUnbackedCopy(SITE, demo);
    expect(state.log[0]).toMatchObject({ kind: "stopped", ruleId: old.id });
    expect(listRules(SITE)[0].status).toBe("paused");
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
