// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Fetched } from "@/lib/readiness/checks";
import { detectPlatform, inspectStore, resetInspectCache } from "./inspect";
import { storeUrl } from "./verify";

const page = (body: string, status = 200, headers: Record<string, string> = {}): Fetched => ({ url: "https://www.eastfork.com/", status, headers, body });
const html = (head: string, title = "East Fork") => `<!doctype html><html><head><title>${title}</title>${head}</head><body></body></html>`;

beforeEach(() => resetInspectCache());

describe("detectPlatform (pure)", () => {
  it.each([
    ["shopify", `<link href="//cdn.shopify.com/s/files/1/theme.css"><script>Shopify.theme = {"name":"Dawn"};</script>`, ["cdn.shopify.com", "Shopify.theme"]],
    ["webflow", `<html data-wf-site="64f0"><script src="https://assets.website-files.com/js/webflow.4b3c.js">`, ["data-wf-site", "webflow.js"]],
    ["wordpress", `<link rel="stylesheet" href="/wp-content/themes/x/style.css"><link rel="https://api.w.org/" href="https://x.com/wp-json/">`, ["wp-content", "wp-json"]],
    ["squarespace", `<link href="https://static1.squarespace.com/static/versioned-site-css/x.css">`, ["static1.squarespace.com"]],
    ["wix", `<img src="https://static.wixstatic.com/media/x.png">`, ["wixstatic"]],
    ["bigcommerce", `<script src="https://cdn11.bigcommerce.com/s-abc/stencil.js">`, ["bigcommerce"]],
  ] as const)("spots %s", (platform, head, signals) => {
    const out = detectPlatform(html(head));
    expect(out.platform).toBe(platform);
    expect(out.signals).toEqual(signals);
    expect(out.title).toBe("East Fork");
  });

  it("uses headers too, picks the platform with the most evidence, and decodes the title", () => {
    expect(detectPlatform("", { "X-ShopId": "123" })).toMatchObject({ platform: "shopify", signals: ["x-shopid header"] });
    // A Shopify store that links to a WordPress blog is still Shopify.
    expect(detectPlatform(html(`<script src="//cdn.shopify.com/x.js"></script><script>Shopify.theme={}</script><a href="https://blog.x.com/wp-content/a">`)).platform).toBe("shopify");
    expect(detectPlatform(html("", "Mugs &amp; Bowls &#8211; East Fork")).title).toBe("Mugs & Bowls – East Fork");
  });

  it("is custom for plain HTML and unknown for nothing", () => {
    expect(detectPlatform(html(`<script src="/app.js"></script>`))).toEqual({ platform: "custom", signals: [], title: "East Fork" });
    expect(detectPlatform("")).toEqual({ platform: "unknown", signals: [], title: undefined });
  });
});

describe("inspectStore", () => {
  it("fetches the homepage once per host for 10 minutes (www-insensitive)", async () => {
    let t = 0;
    const fetchPage = vi.fn(async () => page(html(`<script src="//cdn.shopify.com/x.js">`)));
    const deps = { fetchPage, now: () => t };
    const first = await inspectStore(storeUrl("https://www.eastfork.com/collections/mugs")!, deps);
    expect(first).toEqual({ host: "eastfork.com", reachable: true, platform: "shopify", signals: ["cdn.shopify.com"], title: "East Fork" });
    expect(fetchPage).toHaveBeenCalledWith("https://www.eastfork.com/");
    t += 9 * 60_000;
    expect(await inspectStore(storeUrl("eastfork.com")!, deps)).toEqual(first);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    t += 2 * 60_000;
    await inspectStore(storeUrl("eastfork.com")!, deps);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("reports unreachable or blocked stores without throwing, and retries them sooner", async () => {
    let t = 0;
    const fetchPage = vi.fn(async (): Promise<Fetched> => ({ url: "https://x.example/", status: 0, headers: {}, body: "", error: "timed out" }));
    const down = await inspectStore(storeUrl("x.example")!, { fetchPage, now: () => t });
    expect(down).toEqual({ host: "x.example", reachable: false, platform: "unknown", signals: [] });
    t += 31_000;
    await inspectStore(storeUrl("x.example")!, { fetchPage, now: () => t });
    expect(fetchPage).toHaveBeenCalledTimes(2);

    const blocked = await inspectStore(storeUrl("shop.example")!, { fetchPage: async () => page("Access denied", 403, { "x-shopid": "9" }) });
    expect(blocked).toMatchObject({ reachable: false, platform: "shopify", signals: ["x-shopid header"] });

    const threw = await inspectStore(storeUrl("boom.example")!, { fetchPage: async () => Promise.reject(new Error("boom")) });
    expect(threw).toMatchObject({ reachable: false, platform: "unknown" });
  });
});

describe("GET /api/onboarding/inspect", () => {
  it("validates the URL and answers through the SSRF-safe fetcher", async () => {
    vi.resetModules();
    vi.doMock("@/lib/readiness/fetcher", () => ({
      safeFetch: async (url: string) => ({ url, status: 200, headers: {}, body: html(`<html data-wf-site="1">`) }),
    }));
    const { GET } = await import("@/app/api/onboarding/inspect/route");
    expect((await GET(new Request("http://localhost/api/onboarding/inspect?url=javascript:alert(1)"))).status).toBe(400);
    const res = await GET(new Request(`http://localhost/api/onboarding/inspect?url=${encodeURIComponent("https://webflow-shop.example")}`));
    expect(await res.json()).toEqual({ host: "webflow-shop.example", reachable: true, platform: "webflow", signals: ["data-wf-site"], title: "East Fork" });
    vi.doUnmock("@/lib/readiness/fetcher");
  });
});
