import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import fixtureFile from "./__fixtures__/posthog-js-1.434.14.json";
import {
  IngestError,
  decodeBody,
  decodeQueryData,
  extractEvents,
  flagsResponse,
  mapPosthogEvents,
  remoteConfigScript,
  resolveTimestamp,
} from "./ingest";
import { classifyVisitor } from "./classify";

const HUMAN = { kind: "human" } as const;
const NOW = Date.parse("2026-09-26T10:00:00.000Z");

/** posthog-js's own base64 encoder (browser-common/src/utils/encode-utils.ts). */
const phBase64 = (s: string) =>
  btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));

const enc = (s: string) => new TextEncoder().encode(s);

describe("decodeBody: real posthog-js 1.434.14 payloads", () => {
  const fixtures = fixtureFile.fixtures.map((f) => ({
    ...f,
    body: new Uint8Array(Buffer.from(f.bodyBase64, "base64")),
    compression: new URLSearchParams(f.search).get("compression"),
  }));

  it.each(fixtures)("$name", (f) => {
    const payload = decodeBody(f.body, { compression: f.compression, contentType: f.contentType });
    const { events, sentAt, apiKey } = extractEvents(payload);
    expect(events.length).toBeGreaterThan(0);
    expect(sentAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(apiKey).toMatch(/^phc_/);
    const mapped = mapPosthogEvents(events, { request: classifyVisitor({ userAgent: f.userAgent }), sentAt, now: NOW });
    expect(mapped).toHaveLength(events.length);
    for (const e of mapped) {
      expect(e.distinct_id).toMatch(/^v_/); // bootstrapped distinct id, from properties.distinct_id
      expect(e.uuid).toMatch(/^[0-9a-f-]{36}$/); // posthog's uuidv7 kept
      expect(Date.parse(e.timestamp!)).toBeLessThanOrEqual(NOW);
      expect(e.properties.$lib).toBe("web"); // PostHog $ props kept
      expect(e.properties.visitor_kind).toMatch(/^(human|agent)$/);
    }
  });

  it("gzip batch from a real browser: autocapture + rageclick with attribution super props, human", () => {
    const f = fixtures.find((x) => x.name.startsWith("gzip: autocapture"))!;
    expect(f.body[0]).toBe(0x1f); // really gzip on the wire
    const { events, sentAt } = extractEvents(decodeBody(f.body, { compression: f.compression, contentType: f.contentType }));
    const mapped = mapPosthogEvents(events, { request: classifyVisitor({ userAgent: f.userAgent }), sentAt, now: NOW });
    expect(mapped.map((e) => e.event)).toContain("$rageclick");
    const rage = mapped.find((e) => e.event === "$rageclick")!;
    expect(rage.properties).toMatchObject({
      visitor_kind: "human",
      experiment_id: "exp_e2e",
      variant: "treatment",
      spec_version: 3,
      $browser_type: "browser",
    });
    expect(String(rage.properties.$elements_chain)).toContain('attr__id="dead"');
  });

  it("base64 sendBeacon form body from headless Chromium is classified as an agent", () => {
    const f = fixtures.find((x) => x.name.startsWith("base64"))!;
    expect(f.contentType).toBe("application/x-www-form-urlencoded");
    expect(new TextDecoder().decode(f.body.slice(0, 5))).toBe("data=");
    const { events, sentAt } = extractEvents(decodeBody(f.body, { compression: f.compression, contentType: f.contentType }));
    const mapped = mapPosthogEvents(events, { request: classifyVisitor({ userAgent: f.userAgent }), sentAt, now: NOW });
    expect(mapped.map((e) => e.event)).toEqual(["shipping_cost_revealed", "shipping_cost_revealed", "$pageleave"]);
    expect(mapped[0].properties).toMatchObject({ visitor_kind: "agent", agent_name: "HeadlessChrome", agent_category: "automation", shipping: 495 });
  });
});

describe("decodeBody: encodings and shapes", () => {
  const batch = {
    api_key: "phc_test",
    sent_at: "2026-09-26T09:59:59.000Z",
    batch: [{ event: "product_viewed", properties: { distinct_id: "v_1", product_id: "p_aurora", note: "£ ünïcode ✓ +/=" } }],
  };

  it("plain JSON (application/json and text/plain)", () => {
    expect(decodeBody(enc(JSON.stringify(batch)), { contentType: "application/json" })).toEqual(batch);
    expect(decodeBody(enc(JSON.stringify(batch)), { contentType: "text/plain" })).toEqual(batch);
  });

  it("gzip-js, detected by magic bytes regardless of headers/params", () => {
    const gz = new Uint8Array(gzipSync(JSON.stringify(batch)));
    expect(decodeBody(gz, { compression: "gzip-js", contentType: "text/plain" })).toEqual(batch);
    expect(decodeBody(gz, {})).toEqual(batch); // posthog-node: Content-Encoding header only
  });

  it("base64 form body with non-ASCII (the posthog-js encoder)", () => {
    const body = "data=" + encodeURIComponent(phBase64(JSON.stringify(batch)));
    expect(decodeBody(enc(body), { compression: "base64", contentType: "application/x-www-form-urlencoded" })).toEqual(batch);
    // Some proxies re-encode '+' as a space; base64 never contains spaces.
    const spaced = "data=" + phBase64(JSON.stringify(batch)).replace(/\+/g, " ");
    expect(decodeBody(enc(spaced), { compression: "base64" })).toEqual(batch);
  });

  it("legacy form body with urlencoded JSON, and bare base64", () => {
    expect(decodeBody(enc("data=" + encodeURIComponent(JSON.stringify(batch))), {})).toEqual(batch);
    expect(decodeBody(enc(phBase64(JSON.stringify(batch))), { compression: "base64" })).toEqual(batch);
  });

  it("GET ?data= pixel", () => {
    expect(decodeQueryData(phBase64(JSON.stringify(batch)), null)).toEqual(batch);
    expect(decodeQueryData(null, null)).toBeUndefined();
  });

  it("rejects garbage with IngestError (400)", () => {
    expect(() => decodeBody(enc("{nope"), {})).toThrow(IngestError);
    expect(() => decodeBody(new Uint8Array([0x1f, 0x8b, 1, 2]), {})).toThrow(/gzip/);
    expect(() => decodeBody(enc("abc"), { compression: "lz64" })).toThrow(/lz64/);
    expect(() => decodeBody(enc("x=1"), { contentType: "application/x-www-form-urlencoded" })).toThrow(/data field/);
    expect(decodeBody(new Uint8Array(), {})).toBeUndefined();
  });

  it("extractEvents handles {batch}, arrays, single events and junk", () => {
    expect(extractEvents(batch).events).toHaveLength(1);
    expect(extractEvents([{ event: "a" }, { event: "b" }, 3]).events).toHaveLength(2);
    expect(extractEvents({ event: "solo", properties: {} }).events).toHaveLength(1);
    expect(extractEvents({ data: [{ event: "x" }] }).events).toHaveLength(1);
    expect(extractEvents("nope").events).toHaveLength(0);
    expect(extractEvents(undefined).events).toHaveLength(0);
  });
});

describe("mapPosthogEvents", () => {
  it("prefers top-level distinct_id (posthog-node), merges $set, drops recordings/heatmaps", () => {
    const out = mapPosthogEvents(
      [
        { event: "agent_request", distinct_id: 42, properties: { tool: "get_product" }, $set: { plan: "pro" } },
        { event: "$snapshot", properties: { distinct_id: "x", $snapshot_data: [] } },
        { event: "$$heatmap", properties: { distinct_id: "x" } },
        { event: "", properties: {} },
        { properties: { distinct_id: "no-event" } },
        { event: "anon" },
      ],
      { request: HUMAN, now: NOW },
    );
    expect(out.map((e) => e.event)).toEqual(["agent_request", "anon"]);
    expect(out[0].distinct_id).toBe("42");
    expect(out[0].properties.$set).toEqual({ plan: "pro" });
    expect(out[1].distinct_id).toBe("anonymous");
    expect(out[1].timestamp).toBe(new Date(NOW).toISOString());
  });

  it("server-side classification: agent claims are believed, human claims are verified", () => {
    const [claimsAgent] = mapPosthogEvents([{ event: "e", properties: { distinct_id: "a", visitor_kind: "agent", agent_name: "grok-shopper" } }], { request: HUMAN, now: NOW });
    expect(claimsAgent.properties).toMatchObject({ visitor_kind: "agent", agent_name: "grok-shopper", agent_category: "declared" });

    const [claimsHuman] = mapPosthogEvents([{ event: "e", properties: { distinct_id: "b", visitor_kind: "human" } }], {
      request: classifyVisitor({ userAgent: "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" }),
      now: NOW,
    });
    expect(claimsHuman.properties).toMatchObject({ visitor_kind: "agent", agent_name: "GPTBot", agent_category: "ai_crawler" });

    const [webdriver] = mapPosthogEvents([{ event: "e", properties: { distinct_id: "c", $browser_type: "bot" } }], { request: HUMAN, now: NOW });
    expect(webdriver.properties).toMatchObject({ visitor_kind: "agent", agent_category: "automation" });

    const [serverSide] = mapPosthogEvents(
      [{ event: "e", distinct_id: "d", properties: { $raw_user_agent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0)" } }],
      { request: classifyVisitor({ userAgent: "posthog-node/5.0.0" }), now: NOW },
    );
    expect(serverSide.properties).toMatchObject({ visitor_kind: "agent", agent_name: "ClaudeBot" });

    const [human] = mapPosthogEvents([{ event: "e", properties: { distinct_id: "h", agent_name: "spoof" } }], { request: HUMAN, userAgent: "UA", now: NOW });
    expect(human.properties.visitor_kind).toBe("human");
    expect(human.properties.agent_name).toBeUndefined();
    expect(human.properties.$user_agent).toBe("UA");
  });

  it("corrects client clock skew like PostHog (now - (sent_at - timestamp)) and never goes into the future", () => {
    // Client clock is 1h fast; the event happened 2s before sending.
    expect(resolveTimestamp({ timestamp: "2026-09-26T11:00:00.000Z" }, "2026-09-26T11:00:02.000Z", NOW)).toBe("2026-09-26T09:59:58.000Z");
    expect(resolveTimestamp({ offset: 1500 }, undefined, NOW)).toBe("2026-09-26T09:59:58.500Z");
    expect(resolveTimestamp({ timestamp: "2026-09-26T09:00:00.000Z" }, undefined, NOW)).toBe("2026-09-26T09:00:00.000Z");
    expect(resolveTimestamp({ timestamp: "2027-01-01T00:00:00.000Z" }, undefined, NOW)).toBe(new Date(NOW).toISOString());
    expect(resolveTimestamp({ timestamp: "garbage" }, undefined, NOW)).toBe(new Date(NOW).toISOString());
  });
});

describe("SDK responses", () => {
  it("flags/decide keep autocapture on, recordings off, no flags", () => {
    const r = flagsResponse("phc_t");
    expect(r).toMatchObject({ flags: {}, featureFlags: {}, errorsWhileComputingFlags: false, autocapture_opt_out: false, sessionRecording: false });
    expect(r.supportedCompression).toContain("gzip-js");
    expect(flagsResponse("phc_t", true).config).toEqual({ enable_collect_everything: true });
  });

  it("config.js defines window._POSTHOG_REMOTE_CONFIG[token] like PostHog's server", () => {
    const window: Record<string, unknown> = {};
    vm.runInNewContext(remoteConfigScript('phc_"quoted"'), { window });
    const cfg = (window._POSTHOG_REMOTE_CONFIG as Record<string, { config: { autocapture_opt_out: boolean } }>)['phc_"quoted"'];
    expect(cfg.config.autocapture_opt_out).toBe(false);
  });
});
