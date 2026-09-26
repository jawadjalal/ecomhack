import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";

const llm = vi.hoisted(() => ({ available: false, reply: undefined as unknown, fail: false }));
vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.available,
  llmLabel: () => (llm.available ? "llm:grok-test" : "heuristic"),
  generateJson: async ({ schema }: { schema: { parse: (v: unknown) => unknown } }) => {
    if (llm.fail) throw new Error("rate limited");
    return schema.parse(llm.reply);
  },
}));

import { computeTrafficReport, heuristicInsights, llmInsights } from "@/lib/traffic";

let n = 0;
function visitor(i: number, url: string, referrer: string | undefined, ordered: boolean, extra: Record<string, unknown> = {}): AnalyticsEvent[] {
  const id = `v${i}`;
  const base = { visitor_kind: "human" as const, $current_url: url, $referrer: referrer, $pathname: "/store", ...extra };
  const out: AnalyticsEvent[] = [{ uuid: `u${n++}`, event: "$pageview", distinct_id: id, timestamp: new Date(1e12 + n).toISOString(), properties: base }];
  if (ordered) out.push({ uuid: `u${n++}`, event: "order_completed", distinct_id: id, timestamp: new Date(1e12 + n).toISOString(), properties: { ...base, revenue: 10000 } });
  return out;
}

/** 100 direct visitors (20% buy), 100 from Instagram (2% buy), 40 from Google ads for "trail shoes" (25% buy). */
function events(): AnalyticsEvent[] {
  const ev: AnalyticsEvent[] = [];
  for (let i = 0; i < 100; i++) ev.push(...visitor(i, "https://s.test/store", undefined, i % 5 === 0));
  for (let i = 100; i < 200; i++) ev.push(...visitor(i, "https://s.test/store", "https://l.instagram.com/", i % 50 === 0));
  for (let i = 200; i < 240; i++) ev.push(...visitor(i, "https://s.test/store?utm_source=google&utm_medium=cpc&utm_term=trail+shoes", "https://www.google.com/", i % 4 === 0));
  return ev;
}

beforeEach(() => {
  llm.available = false;
  llm.fail = false;
  llm.reply = undefined;
});

describe("heuristicInsights", () => {
  it("flags the under-converting channel with its numbers, prize and a test to run", () => {
    const out = heuristicInsights(computeTrafficReport(events()));
    const social = out.find((i) => i.id === "gap-source-social");
    expect(social).toBeDefined();
    expect(social!.evidence).toContain("100 visitors");
    expect(social!.impact!.orders).toBeGreaterThan(5);
    expect(social!.testPrompt).toMatch(/Instagram/);
  });

  it("spots a money keyword and keeps a mix of categories", () => {
    const out = heuristicInsights(computeTrafficReport(events()));
    expect(out.some((i) => i.id === "seo-query-win-trail shoes")).toBe(true);
    expect(new Set(out.map((i) => i.category)).size).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("asks for more traffic instead of guessing on tiny samples", () => {
    const out = heuristicInsights(computeTrafficReport(events().slice(0, 4)));
    expect(out.map((i) => i.id)).toEqual(["need-traffic"]);
  });
});

describe("llmInsights", () => {
  it("falls back to the rules without a key", async () => {
    const res = await llmInsights(computeTrafficReport(events()));
    expect(res.source).toBe("heuristic");
    expect(res.note).toMatch(/No LLM key/);
  });

  it("uses the model's wording but keeps computed impact from the rule it builds on", async () => {
    llm.available = true;
    llm.reply = {
      insights: [
        { category: "conversion", title: "Instagram visitors bounce", evidence: "100 visitors, 2.0% ordered", action: "Add reviews by the button", basedOn: "gap-source-social" },
        { category: "seo", title: "Write a trail-shoe guide", evidence: "40 searched trail shoes, 25% ordered", action: "Publish a guide" },
      ],
    };
    const report = computeTrafficReport(events());
    const res = await llmInsights(report);
    expect(res.source).toBe("llm");
    expect(res.author).toBe("llm:grok-test");
    expect(res.insights[0].title).toBe("Instagram visitors bounce");
    expect(res.insights[0].impact).toEqual(heuristicInsights(report).find((i) => i.id === "gap-source-social")!.impact);
    expect(res.insights[1].impact).toBeUndefined(); // never taken from the model
  });

  it("falls back to the rules when the model fails", async () => {
    llm.available = true;
    llm.fail = true;
    const res = await llmInsights(computeTrafficReport(events()));
    expect(res.source).toBe("heuristic");
    expect(res.note).toMatch(/rate limited/);
  });
});
