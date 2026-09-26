/**
 * Route-level tests: /ingest/[...path], /api/analytics/summary, /api/analytics/events.
 * (Kept next to the analytics code; the routes themselves are thin.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import vm from "node:vm";
import fixtureFile from "./__fixtures__/posthog-js-1.434.14.json";
import { eventStore } from "./store";
import * as ingest from "@/app/ingest/[...path]/route";
import * as summaryRoute from "@/app/api/analytics/summary/route";
import * as eventsRoute from "@/app/api/analytics/events/route";
import type { AnalyticsEventsResponse, AnalyticsSummary } from "@/lib/contracts";

const BASE = "http://localhost:3000";
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

beforeEach(() => eventStore().clear());

describe("/ingest", () => {
  it("stores every event of a real posthog-js payload (all encodings), classified server-side", async () => {
    for (const f of fixtureFile.fixtures) {
      const req = new NextRequest(`${BASE}/ingest/${f.path}${f.search}`, {
        method: "POST",
        body: Buffer.from(f.bodyBase64, "base64"),
        headers: { "content-type": f.contentType, "user-agent": f.userAgent },
      });
      const res = await ingest.POST(req, ctx(f.path));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 1 });
    }
    const events = eventStore().all();
    expect(events.length).toBe(11);
    const kinds = new Set(events.map((e) => `${e.distinct_id}:${e.properties.visitor_kind}`));
    expect(kinds).toEqual(new Set(["v_e2e_visitor:human", "v_raw_visitor:agent"]));
  });

  it("dedupes SDK retries by uuid", async () => {
    const body = JSON.stringify({ batch: [{ event: "x", uuid: "0199aaaa-0000-7000-8000-000000000009", properties: { distinct_id: "d" } }] });
    for (let i = 0; i < 2; i++) await ingest.POST(new NextRequest(`${BASE}/ingest/batch`, { method: "POST", body }), ctx("batch"));
    expect(eventStore().all()).toHaveLength(1);
  });

  it("uses declared agent headers", async () => {
    const req = new NextRequest(`${BASE}/ingest/e`, {
      method: "POST",
      body: JSON.stringify([{ event: "agent_request", properties: { distinct_id: "a1", tool: "get_product" } }]),
      headers: { "x-agent-name": "grok-shopper" },
    });
    await ingest.POST(req, ctx("e"));
    expect(eventStore().all()[0].properties).toMatchObject({ visitor_kind: "agent", agent_name: "grok-shopper" });
  });

  it("400 on garbage, 404 on unknown paths, 200 for dropped replay", async () => {
    const bad = await ingest.POST(new NextRequest(`${BASE}/ingest/e`, { method: "POST", body: "{nope" }), ctx("e"));
    expect(bad.status).toBe(400);
    const unknown = await ingest.POST(new NextRequest(`${BASE}/ingest/zzz`, { method: "POST", body: "{}" }), ctx("zzz"));
    expect(unknown.status).toBe(404);
    const replay = await ingest.POST(new NextRequest(`${BASE}/ingest/s`, { method: "POST", body: "[]" }), ctx("s"));
    expect(replay.status).toBe(200);
    expect(eventStore().all()).toHaveLength(0);
  });

  it("flags / decide / remote config responses the SDK expects", async () => {
    const flags = await (await ingest.POST(new NextRequest(`${BASE}/ingest/flags?v=2`, { method: "POST", body: "{}" }), ctx("flags"))).json();
    expect(flags).toMatchObject({ flags: {}, featureFlags: {}, autocapture_opt_out: false, sessionRecording: false });
    const decide = await (await ingest.POST(new NextRequest(`${BASE}/ingest/decide?v=4`, { method: "POST", body: "{}" }), ctx("decide"))).json();
    expect(decide.config).toEqual({ enable_collect_everything: true });

    const js = await ingest.GET(new NextRequest(`${BASE}/ingest/array/phc_x/config.js`), ctx("array/phc_x/config.js"));
    expect(js.headers.get("content-type")).toContain("javascript");
    const window: Record<string, Record<string, unknown>> = {};
    vm.runInNewContext(await js.text(), { window });
    expect(window._POSTHOG_REMOTE_CONFIG.phc_x).toBeDefined();

    const json = await (await ingest.GET(new NextRequest(`${BASE}/ingest/array/phc_x/config`), ctx("array/phc_x/config"))).json();
    expect(json.supportedCompression).toEqual(["gzip-js", "base64"]);

    const pre = ingest.OPTIONS(new NextRequest(`${BASE}/ingest/e`, { method: "OPTIONS", headers: { origin: "https://shop.example" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://shop.example");
  });
});

describe("/api/analytics", () => {
  const seed = () =>
    eventStore().append(
      Array.from({ length: 5 }, (_, i) => ({
        event: i % 2 ? "agent_request" : "$pageview",
        distinct_id: `v${i}`,
        properties: { visitor_kind: i % 2 ? ("agent" as const) : ("human" as const), tool: "search_products" },
      })),
    );

  it("summary maps query params to the filter and validates them", async () => {
    seed();
    const res = await summaryRoute.GET(new NextRequest(`${BASE}/api/analytics/summary?visitorKind=agent&includeSynthetic=false`));
    const body = (await res.json()) as AnalyticsSummary;
    expect(body.filter).toEqual({ visitorKind: "agent", includeSynthetic: false });
    expect(body.overall.visitors).toBe(2);
    expect(body.agentTools[0]).toMatchObject({ tool: "search_products", calls: 2 });
    const bad = await summaryRoute.GET(new NextRequest(`${BASE}/api/analytics/summary?visitorKind=robot`));
    expect(bad.status).toBe(400);
    const bad2 = await summaryRoute.GET(new NextRequest(`${BASE}/api/analytics/summary?specVersion=abc`));
    expect(bad2.status).toBe(400);
  });

  it("events: newest last, cursor polling, filters", async () => {
    const stored = seed();
    const first = (await (await eventsRoute.GET(new NextRequest(`${BASE}/api/analytics/events?limit=3`))).json()) as AnalyticsEventsResponse;
    expect(first.events.map((e) => e.distinct_id)).toEqual(["v2", "v3", "v4"]);
    expect(first.cursor).toBe(stored[4].uuid);

    const empty = (await (await eventsRoute.GET(new NextRequest(`${BASE}/api/analytics/events?after=${first.cursor}`))).json()) as AnalyticsEventsResponse;
    expect(empty).toEqual({ events: [], cursor: first.cursor });

    eventStore().append([{ event: "order_completed", distinct_id: "v9", properties: { visitor_kind: "human", revenue: 100 } }]);
    const next = (await (await eventsRoute.GET(new NextRequest(`${BASE}/api/analytics/events?after=${first.cursor}`))).json()) as AnalyticsEventsResponse;
    expect(next.events.map((e) => e.event)).toEqual(["order_completed"]);

    const agents = (await (await eventsRoute.GET(new NextRequest(`${BASE}/api/analytics/events?visitorKind=agent`))).json()) as AnalyticsEventsResponse;
    expect(agents.events.map((e) => e.distinct_id)).toEqual(["v1", "v3"]);
    const excl = (await (await eventsRoute.GET(new NextRequest(`${BASE}/api/analytics/events?exclude=$pageview,order_completed`))).json()) as AnalyticsEventsResponse;
    expect(excl.events.every((e) => e.event === "agent_request")).toBe(true);
  });
});
