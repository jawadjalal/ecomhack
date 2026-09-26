import { beforeEach, describe, expect, it } from "vitest";
import { eventStore, track } from "@/lib/analytics/store";
import { resetWebRules, simulateWebTraffic } from "@/lib/web";
import { detectAnalytics } from "@/lib/github";
import { applyToggles, buildPlan, computeDashboards, getPlan, heuristicAmend, heuristicPlan, planIntro, resetPlans, savePlan, trackingDoc, trackingSummary } from ".";

beforeEach(() => {
  eventStore().clear();
  resetPlans();
  resetWebRules();
});

const SITE = "acme-storefront";
const names = (p: ReturnType<typeof heuristicPlan>) => p.events.filter((e) => e.enabled).map((e) => e.name);

describe("tracking plan", () => {
  it("always records the automatic events and the funnel, and adds events for what the merchant said", () => {
    const plain = heuristicPlan({ site: SITE });
    expect(names(plain)).toEqual(["$pageview", "$autocapture", "$rageclick", "$pageleave", "agent_visit", "product_viewed", "product_added", "checkout_started", "order_completed"]);
    expect(plain.dashboards.map((d) => d.id)).toEqual(["kpis", "funnel", "sources", "humans-agents", "heatmap", "experiments", "revenue"]);

    const shoes = heuristicPlan({ site: SITE, prompt: "We sell trail running shoes; checkout feels slow on mobile and people ask about sizing", repo: "acme/storefront", framework: "Next.js (App Router)", whop: "Acme" });
    expect(names(shoes)).toEqual(expect.arrayContaining(["checkout_step_viewed", "checkout_error", "size_guide_opened", "size_selected", "whop_payment", "order_refunded"]));
    expect(shoes.events.find((e) => e.name === "checkout_error")).toMatchObject({ fromPrompt: true, snippet: 'window.darwin?.capture("checkout_error", { step: …, message: … });' });
    expect(shoes.dashboards.map((d) => d.id)).toEqual(expect.arrayContaining(["checkout", "devices", "goals"]));
    expect(shoes.dashboards.find((d) => d.id === "checkout")?.events).toEqual(["checkout_started", "checkout_step_viewed", "order_completed"]);
    expect(shoes.goals).toEqual(["checkout", "mobile", "sizing"]);
    expect(planIntro(shoes)).toMatch(/^I read acme\/storefront \(Next\.js \(App Router\)\)\. You mentioned checkout, mobile and sizing, so I added checkout step viewed, .* and a mobile vs desktop dashboard\. Here's the plan: 7 things/);
  });

  it("spots analytics the store already runs and says darwin.js runs alongside", async () => {
    const pkg = JSON.stringify({ dependencies: { next: "16.0.0", "posthog-js": "^1", "@vercel/analytics": "^1" } });
    const layout = `<Script src="https://www.googletagmanager.com/gtag/js?id=G-1" />`;
    expect(detectAnalytics([pkg, layout, undefined])).toEqual(["PostHog", "Vercel Analytics", "Google Analytics"]);
    expect(detectAnalytics([`<script src="https://darwin.example/darwin.js" data-darwin-site="x">`])).toEqual(["Darwin (already installed)"]);

    const plan = await buildPlan({ site: SITE, repo: "acme/storefront", analytics: ["PostHog", "Google Analytics"] }); // no LLM in tests
    expect(plan).toMatchObject({ existingAnalytics: ["PostHog", "Google Analytics"], author: "heuristic" });
    expect(planIntro(plan)).toContain("You already use PostHog and Google Analytics: darwin.js runs alongside, nothing is replaced.");
    expect(planIntro(heuristicPlan({ site: SITE, analytics: ["Darwin (already installed)"] }))).toContain("darwin.js is already installed, so the pull request only adds the plan.");
    const unread = heuristicPlan({ site: SITE, repo: "acme/storefront", framework: "Next.js (App Router)", analytics: [], repoRead: false });
    expect(unread.existingAnalytics).toBeUndefined();
    expect(planIntro(unread)).toMatch(/^I couldn't read acme\/storefront yet, so I assumed Next\.js \(App Router\)\. /);
  });

  it("changes with the merchant's chat: add, re-add and turn off events", () => {
    let plan = heuristicPlan({ site: SITE });
    let out = heuristicAmend(plan, "Also track wishlist adds");
    expect(out.reply).toMatch(/Added wishlist_adds/);
    plan = out.plan;
    expect(plan.events.find((e) => e.name === "wishlist_adds")).toMatchObject({ enabled: true, fromPrompt: true, category: "goal" });
    expect(plan.dashboards.find((d) => d.id === "goals")?.events).toEqual(["wishlist_adds"]);

    out = heuristicAmend(plan, "don't track rage clicks");
    expect(out.reply).toBe("Done: I won't record rage clicks.");
    expect(out.plan.events.find((e) => e.name === "$rageclick")?.enabled).toBe(false);

    out = heuristicAmend(out.plan, "track rage clicks");
    expect(out.plan.events.find((e) => e.name === "$rageclick")?.enabled).toBe(true);

    const noClicks = applyToggles(plan, { $autocapture: false, order_completed: false });
    expect(noClicks.dashboards.some((d) => d.kind === "heatmap")).toBe(false);
    expect(noClicks.dashboards.find((d) => d.id === "funnel")?.events).toEqual(["$pageview", "product_viewed", "product_added", "checkout_started"]);
  });

  it("writes the plan into the install PR: a doc with one line per event, and a body summary", () => {
    const plan = heuristicPlan({ site: SITE, prompt: "newsletter sign-ups matter", framework: "Next.js (App Router)" });
    const doc = trackingDoc(plan);
    expect(doc).toContain("Site id: `acme-storefront` · Next.js (App Router)");
    expect(doc).toContain('window.darwin?.capture("newsletter_signup", { placement: … });');
    expect(doc).toContain("| `order_completed` |");
    expect(trackingSummary(plan)).toMatch(/Your store sends \(one line each\):\*\* `product_viewed`.*`newsletter_signup`/);
  });
});

describe("dashboards", () => {
  it("builds every dashboard in the plan from the site's live events, and labels simulated data", () => {
    const plan = savePlan(heuristicPlan({ site: SITE, prompt: "checkout on mobile" }));
    const empty = computeDashboards(SITE, getPlan(SITE), eventStore().all());
    expect(empty.dashboards.every((d) => d.empty)).toBe(true);

    simulateWebTraffic({ site: SITE, visitors: 800, rules: [], url: "https://acme.example/", seed: 4 });
    track([
      { event: "$pageview", distinct_id: "v_agent", properties: { darwin_site: SITE, visitor_kind: "agent", synthetic: false } },
      { event: "checkout_error", distinct_id: "v_1", properties: { darwin_site: SITE, step: 2, synthetic: false } },
      { event: "$pageview", distinct_id: "v_preview", properties: { darwin_site: SITE, $current_url: "https://acme.example/?darwin_source=ai", synthetic: false } },
    ]);
    const res = computeDashboards(SITE, plan, eventStore().all());
    const by = Object.fromEntries(res.dashboards.map((d) => [d.id, d]));
    expect(by.kpis.kpis?.find((k) => k.label === "Visitors")?.value).toBe("801");
    expect(by.funnel.steps?.[0]).toMatchObject({ event: "$pageview", label: "Visited", visitors: 801, rate: 1 });
    expect(by.funnel.steps?.at(-1)?.event).toBe("order_completed");
    expect(by.sources.rows?.length).toBeGreaterThan(3);
    expect(by["humans-agents"].rows?.find((r) => r.key === "AI agents")?.visitors).toBeGreaterThan(1); // simulated agents + v_agent
    const mobile = by.devices.rows?.find((r) => r.key === "Mobile");
    expect(mobile?.visitors).toBeGreaterThan(by.devices.rows?.find((r) => r.key === "Desktop")?.visitors ?? 0);
    expect(by.goals.series?.find((s) => s.name === "checkout_error")?.total).toBe(1);
    expect(by.revenue.series?.[0].total).toBeGreaterThan(0);
    expect(res.seen.agent_visit).toBeGreaterThan(1);
    expect(res.seen.$pageleave).toBeGreaterThan(0);
    expect(by.heatmap.empty).toBe(false); // no page to read: simulated shoppers click typical elements
    expect(res.syntheticEvents).toBeGreaterThan(0);
    expect(res.totalEvents - res.syntheticEvents).toBe(2); // the preview visit doesn't count
  });
});
