// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";
import type { Fetched } from "@/lib/readiness/checks";
import { findDarwinTag, normHost, realEventFrom, resetVerifyCache, storeUrl, verifyOwnership, type VerifyDeps } from "./verify";

const SITE = "eastfork-com";
const URL_ = storeUrl("www.eastfork.com")!;

let n = 0;
const ev = (props: Record<string, unknown>): AnalyticsEvent => ({
  uuid: `u${++n}`,
  event: "$pageview",
  distinct_id: "v_1",
  timestamp: "2026-09-26T14:00:00.000Z",
  properties: { visitor_kind: "human", ...props } as AnalyticsEvent["properties"],
});
const page = (body: string, status = 200): Fetched => ({ url: "https://www.eastfork.com/", status, headers: {}, body });
const TAG = `<script src="https://darwin.example/darwin.js" data-darwin-site="${SITE}" defer></script>`;

function deps(events: AnalyticsEvent[], fetched: Fetched | Error): VerifyDeps & { fetchPage: ReturnType<typeof vi.fn> } {
  return {
    events: () => events,
    fetchPage: vi.fn(async () => {
      if (fetched instanceof Error) throw fetched;
      return fetched;
    }),
  };
}

beforeEach(() => resetVerifyCache());

describe("verify ownership", () => {
  it("normalises hosts and store URLs", () => {
    expect(normHost("WWW.EastFork.com:443")).toBe("eastfork.com");
    expect(storeUrl("www.eastfork.com")?.href).toBe("https://www.eastfork.com/");
    expect(storeUrl("javascript:alert(1)")).toBeUndefined();
    expect(storeUrl("ftp://eastfork.com")).toBeUndefined();
    expect(storeUrl("localhost")).toBeUndefined();
  });

  it("is verified by a real darwin.js event from the claimed host (www-insensitive)", async () => {
    const d = deps([ev({ darwin_site: SITE, $current_url: "https://eastfork.com/products/mug" })], page(""));
    const r = await verifyOwnership(SITE, URL_, d);
    expect(r).toMatchObject({ verified: true, via: "events", host: "eastfork.com" });
    expect(Date.parse(r.checkedAt)).not.toBeNaN();
    expect(d.fetchPage).not.toHaveBeenCalled();
  });

  it("ignores simulated events, other sites and other hosts", () => {
    expect(realEventFrom(SITE, "eastfork.com", [ev({ darwin_site: SITE, $current_url: "https://www.eastfork.com/", synthetic: true })])).toBeUndefined();
    expect(realEventFrom(SITE, "eastfork.com", [ev({ darwin_site: "other", $current_url: "https://www.eastfork.com/" })])).toBeUndefined();
    expect(realEventFrom(SITE, "eastfork.com", [ev({ darwin_site: SITE, $current_url: "https://evil.example/" })])).toBeUndefined();
    expect(realEventFrom(SITE, "www.eastfork.com", [ev({ darwin_site: SITE, $host: "eastfork.com" })])).toBeDefined();
  });

  it("is verified by the darwin.js tag for the site on the homepage", async () => {
    const d = deps([ev({ darwin_site: SITE, $current_url: "https://www.eastfork.com/", synthetic: true })], page(`<html><head>${TAG}</head></html>`));
    const r = await verifyOwnership(SITE, URL_, d);
    expect(r).toMatchObject({ verified: true, via: "tag", host: "eastfork.com" });
    expect(d.fetchPage).toHaveBeenCalledWith("https://www.eastfork.com/");
  });

  it("finds the tag in its other forms, and not for a different site", () => {
    expect(findDarwinTag(`<script defer data-darwin-site='${SITE}' src="/darwin.js">`, SITE).found).toBe("match");
    expect(findDarwinTag(`<script src="https://x.dev/api/web/runtime.js?site=${SITE}" async>`, SITE).found).toBe("match");
    expect(findDarwinTag(`<script src="https://x.dev/darwin.js" data-darwin-site="${SITE}-2">`, SITE)).toEqual({ found: "other", sites: [`${SITE}-2`] });
    expect(findDarwinTag(`<p>data-darwin-site="${SITE}"</p><script src="/app.js">`, SITE).found).toBe("none");
  });

  it("says so plainly when the tag is for another site, missing, or the store can't be reached", async () => {
    const other = await verifyOwnership(SITE, URL_, deps([], page(TAG.replace(SITE, "someone-else"))));
    expect(other).toMatchObject({ verified: false });
    expect(other.detail).toContain("someone-else");
    resetVerifyCache();

    const missing = await verifyOwnership(SITE, URL_, deps([], page("<html></html>")));
    expect(missing).toMatchObject({ verified: false });
    expect(missing.detail).toMatch(/isn't on eastfork\.com's homepage/);
    resetVerifyCache();

    const down = await verifyOwnership(SITE, URL_, deps([], { url: "https://www.eastfork.com/", status: 0, headers: {}, body: "", error: "getaddrinfo ENOTFOUND www.eastfork.com" }));
    expect(down).toMatchObject({ verified: false, host: "eastfork.com" });
    expect(down.detail).toMatch(/^Couldn't reach eastfork\.com/);
    resetVerifyCache();

    const threw = await verifyOwnership(SITE, URL_, deps([], new Error("boom")));
    expect(threw.verified).toBe(false);
    resetVerifyCache();

    const blocked = await verifyOwnership(SITE, URL_, deps([], page("Forbidden", 403)));
    expect(blocked.detail).toContain("answered 403");
  });

  it("caches a result for ~10 s", async () => {
    let t = 1_000_000;
    const d = { ...deps([], page("<html></html>")), now: () => t };
    expect((await verifyOwnership(SITE, URL_, d)).verified).toBe(false);
    d.fetchPage.mockResolvedValue(page(TAG));
    t += 5_000;
    expect((await verifyOwnership(SITE, URL_, d)).verified).toBe(false); // cached
    t += 6_000;
    expect((await verifyOwnership(SITE, URL_, d)).verified).toBe(true);
    expect(d.fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/onboarding/verify", () => {
  it("validates input and reports unreachable stores as not verified", async () => {
    vi.resetModules();
    vi.doMock("@/lib/readiness/fetcher", () => ({
      safeFetch: async (url: string) => ({ url, status: 0, headers: {}, body: "", error: "timed out" }),
    }));
    const { GET } = await import("@/app/api/onboarding/verify/route");
    const call = (qs: string) => GET(new Request(`http://localhost/api/onboarding/verify?${qs}`));
    expect((await call("url=www.eastfork.com")).status).toBe(400);
    expect((await call(`site=${SITE}&url=javascript:alert(1)`)).status).toBe(400);
    const res = await call(`site=${SITE}&url=${encodeURIComponent("https://www.eastfork.com")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ verified: false, host: "eastfork.com" });
    expect(body.detail).toContain("timed out");
    vi.doUnmock("@/lib/readiness/fetcher");
  });
});
