/**
 * Grok certificate: level thresholds, the heuristic fallback, the MCP trial's safety rails and the badge.
 * The LLM is mocked (like lib/optimizer/llm.test.ts); no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadinessCertificate, ReadinessReport } from "@/lib/contracts";
import type { Artifacts, Fetched } from "./checks";

const llm = vi.hoisted(() => ({
  available: true,
  responses: [] as unknown[],
  calls: [] as { system: string; prompt: string; provider?: string }[],
}));

vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.available,
  llmLabel: () => (llm.available ? "llm:grok-test" : "heuristic"),
  llmProvider: () => (llm.available ? "xai" : "none"),
  llmModel: () => "grok-test",
  resolveProvider: () => (llm.available ? "xai" : "none"),
  generateText: async () => "",
  generateJson: async (req: { system: string; prompt: string; provider?: string; schema: { parse: (v: unknown) => unknown } }) => {
    llm.calls.push({ system: req.system, prompt: req.prompt, provider: req.provider });
    const next = llm.responses.shift();
    if (next instanceof Error) throw next;
    return req.schema.parse(next);
  },
}));

const { badgeSvg, certifyStore, certLevel, escapeXml, getCertificate, isForbiddenTool, runMcpTrial, trialProgress } = await import("./certify");
type TrialAction = import("./certify").TrialAction;

const SHOP = "https://shop.example";
const f = (url: string, body: string, status = 200): Fetched => ({ url, status, body, headers: {} });

function report(score: number): ReadinessReport {
  return {
    url: `${SHOP}/`,
    origin: SHOP,
    platform: "shopify",
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F",
    categories: { access: { score: 0, max: 0 }, understand: { score: 0, max: 0 }, act: { score: 0, max: 0 } },
    checks: [],
    generated: { llmsTxt: "" },
    checkedAt: new Date().toISOString(),
    durationMs: 1,
  };
}

const PRODUCT_HTML = `<html><body><h1>Trail Runner</h1><p>£120.00</p><p>Sizes UK 7-12</p><p>Free delivery in 2 days</p><p>30-day free returns</p></body></html>`;

function fakeAudit(score: number, over: Partial<Artifacts> = {}) {
  return async () => ({
    report: report(score),
    artifacts: { url: `${SHOP}/`, home: f(`${SHOP}/`, "<html><body>Trail Co</body></html>"), product: f(`${SHOP}/products/trail`, PRODUCT_HTML), ...over } as Artifacts,
  });
}

const allFound = {
  price: { status: "found", evidence: "£120.00" },
  variants: { status: "found", evidence: "UK 7-12" },
  delivery: { status: "found", evidence: "2 days" },
  returns: { status: "found", evidence: "30-day free returns" },
} as const;

beforeEach(() => {
  llm.available = true;
  llm.responses = [];
  llm.calls = [];
});

describe("certLevel", () => {
  it("maps score (and trial) to Gold / Silver / Bronze / none", () => {
    expect(certLevel(85, true)).toBe("gold");
    expect(certLevel(100, null)).toBe("gold"); // heuristic: score only
    expect(certLevel(84, true)).toBe("silver");
    expect(certLevel(92, false)).toBe("silver"); // Gold needs a passing trial
    expect(certLevel(70, false)).toBe("silver");
    expect(certLevel(69, true)).toBe("bronze");
    expect(certLevel(55, null)).toBe("bronze");
    expect(certLevel(54, true)).toBe("none");
    expect(certLevel(0, null)).toBe("none");
  });
});

describe("certifyStore", () => {
  it("falls back to a heuristic certificate from the score when no LLM key is set", async () => {
    llm.available = false;
    const cert = await certifyStore(SHOP, { audit: fakeAudit(88), persist: false, now: () => new Date("2026-01-01T00:00:00Z") });
    expect(cert).toMatchObject({ level: "gold", heuristic: true, model: "heuristic", score: 88, grade: "A", origin: SHOP });
    expect(cert.trial).toBeUndefined();
    expect(cert.id).toMatch(/^cert_[a-z0-9]+$/);
    expect(cert.verdict).toContain("heuristic");
    expect(cert.expiresAt).toBe("2026-04-01T00:00:00.000Z"); // +90 days
    expect(llm.calls).toHaveLength(0);
  });

  it("has Grok judge the page text when the store has no MCP, and caps a failed trial at Silver", async () => {
    llm.responses.push({ criteria: { ...allFound, delivery: { status: "missing" } }, summary: "Price and sizes are clear; delivery isn't stated." });
    const cert = await certifyStore(SHOP, { audit: fakeAudit(90), persist: false });
    expect(cert).toMatchObject({ level: "silver", heuristic: false, model: "llm:grok-test" });
    expect(cert.trial).toMatchObject({ mode: "page", passed: false });
    expect(cert.trial!.criteria.find((c) => c.id === "delivery")!.status).toBe("missing");
    expect(cert.verdict).toMatch(/Gold needs a passing agent trial.*delivery/);
    // Grok (xAI) is requested explicitly, and it sees the product page text.
    expect(llm.calls[0].provider).toBe("xai");
    expect(llm.calls[0].prompt).toContain("Free delivery in 2 days");
    expect(llm.calls[0].system).toContain("untrusted");
  });

  it("gives Gold for a high score plus a passing page review", async () => {
    llm.responses.push({ criteria: allFound, summary: "Everything an agent needs is on the page." });
    const cert = await certifyStore(SHOP, { audit: fakeAudit(91), persist: false });
    expect(cert.level).toBe("gold");
    expect(cert.trial?.passed).toBe(true);
  });

  it("issues a heuristic certificate when the LLM errors, and persists it", async () => {
    llm.responses.push(new Error("upstream 500"), new Error("upstream 500"));
    const cert = await certifyStore(SHOP, { audit: fakeAudit(72) });
    expect(cert).toMatchObject({ level: "silver", heuristic: true, model: "heuristic" });
    expect(cert.note).toContain("upstream 500");
    expect(getCertificate(cert.id)?.id).toBe(cert.id);
    expect(getCertificate("cert_doesnotexist")).toBeUndefined();
    expect(getCertificate("../etc/passwd")).toBeUndefined();
  });

  it("runs the MCP trial when the store exposes MCP", async () => {
    const calls: string[] = [];
    const connect = async () => ({
      tools: [{ name: "search_products" }, { name: "add_to_cart" }, { name: "checkout" }],
      call: async (name: string) => {
        calls.push(name);
        return { ok: true, data: name === "search_products" ? [{ id: "p1", price: 12000 }] : { items: 1 } };
      },
      close: async () => undefined,
    });
    llm.responses.push(
      { tool: "search_products", args: { query: "shoes" } },
      { tool: "add_to_cart", args: { productId: "p1" } },
      { tool: "finish", criteria: allFound, summary: "Found, priced and carted." },
    );
    const cert = await certifyStore(SHOP, {
      audit: fakeAudit(86, { mcp: { ok: true, status: 200, tools: ["search_products", "add_to_cart", "checkout"] } }),
      connect,
      persist: false,
    });
    expect(calls).toEqual(["search_products", "add_to_cart"]);
    expect(cert.trial).toMatchObject({ mode: "mcp", passed: true });
    expect(cert.level).toBe("gold");
  });
});

describe("MCP trial safety", () => {
  it("never calls checkout or payment tools, and hides them from the model", async () => {
    const calls: string[] = [];
    const mcp = {
      tools: [{ name: "search_products" }, { name: "add_to_cart" }, { name: "checkout" }, { name: "createPayment" }],
      call: async (name: string) => {
        calls.push(name);
        return { ok: true, data: {} };
      },
    };
    const script: TrialAction[] = [
      { tool: "search_products", args: {} },
      { tool: "add_to_cart", args: { productId: "p1" } },
      { tool: "checkout", args: { maxTotal: 1 } },
      { tool: "createPayment", args: {} },
      { tool: "finish", criteria: allFound, summary: "done" },
    ];
    const prompts: string[] = [];
    const trial = await runMcpTrial(SHOP, mcp, {
      decide: async (_system, prompt) => {
        prompts.push(prompt);
        return script.shift()!;
      },
    });
    expect(calls).toEqual(["search_products", "add_to_cart"]);
    expect(trial.steps!.filter((s) => s.blocked).map((s) => s.tool)).toEqual(["checkout", "createPayment"]);
    expect(prompts[0]).toMatch(/BLOCKED \(never call\): checkout, createPayment/);
    expect(prompts[0]).not.toMatch(/- checkout:/);
  });

  it("is bounded: forces a finish after maxSteps and fails without one", async () => {
    let decisions = 0;
    const trial = await runMcpTrial(
      SHOP,
      { tools: [{ name: "search_products" }], call: async () => ({ ok: true, data: [] }) },
      {
        maxSteps: 3,
        decide: async () => {
          decisions++;
          return { tool: "search_products", args: {} };
        },
      },
    );
    expect(decisions).toBe(4); // 3 tool calls + 1 forced finish prompt
    expect(trial.steps).toHaveLength(3);
    expect(trial.passed).toBe(false);
  });

  it("classifies forbidden tools and progress by tool name", () => {
    for (const t of ["checkout", "place_order", "createOrder", "pay", "submit-payment", "buy_now", "complete_purchase", "abandon"]) expect(isForbiddenTool(t)).toBe(true);
    for (const t of ["search_products", "get_product", "add_to_cart", "get_cart", "check_availability", "autocomplete"]) expect(isForbiddenTool(t)).toBe(false);
    expect(
      trialProgress([
        { tool: "search_products", args: {}, ok: true, note: "" },
        { tool: "cart_add", args: {}, ok: true, note: "" },
      ]),
    ).toEqual({ foundProduct: true, addedToCart: true });
    expect(trialProgress([{ tool: "get_cart", args: {}, ok: true, note: "" }])).toEqual({ foundProduct: false, addedToCart: false });
  });
});

describe("badge", () => {
  const cert = (over: Partial<ReadinessCertificate> = {}): ReadinessCertificate => ({
    id: "cert_abc",
    url: `${SHOP}/`,
    origin: SHOP,
    level: "gold",
    score: 91,
    grade: "A",
    platform: "shopify",
    verdict: "ok",
    model: "llm:grok-test",
    heuristic: false,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-04-01T00:00:00.000Z",
    ...over,
  });

  it("escapes XML special characters", () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
    const svg = badgeSvg(cert({ origin: `https://evil.example"><script>alert(1)</script>` }), Date.parse("2026-02-01"));
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("Gold · 91/100");
    expect(svg).toContain("Grok agent-ready");
  });

  it("shows expired, unknown and heuristic states", () => {
    expect(badgeSvg(cert(), Date.parse("2026-05-01"))).toContain(">expired<");
    expect(badgeSvg(undefined)).toContain(">unknown<");
    const h = badgeSvg(cert({ heuristic: true, level: "none", score: 30 }), Date.parse("2026-02-01"));
    expect(h).toContain(">agent-ready<");
    expect(h).toContain("not certified · 30");
  });
});
