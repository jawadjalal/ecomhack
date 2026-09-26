import { beforeEach, describe, expect, it } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { OPTIONS, POST } from "@/app/api/collect/route";
import { GET as trackerGET } from "@/app/darwin.js/route";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://darwin.example.com/api/collect", {
      method: "POST",
      headers: { "content-type": "text/plain", "user-agent": CHROME, origin: "https://shop.test", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const pageview = (props: Record<string, unknown> = {}) => ({
  event: "$pageview",
  distinct_id: "v_1",
  timestamp: new Date().toISOString(),
  properties: { $pathname: "/", darwin_site: "acme-storefront", ...props },
});

beforeEach(() => eventStore().clear());

describe("POST /api/collect", () => {
  it("stores events from darwin.js with CORS headers and server-side classification", async () => {
    const res = await post({ events: [pageview({ visitor_kind: "agent", agent_name: "spoofed" })] });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ ok: true, count: 1 });
    const [e] = eventStore().all();
    expect(e.properties).toMatchObject({ visitor_kind: "human", $lib: "darwin-js", $user_agent: CHROME, darwin_site: "acme-storefront" });
    expect(e.properties.agent_name).toBeUndefined();
  });

  it("classifies AI agents by user agent, declared header, or automated browser", async () => {
    await post({ events: [pageview()] }, { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)" });
    await post({ events: [pageview()] }, { "x-agent-name": "grok-shopper" });
    await post({ events: [pageview({ $webdriver: true })] });
    const kinds = eventStore()
      .all()
      .map((e) => [e.properties.visitor_kind, e.properties.agent_name]);
    expect(kinds).toEqual([
      ["agent", "GPTBot"],
      ["agent", "grok-shopper"],
      ["agent", "automated-browser"],
    ]);
  });

  it("accepts a bare array or single event and clamps bad timestamps", async () => {
    await post([pageview()]);
    await post({ ...pageview(), timestamp: "2099-01-01T00:00:00Z" });
    const all = eventStore().all();
    expect(all).toHaveLength(2);
    expect(Math.abs(Date.parse(all[1].timestamp) - Date.now())).toBeLessThan(60_000);
  });

  it("rejects invalid and oversized payloads", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ events: [] })).status).toBe(400);
    expect((await post({ events: [{ event: "", distinct_id: "x" }] })).status).toBe(400);
    expect((await post({ events: Array.from({ length: 201 }, () => pageview()) })).status).toBe(400);
    const huge = await post({ events: [pageview({ blob: "x".repeat(200_000) })] });
    expect(huge.status).toBe(413);
    expect(huge.headers.get("access-control-allow-origin")).toBe("*");
    expect(eventStore().all()).toHaveLength(0);
  });

  it("answers CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });
});

describe("GET /darwin.js", () => {
  it("serves the tracker as JavaScript with a short cache", async () => {
    const res = trackerGET();
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toMatch(/max-age=300/);
    expect(await res.text()).toContain("/api/collect");
  });
});
