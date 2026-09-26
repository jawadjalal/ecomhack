import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { WebRule } from "@/lib/contracts";
import { hashToUnit } from "@/lib/experiments/assign";
import { buildRuntime } from "./runtime";

/* ------------------------------------------------------------------ a tiny DOM, just enough for the runtime */

class El {
  nodeType = 1;
  children: El[] = [];
  parentNode: El | null = null;
  attrs: Record<string, string> = {};
  text = "";
  style = {
    cssText: "",
    props: {} as Record<string, string>,
    setProperty(k: string, v: string) {
      this.props[k] = v;
    },
  };
  constructor(
    public tagName: string,
    attrs: Record<string, string> = {},
    text = "",
  ) {
    this.tagName = tagName.toUpperCase();
    Object.assign(this.attrs, attrs);
    this.text = text;
  }
  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get nextSibling() {
    const sibs = this.parentNode?.children ?? [];
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  appendChild(c: El) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c: El, ref: El | null) {
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c: El) {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
  }
  matches(sel: string): boolean {
    return sel.split(",").some((s) => {
      const m = s.trim().match(/^([a-z0-9]*)(#[\w-]+)?((?:\.[\w-]+)*)(\[([\w-]+)(?:="([^"]*)")?\])?$/i);
      if (!m) return false;
      const [, tag, id, classes, , attr, val] = m;
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      if (id && this.attrs.id !== id.slice(1)) return false;
      const cls = (this.attrs.class ?? "").split(/\s+/);
      if (classes && !classes.split(".").filter(Boolean).every((c) => cls.includes(c))) return false;
      if (attr && (val === undefined ? !(attr in this.attrs) : this.attrs[attr] !== val)) return false;
      return true;
    });
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
}

interface Boot {
  url?: string;
  /** Share sessionStorage between page views. */
  session?: Map<string, string>;
  referrer?: string;
  cookie?: string;
  preQueue?: unknown[];
  rules: Partial<WebRule>[];
}

function rule(over: Partial<WebRule>): WebRule {
  return {
    id: "r1",
    site: "north-trail",
    name: "Rule",
    audience: {},
    changes: [],
    mode: "test",
    allocation: 0.5,
    status: "running",
    metric: "order_completed",
    author: "manual",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function boot(opts: Boot & { previewRuleId?: string }) {
  const html = new El("html");
  const head = html.appendChild(new El("head"));
  const body = html.appendChild(new El("body"));
  const h1 = body.appendChild(new El("h1", { class: "hero-title" }, "Trail shoes built for mud"));
  const cta = body.appendChild(new El("button", { class: "add-to-cart" }, "Add to cart"));
  const popup = body.appendChild(new El("div", { class: "promo-popup" }, "Sign up for 10% off"));
  const url = new URL(opts.url ?? "https://north-trail.example/");
  let cookie = opts.cookie ?? "";
  const store = (m = new Map<string, string>()) => {
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const document = {
    documentElement: html,
    head,
    body,
    readyState: "complete",
    referrer: opts.referrer ?? "",
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      cookie = v.split(";")[0];
    },
    createElement: (t: string) => new El(t),
    querySelector: (s: string) => html.all().find((e) => e.matches(s)) ?? null,
    querySelectorAll: (s: string) => html.all().filter((e) => e.matches(s)),
    addEventListener: () => {},
  };
  const captured: [string, Record<string, unknown>][] = [];
  const window: Record<string, unknown> = {
    sessionStorage: store(opts.session),
    localStorage: store(),
    darwin: opts.preQueue ?? { v: 1, capture: (e: string, p: Record<string, unknown>) => captured.push([e, p]) },
    dispatchEvent: () => true,
  };
  const ctx = vm.createContext({
    window,
    document,
    location: { href: url.href, pathname: url.pathname, hostname: url.hostname, protocol: url.protocol },
    URL,
    crypto: globalThis.crypto,
    Math,
    JSON,
    setTimeout: () => 0,
    CustomEvent: class {
      constructor(public type: string) {}
    },
  });
  vm.runInContext(buildRuntime("north-trail", opts.rules.map(rule), opts.previewRuleId), ctx);
  const web = window.darwinWeb as { source: string; query: string; preview: boolean; rules: { id: string; variant: string; applied: boolean }[] };
  return { web, h1, cta, popup, body, head, captured, window, cookie: () => cookie };
}

const banner = { action: "banner" as const, value: "Free UK delivery over £60 · 60-day free returns" };

describe("personalization runtime", () => {
  it.each([
    ["https://north-trail.example/?utm_source=chatgpt.com", "", "ai"],
    ["https://north-trail.example/", "https://www.perplexity.ai/search?q=x", "ai"],
    ["https://north-trail.example/?gclid=abc", "https://www.google.com/", "paid"],
    ["https://north-trail.example/?utm_medium=email&utm_source=klaviyo", "", "email"],
    ["https://north-trail.example/", "https://www.google.co.uk/", "search"],
    ["https://north-trail.example/", "https://l.instagram.com/", "social"],
    ["https://north-trail.example/", "https://t.co/abc", "social"],
    ["https://north-trail.example/", "https://blog.runner.example/post", "referral"],
    ["https://north-trail.example/", "https://north-trail.example/other", "direct"],
    ["https://north-trail.example/", "", "direct"],
    ["https://north-trail.example/?utm_term=trail+shoes", "", "search"],
  ])("classifies %s (referrer %s) as %s", (url, referrer, source) => {
    expect(boot({ url, referrer, rules: [] }).web.source).toBe(source);
  });

  it("reads the search query from utm_term or on-site search", () => {
    expect(boot({ url: "https://s.example/?utm_term=Waterproof+Trail+Shoes", rules: [] }).web.query).toBe("waterproof trail shoes");
    expect(boot({ url: "https://s.example/search?q=trail", rules: [] }).web.query).toBe("trail");
  });

  it("keeps the session's source but picks up a later on-site search", () => {
    const session = new Map<string, string>();
    expect(boot({ session, url: "https://s.example/", referrer: "https://l.instagram.com/", rules: [] }).web).toMatchObject({ source: "social", query: "" });
    expect(boot({ session, url: "https://s.example/search?q=Gore-Tex", referrer: "https://s.example/", rules: [] }).web).toMatchObject({ source: "social", query: "gore-tex" });
  });

  it("assigns variants with the same hash as the server and reports one exposure per rule", () => {
    const cookie = "darwin_id=v_abc123";
    const { web, captured } = boot({ cookie, url: "https://s.example/?utm_source=chatgpt.com", rules: [{ id: "r1", audience: { sources: ["ai"] }, changes: [banner] }] });
    const expected = hashToUnit("v_abc123:r1") < 0.5 ? "treatment" : "control";
    expect(web.rules).toEqual([{ id: "r1", variant: expected, applied: expected === "treatment" }]);
    expect(captured).toEqual([["$darwin_web_exposure", { rule_id: "r1", web_source: "ai", web_query: undefined, darwin_site: "north-trail" }]]);
  });

  it("applies text, banner, badge and hide changes for the treatment, only for the matching audience", () => {
    const changes = [
      { action: "text" as const, selector: "h1.hero-title", value: "{query}, ready to ship today" },
      banner,
      { action: "badge" as const, selector: "button.add-to-cart", value: "★ 4.8 from 2,000+ runners" },
      { action: "hide" as const, selector: ".promo-popup" },
    ];
    const hit = boot({ url: "https://s.example/?utm_term=waterproof+trail+shoes&darwin_variant=treatment", referrer: "https://www.google.com/", rules: [{ changes }] });
    expect(hit.h1.textContent).toBe("Waterproof Trail Shoes, ready to ship today");
    expect(hit.body.firstChild?.textContent).toBe(banner.value);
    expect(hit.body.firstChild?.getAttribute("data-darwin-banner")).toBe("r1");
    expect(hit.cta.nextSibling?.textContent).toBe("★ 4.8 from 2,000+ runners");
    expect(hit.popup.style.props.display).toBe("none");
    expect(hit.head.children.some((c) => c.getAttribute("data-darwin-antiflicker") !== null)).toBe(false);

    const miss = boot({ url: "https://s.example/?darwin_variant=treatment", rules: [{ audience: { sources: ["ai"] }, changes }] });
    expect(miss.web.rules).toEqual([]);
    expect(miss.h1.textContent).toBe("Trail shoes built for mud");
  });

  it("skips {query} changes when there's no query, shows shipped rules to everyone, and never injects HTML", () => {
    const noQuery = boot({ url: "https://s.example/?darwin_variant=treatment", rules: [{ changes: [{ action: "text", selector: "h1", value: "{query} in stock" }] }] });
    expect(noQuery.h1.textContent).toBe("Trail shoes built for mud");

    const shipped = boot({ cookie: "darwin_id=v_any", rules: [{ status: "shipped", changes: [{ action: "text", selector: "h1", value: "<img src=x onerror=alert(1)>" }] }] });
    expect(shipped.web.rules[0].variant).toBe("treatment");
    expect(shipped.h1.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(shipped.h1.children).toEqual([]);
  });

  it("previews send no events, and events queue for darwin.js when it isn't loaded yet", () => {
    const preview = boot({ url: "https://s.example/?darwin_source=social&darwin_variant=treatment", rules: [{ changes: [banner] }] });
    expect(preview.web).toMatchObject({ source: "social", preview: true });
    expect(preview.captured).toEqual([]);

    const queue: unknown[] = [];
    boot({ preQueue: queue, rules: [{ changes: [banner] }] });
    expect(queue).toEqual([["$darwin_web_exposure", expect.objectContaining({ rule_id: "r1", web_source: "direct" })]]);
  });

  it("only includes an unlaunched draft when previewing it, and a preview sends no events", () => {
    const draftRule = { id: "wr_draft", status: "draft" as const, changes: [banner] };
    expect(boot({ url: "https://s.example/?darwin_variant=treatment", rules: [draftRule] }).web.rules).toEqual([]);
    const shown = boot({ url: "https://s.example/?darwin_preview=wr_draft&darwin_variant=treatment", rules: [draftRule], previewRuleId: "wr_draft" });
    expect(shown.web.rules).toEqual([{ id: "wr_draft", variant: "treatment", applied: true }]);
    expect(shown.body.firstChild?.textContent).toBe(banner.value);
    expect(shown.captured).toEqual([]);
  });
});
