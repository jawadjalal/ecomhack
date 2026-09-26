import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";
import {
  clearTrafficReports,
  computeTrafficReport,
  computeTrafficReportAsync,
  countryFromHeaders,
  NOT_PROVIDED,
  referrerName,
  sharedTrafficReport,
  TRAFFIC_REPORT_TTL_MS,
  withGeo,
} from "@/lib/traffic";

let n = 0;
const ev = (distinct_id: string, event: string, properties: Record<string, unknown>): AnalyticsEvent => ({
  uuid: `u${n++}`,
  event,
  distinct_id,
  timestamp: new Date(1_700_000_000_000 + n).toISOString(),
  properties,
});
const view = (id: string, url: string, referrer?: string, extra: Record<string, unknown> = {}) =>
  ev(id, "$pageview", { visitor_kind: "human", $current_url: url, $pathname: new URL(url).pathname, $referrer: referrer, ...extra });

describe("traffic report", () => {
  const events = [
    view("a", "https://shop.test/store?utm_source=twitter&utm_medium=social&utm_campaign=drop", "https://t.co/abc", { $geo_country: "GB" }),
    ev("a", "order_completed", { visitor_kind: "human", revenue: 11500 }),
    view("b", "https://shop.test/store", "https://www.google.com/", { $geo_country: "US" }),
    view("c", "https://shop.test/store?utm_source=google&utm_medium=cpc&utm_term=Trail+Shoes", "https://www.google.co.uk/"),
    view("d", "https://shop.test/store/products/x", "https://www.youtube.com/watch?v=1", { synthetic: true }),
    ev("e", "agent_request", { visitor_kind: "agent", tool: "search_products" }),
    view("f", "https://shop.test/store?darwin_variant=control", undefined), // console preview: ignored
  ];

  it("counts visitors, conversions, revenue and humans vs agents", () => {
    const r = computeTrafficReport(events);
    expect(r.totals).toMatchObject({ visitors: 5, humans: 4, agents: 1, conversions: 1, revenue: 11500, synthetic: 1, countries: 3 }); // GB, US + the simulated visitor's
  });

  it("names referrers and never invents an organic search term", () => {
    const r = computeTrafficReport(events);
    const refs = r.dimensions.referrer.map((x) => x.label);
    expect(refs).toEqual(expect.arrayContaining(["X (Twitter)", "Google", "YouTube", "Agent API (MCP / A2A)"]));
    expect(r.dimensions.referrer.find((x) => x.label === "Google")?.visitors).toBe(2); // google.com + google.co.uk
    const queries = Object.fromEntries(r.dimensions.query.map((q) => [q.key, q.visitors]));
    expect(queries).toEqual({ [NOT_PROVIDED]: 1, "trail shoes": 1 });
    expect(r.totals.notProvided).toBe(1);
    expect(r.dimensions.campaign.map((c) => c.label)).toEqual(expect.arrayContaining(["twitter / social / drop", "google / cpc"]));
  });

  it("can leave simulated visitors out", () => {
    expect(computeTrafficReport(events, { includeSynthetic: false }).totals.visitors).toBe(4);
  });

  it("filters by site", () => {
    const ext = view("z", "https://other.test/", undefined, { darwin_site: "other" });
    const r = computeTrafficReport([...events, ext], { site: "other" });
    expect(r.totals.visitors).toBe(1);
    expect(r.sites).toEqual(["other", "pace-store"]);
  });
});

describe("traffic report: shared and memoised", () => {
  const events = [
    view("a", "https://shop.test/store", "https://www.google.com/"),
    ev("a", "order_completed", { visitor_kind: "human", revenue: 11500 }),
    view("b", "https://shop.test/store/products/x", "https://chatgpt.com/", { synthetic: true }),
    ev("c", "agent_request", { visitor_kind: "agent", tool: "search_products" }),
    view("d", "https://other.test/", undefined, { darwin_site: "other" }),
  ];
  /** The events, counting how many reports were built from them (each build snapshots once). */
  const counted = () => {
    const arr = [...events] as AnalyticsEvent[] & { builds: number };
    arr.builds = 0;
    arr.slice = function (this: AnalyticsEvent[], ...args: [number?, number?]) {
      arr.builds++;
      return Array.prototype.slice.apply(this, args);
    };
    return arr;
  };
  afterEach(() => {
    clearTrafficReports();
    vi.restoreAllMocks();
  });

  it("builds the same report as the synchronous pass, in chunks", async () => {
    const now = new Date(1_700_000_000_000);
    expect(await computeTrafficReportAsync(events, { now }, 2)).toEqual(computeTrafficReport(events, { now }));
    expect(await computeTrafficReportAsync(events, { site: "other", now }, 1)).toEqual(computeTrafficReport(events, { site: "other", now }));
  });

  it("computes once for concurrent callers and reuses the result for a few seconds", async () => {
    const store = counted();
    const [a, b] = await Promise.all([sharedTrafficReport(store, { site: "all" }), sharedTrafficReport(store, {})]);
    expect(store.builds).toBe(1);
    expect(a).toBe(b);
    expect(a.totals.visitors).toBe(4);

    // Within the TTL: same report, no new pass.
    expect(await sharedTrafficReport(store)).toBe(a);
    expect(store.builds).toBe(1);

    // A different query is its own report.
    expect((await sharedTrafficReport(store, { includeSynthetic: false })).totals.visitors).toBe(3);
    expect(store.builds).toBe(2);

    // After the TTL: rebuilt.
    const later = Date.now() + TRAFFIC_REPORT_TTL_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(await sharedTrafficReport(store)).not.toBe(a);
    expect(store.builds).toBe(3);
  });

  it("rebuilds when the store was reset (a new events array)", async () => {
    const first = counted();
    await sharedTrafficReport(first);
    const second = counted();
    const r = await sharedTrafficReport(second.slice(0, 2));
    expect(r.totals.visitors).toBe(1);
  });
});

describe("geo + referrers", () => {
  it("reads the edge country header and drops client-claimed countries", () => {
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "gb" }))).toBe("GB");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeUndefined();
    const claimed = [{ event: "$pageview", distinct_id: "a", properties: { $geo_country: "FR" } }];
    expect(withGeo(claimed, new Headers()).at(0)?.properties.$geo_country).toBeUndefined();
    expect(withGeo(claimed, new Headers({ "x-vercel-ip-country": "DE" })).at(0)?.properties.$geo_country).toBe("DE");
  });

  it("maps hosts to names", () => {
    expect(referrerName("l.instagram.com")).toBe("Instagram");
    expect(referrerName("chatgpt.com")).toBe("ChatGPT");
    expect(referrerName("google.co.uk")).toBe("Google");
    expect(referrerName("runnersworld.com")).toBe("runnersworld.com");
  });
});
