import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { TRACKER_JS } from "./tracker";

interface SentEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

type Listener = (e: Record<string, unknown>) => void;

function el(tag: string, attrs: Record<string, string> = {}, text = "", parent: FakeEl | null = null) {
  return new FakeEl(tag, attrs, text, parent);
}

class FakeEl {
  nodeType = 1;
  tagName: string;
  id: string;
  constructor(
    tag: string,
    private attrs: Record<string, string>,
    public innerText: string,
    public parentElement: FakeEl | null,
  ) {
    this.tagName = tag.toUpperCase();
    this.id = attrs.id ?? "";
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  closest(selector: string): FakeEl | null {
    const tags = selector.split(",").map((s) => s.trim().toLowerCase());
    if (tags.includes(this.tagName.toLowerCase())) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
}

/** Boot darwin.js in a sandbox with just enough DOM. */
function boot(opts: { cookie?: string; gpc?: boolean; webdriver?: boolean; preQueue?: unknown[]; search?: string } = {}) {
  const posts: { url: string; body: SentEvent[]; headers: Record<string, string>; beacon: boolean }[] = [];
  const listeners: Record<string, Listener[]> = {};
  const on = (type: string, fn: Listener) => (listeners[type] ??= []).push(fn);
  const timers: (() => void)[] = [];
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const location = { href: "https://shop.test/", pathname: "/", search: opts.search ?? "", origin: "https://shop.test", protocol: "https:", host: "shop.test" };
  const navigate = (path: string) => {
    location.pathname = path;
    location.href = `https://shop.test${path}`;
  };
  let cookie = opts.cookie ?? "";
  const script = {
    src: "https://darwin.example.com/darwin.js",
    getAttribute: (k: string) => ({ "data-darwin-site": "acme-storefront" })[k] ?? null,
  };
  const appended: { async?: boolean; src?: string }[] = [];
  const document = {
    currentScript: script,
    head: { appendChild: (el: { async?: boolean; src?: string }) => void appended.push(el) },
    createElement: () => ({}) as { async?: boolean; src?: string },
    querySelector: () => script,
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      cookie = v.split(";")[0];
    },
    referrer: "https://google.com/",
    title: "PACE — Running shoes",
    visibilityState: "visible",
    addEventListener: on,
  };
  const history = {
    pushState: (_s: unknown, _t: string, url: string) => navigate(url),
    replaceState: (_s: unknown, _t: string, url: string) => navigate(url),
  };
  const window: Record<string, unknown> = {
    addEventListener: on,
    localStorage: storage(),
    sessionStorage: storage(),
    darwin: opts.preQueue,
  };
  const ctx = vm.createContext({
    window,
    document,
    navigator: {
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
      webdriver: opts.webdriver ?? false,
      globalPrivacyControl: opts.gpc ?? false,
      sendBeacon: (url: string, body: string) => {
        posts.push({ url, body: JSON.parse(body).events, headers: {}, beacon: true });
        return true;
      },
    },
    location,
    history,
    screen: { width: 1440 },
    crypto: globalThis.crypto,
    URL,
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
    fetch: (url: string, init: { body: string; headers: Record<string, string> }) => {
      posts.push({ url, body: JSON.parse(init.body).events, headers: init.headers, beacon: false });
      return Promise.resolve(new Response("{}"));
    },
  });
  vm.runInContext(TRACKER_JS, ctx);
  const darwin = window.darwin as { capture: (e: string, p?: object) => void; flush: () => void; optedOut?: boolean; distinctId?: () => string };
  const runTimers = () => timers.splice(0).forEach((t) => t());
  const events = () => posts.flatMap((p) => p.body);
  const fire = (type: string, e: Record<string, unknown> = {}) => (listeners[type] ?? []).forEach((l) => l(e));
  return { darwin, posts, events, fire, runTimers, history, cookie: () => cookie, appended, window };
}

describe("darwin.js tracker", () => {
  it("loads the site's personalization runtime from the script's origin", () => {
    const { appended } = boot();
    expect(appended).toEqual([{ async: true, src: "https://darwin.example.com/api/web/runtime.js?site=acme-storefront" }]);
    // The console previews drafts with ?darwin_preview=<rule id>; only a safe id is passed on.
    const preview = boot({ search: "?darwin_preview=wr_abc123&darwin_variant=treatment" }).appended[0];
    expect(preview.src).toBe("https://darwin.example.com/api/web/runtime.js?site=acme-storefront&darwin_preview=wr_abc123");
    expect(boot({ search: "?darwin_preview=%22%3E%3Cscript" }).appended[0].src).not.toContain("script");
  });

  it("is under 4.5 KB and valid JavaScript", () => {
    expect(Buffer.byteLength(TRACKER_JS)).toBeLessThan(4608);
    expect(() => new vm.Script(TRACKER_JS)).not.toThrow();
  });

  it("sends a $pageview with identity and page context to {script origin}/api/collect", () => {
    const t = boot();
    t.darwin.flush();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].url).toBe("https://darwin.example.com/api/collect");
    expect(t.posts[0].headers["Content-Type"]).toBe("text/plain"); // no CORS preflight
    const [pv] = t.events();
    expect(pv.event).toBe("$pageview");
    expect(pv.distinct_id).toMatch(/^v_/);
    expect(pv.properties).toMatchObject({
      $current_url: "https://shop.test/",
      $pathname: "/",
      $referrer: "https://google.com/",
      $lib: "darwin-js",
      darwin_site: "acme-storefront",
      $device_type: "Desktop",
      title: "PACE — Running shoes",
    });
    expect(pv.properties.$session_id).toMatch(/^s_/);
    expect(t.cookie()).toBe(`darwin_id=${encodeURIComponent(pv.distinct_id)}`);
  });

  it("reuses an existing darwin_id cookie (shared with the Darwin storefront)", () => {
    const t = boot({ cookie: "darwin_id=v_existing" });
    t.darwin.flush();
    expect(t.events()[0].distinct_id).toBe("v_existing");
    expect(t.darwin.distinctId?.()).toBe("v_existing");
  });

  it("autocaptures clicks and detects rage clicks (3 on the same element within 1s)", () => {
    const t = boot();
    const form = el("form", { class: "checkout-form wide extra" });
    const button = el("button", { class: "btn primary big", "data-darwin": "pay" }, "  Pay   now ", form);
    const span = el("span", {}, "Pay now", button);
    for (let i = 0; i < 3; i++) t.fire("click", { target: span });
    t.darwin.flush();
    const names = t.events().map((e) => e.event);
    expect(names.filter((n) => n === "$autocapture")).toHaveLength(3);
    expect(names.filter((n) => n === "$rageclick")).toHaveLength(1);
    const rage = t.events().find((e) => e.event === "$rageclick")!;
    expect(rage.properties).toMatchObject({ $el_tag: "button", $el_text: "Pay now", $selector: 'button[data-darwin="pay"]' });
  });

  it("never captures input values", () => {
    const t = boot();
    t.fire("click", { target: el("input", { type: "email", value: "me@example.com", id: "email" }) });
    t.fire("click", { target: el("input", { type: "submit" }) });
    t.darwin.flush();
    const clicks = t.events().filter((e) => e.event === "$autocapture");
    expect(clicks[0].properties).toMatchObject({ $el_tag: "input", $el_text: "", $selector: "input#email" });
    expect(JSON.stringify(t.events())).not.toContain("me@example.com");
  });

  it("tracks client-side navigation as $pageleave + $pageview", () => {
    const t = boot();
    t.history.pushState(null, "", "/products/trail-runner");
    t.runTimers();
    t.darwin.flush();
    const [, leave, view] = t.events();
    expect(leave).toMatchObject({ event: "$pageleave", properties: { $pathname: "/" } });
    expect(view).toMatchObject({ event: "$pageview", properties: { $pathname: "/products/trail-runner" } });
  });

  it("supports custom events, replays pre-load calls and beacons on pagehide", () => {
    const t = boot({ preQueue: [["checkout_started", { step: 1 }]], webdriver: true });
    t.darwin.capture("order_completed", { revenue: 8999 });
    t.fire("pagehide");
    expect(t.posts.every((p) => p.beacon)).toBe(true);
    const names = t.events().map((e) => e.event);
    expect(names).toEqual(["checkout_started", "$pageview", "order_completed", "$pageleave"]);
    expect(t.events()[2].properties).toMatchObject({ revenue: 8999, $webdriver: true });
  });

  it("honours Global Privacy Control", () => {
    const t = boot({ gpc: true });
    t.darwin.capture("order_completed");
    t.darwin.flush();
    expect(t.darwin.optedOut).toBe(true);
    expect(t.posts).toHaveLength(0);
  });
});
