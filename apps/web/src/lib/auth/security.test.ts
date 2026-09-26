import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isAdminCredential, isProtectedPath } from "./admin";
import { allowIngest, MAX_EVENTS_PER_MINUTE, resetIngestRate, sanitizeClientEvents } from "@/lib/analytics/trust";
import { eventStore, MAX_EVENT_BYTES, track } from "@/lib/analytics/store";
import { POST as mcp } from "@/app/api/mcp/route";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  resetIngestRate();
});

describe("admin gate", () => {
  it("protects mission control and state-changing APIs, not the store or agent tools", () => {
    for (const p of ["/console", "/api/loop/reset", "/api/github/connect", "/api/simulate", "/api/agent/shop", "/api/agent/sessions", "/api/analytics/events"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
    for (const p of ["/store", "/api/agent/products", "/api/mcp", "/api/a2a", "/api/capture", "/ingest/e", "/llms.txt", "/api/consolex"]) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });

  it("is open locally without a token, locked on Vercel, and token-checked when set", () => {
    delete process.env.DARWIN_ADMIN_TOKEN;
    expect(isAdminCredential(undefined)).toBe(true);
    process.env.VERCEL = "1";
    expect(isAdminCredential(undefined)).toBe(false);
    process.env.DARWIN_ADMIN_TOKEN = "s3cret";
    expect(isAdminCredential("s3cret")).toBe(true);
    expect(isAdminCredential("s3cre")).toBe(false);
    expect(isAdminCredential(undefined)).toBe(false);
  });

  it("rejects unauthenticated API calls, signs in via /console?key= and accepts the cookie or a bearer token", () => {
    process.env.DARWIN_ADMIN_TOKEN = "s3cret";
    const reset = proxy(new NextRequest("https://darwin.example/api/loop/reset", { method: "POST" }));
    expect(reset.status).toBe(401);

    expect(proxy(new NextRequest("https://darwin.example/console")).status).toBe(401);
    expect(proxy(new NextRequest("https://darwin.example/console?key=nope")).status).toBe(401);
    const login = proxy(new NextRequest("https://darwin.example/console?key=s3cret&mock=1"));
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe("https://darwin.example/console?mock=1");
    expect(login.cookies.get("darwin_admin")).toMatchObject({ value: "s3cret", httpOnly: true, secure: true });

    const withCookie = proxy(new NextRequest("https://darwin.example/api/loop/step", { method: "POST", headers: { cookie: "darwin_admin=s3cret" } }));
    expect(withCookie.headers.get("x-middleware-next")).toBe("1");
    const withBearer = proxy(new NextRequest("https://darwin.example/api/github/status", { headers: { authorization: "Bearer s3cret" } }));
    expect(withBearer.headers.get("x-middleware-next")).toBe("1");

    // The store stays public and still gets a visitor id.
    expect(proxy(new NextRequest("https://darwin.example/store")).cookies.get("darwin_id")?.value).toMatch(/^v_/);
  });
});

describe("untrusted events", () => {
  it("drops client claims about synthetic traffic and experiment arms", () => {
    const [storefront] = sanitizeClientEvents(
      [{ event: "order_completed", distinct_id: "v_1", properties: { revenue: 100, synthetic: true, experiment_id: "exp_x", variant: "treatment", spec_version: 9 } }],
      "storefront",
    );
    expect(storefront.properties).toMatchObject({ revenue: 100, synthetic: false });
    expect(storefront.properties?.experiment_id).toBeUndefined();
    expect(storefront.properties?.variant).toBeUndefined();
    expect(storefront.properties?.spec_version).toBe(0); // re-derived: the live Gen 0 spec

    const [external] = sanitizeClientEvents([{ event: "x", distinct_id: "v_2", properties: { variant: "treatment", spec_version: 3 } }], "external");
    expect(external.properties).toEqual({ synthetic: false });
  });

  it("rate-limits events per client IP", () => {
    const req = new Request("http://x/api/capture", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(allowIngest(req, MAX_EVENTS_PER_MINUTE)).toBe(true);
    expect(allowIngest(req, 1)).toBe(false);
    expect(allowIngest(new Request("http://x", { headers: { "x-forwarded-for": "198.51.100.1" } }), 1)).toBe(true);
    expect(allowIngest(req, 1, Date.now() + 61_000)).toBe(true);
  });

  it("drops oversized events", () => {
    eventStore().clear();
    const stored = track([
      { event: "ok", distinct_id: "a", properties: {} },
      { event: "huge", distinct_id: "b", properties: { blob: "x".repeat(MAX_EVENT_BYTES) } },
    ]);
    expect(stored.map((e) => e.event)).toEqual(["ok"]);
  });

  it("caps MCP batches", async () => {
    const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    const res = await mcp(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify(batch), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/batch too large/);
  });
});

beforeEach(() => {
  delete process.env.DARWIN_ADMIN_TOKEN;
  delete process.env.VERCEL;
});
