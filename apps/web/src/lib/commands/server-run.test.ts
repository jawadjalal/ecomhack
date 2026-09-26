import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "./cli-args";
import { darwinPages, darwinState, findPage, headlessInputSchema, runCommandHeadless } from "./server-run";

const ORIGIN = "http://darwin.test";

/** A fetch mock answering by "METHOD /path" and recording every call. */
function mockFetch(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const path = u.pathname + u.search;
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = `${method} ${u.pathname}`;
    if (!(key in routes)) return new Response(JSON.stringify({ error: `no route ${key}` }), { status: 404 });
    return Response.json(routes[key]);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const LOOP = {
  phase: "idle",
  autopilot: false,
  generation: 3,
  insights: [
    { id: "ins_small", title: "Small issue", impactScore: 2 },
    { id: "ins_big", title: "Shipping shock at checkout", impactScore: 12.4 },
  ],
  history: [{ generation: 1, label: "Gen 1: Free delivery badge" }],
  log: [],
};

afterEach(() => vi.restoreAllMocks());

describe("runCommandHeadless", () => {
  it("navigate returns an absolute URL with 'open this page' text, no fetch", async () => {
    const { fetch, calls } = mockFetch({});
    const r = await runCommandHeadless("navigate", { page: "dashboards", site: "trail-shop-co-uk" }, { origin: `${ORIGIN}/`, fetch });
    expect(r.ok).toBe(true);
    expect(r.href).toBe(`${ORIGIN}/console/dashboards?site=trail-shop-co-uk`);
    expect(r.text).toMatch(/Open this page/);
    expect(calls).toHaveLength(0);
  });

  it("runs a read-only command through the API route with the caller's auth forwarded", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/loop": LOOP });
    const r = await runCommandHeadless("open_issue", {}, { origin: ORIGIN, fetch, headers: { Authorization: "Bearer s3cret", "x-other": "dropped" } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Issue 1 of 2: Shipping shock at checkout");
    expect(r.href).toBe(`${ORIGIN}/console/issues?id=ins_big`);
    expect(calls).toEqual([expect.objectContaining({ method: "GET", path: "/api/loop" })]);
    expect(calls[0].headers.authorization).toBe("Bearer s3cret");
    expect(calls[0].headers["x-other"]).toBeUndefined();
  });

  it("labels simulated traffic", async () => {
    const { fetch, calls } = mockFetch({ "POST /api/simulate": { humans: 20, agents: 5, orders: 2, revenue: 25000 } });
    const r = await runCommandHeadless("simulate_traffic", { humans: 20, agents: 5 }, { origin: ORIGIN, fetch });
    expect(r).toMatchObject({ ok: true, synthetic: true });
    expect(r.text).toContain("20 simulated people and 5 simulated AI agents");
    expect(calls[0].body).toEqual({ humans: 20, agents: 5 });
  });

  it("a confirm-risk command without confirm asks the exact question and changes nothing", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/loop": LOOP, "POST /api/loop/rollback": { ...LOOP, generation: 4 } });
    const r = await runCommandHeadless("rollback", { generation: 1 }, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("Put Gen 1 (“Free delivery badge”) back live instead of Gen 3? Shoppers see it right away and any running test stops.");
    expect(r.data).toMatchObject({ needsConfirmation: true, command: "rollback" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);

    const notTrue = await runCommandHeadless("rollback", { generation: 1, confirm: "yes" }, { origin: ORIGIN, fetch });
    expect(notTrue.ok).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a confirm-risk command with confirm: true runs", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/loop": LOOP, "POST /api/loop/rollback": { ...LOOP, generation: 4 } });
    const r = await runCommandHeadless("rollback", { generation: 1, confirm: true }, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("now Gen 4");
    expect(r.href).toBe(`${ORIGIN}/console/changes`);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/api/loop/rollback", body: { generation: 1 } });
  });

  it("rejects unknown commands and bad input without calling anything; API errors come back as ok:false", async () => {
    const { fetch, calls } = mockFetch({});
    expect(await runCommandHeadless("nope", {}, { origin: ORIGIN, fetch })).toMatchObject({ ok: false, text: expect.stringContaining("Unknown command") });
    expect(await runCommandHeadless("step_loop", { times: 99 }, { origin: ORIGIN, fetch })).toMatchObject({ ok: false, text: expect.stringContaining("Bad input") });
    expect(calls).toHaveLength(0);
    const r = await runCommandHeadless("step_loop", {}, { origin: ORIGIN, fetch });
    expect(r).toMatchObject({ ok: false, text: expect.stringContaining("Step the loop failed") });
  });

  it("whats_left without an area gives the whole roadmap", async () => {
    const r = await runCommandHeadless("whats_left", {}, { origin: ORIGIN, fetch: mockFetch({}).fetch });
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
  });
});

describe("setup and demo commands (headless)", () => {
  it("start_demo fills the demo store, turns autopilot on and labels it simulated", async () => {
    const { fetch, calls } = mockFetch({
      "POST /api/demo": { action: "seeded", steps: 4, status: { mode: "demo", generation: 1, hasSimulatedTraffic: true, connections: { sites: [] } } },
      "POST /api/loop/autopilot": { ...LOOP, autopilot: true },
    });
    const r = await runCommandHeadless("start_demo", {}, { origin: ORIGIN, fetch });
    expect(r).toMatchObject({ ok: true, synthetic: true, href: `${ORIGIN}/console` });
    expect(r.text).toContain("ran its loop to Gen 1");
    expect(r.text).toMatch(/Autopilot is on/);
    expect(r.text).toMatch(/simulated and labelled/);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/demo", "POST /api/loop/autopilot"]);
    expect(calls[1].body).toEqual({ on: true });
  });

  it("start_demo tops the store up once when /api/demo had nothing to do", async () => {
    const { fetch, calls } = mockFetch({
      "POST /api/demo": { action: "none", status: { mode: "demo", generation: 2, hasSimulatedTraffic: true, connections: { sites: [] } } },
      "POST /api/loop/autopilot": { ...LOOP, autopilot: true },
      "POST /api/simulate": { humans: 200, agents: 20, orders: 9, revenue: 100000 },
    });
    const r = await runCommandHeadless("start_demo", {}, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("200 simulated people and 20 simulated AI agents");
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/api/simulate" });
  });

  it("watch_fix steps the loop phase by phase and stops once it ships", async () => {
    const states = [
      { ...LOOP, phase: "observe", log: [{ message: "Watched 220 shoppers" }] },
      { ...LOOP, phase: "diagnose", log: [{}, { message: "Found shipping shock" }] },
      { ...LOOP, phase: "ship", generation: 4, log: [{}, {}, { message: "Shipped Gen 4" }] },
    ];
    let i = 0;
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname === "/api/loop") return Response.json(LOOP);
      return Response.json(states[Math.min(i++, states.length - 1)]);
    }) as unknown as typeof globalThis.fetch;
    const r = await runCommandHeadless("watch_fix", { steps: 8 }, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("1. Observe: Watched 220 shoppers");
    expect(r.text).toContain("2. Diagnose: Found shipping shock");
    expect(r.text).toContain("3. Ship: Shipped Gen 4");
    expect(r.text).toContain("Gen 4 live");
    expect(r.data).toMatchObject({ phases: ["observe", "diagnose", "ship"], generation: 4 });
    expect(calls.filter((c) => c === "POST /api/loop/step")).toHaveLength(3);
  });

  it("check_install reports waiting / installed / verified in plain words", async () => {
    const base = { host: "shop.example.com", checkedAt: "2026-09-26T15:00:00Z" };
    const cases = [
      [{ ...base, verified: false, detail: "No darwin.js tag on the homepage yet." }, /^Waiting: .*No darwin\.js tag/, "waiting"],
      [{ ...base, verified: true, via: "tag", detail: "Found the tag." }, /^Installed: /, "installed"],
      [{ ...base, verified: true, via: "events", detail: "12 events in the last hour." }, /^Verified: Darwin is receiving real events from shop\.example\.com/, "verified"],
    ] as const;
    for (const [verify, text, state] of cases) {
      const { fetch, calls } = mockFetch({ "GET /api/command": { context: { sites: { tracking: [], web: [] } } }, "GET /api/onboarding/verify": verify });
      const r = await runCommandHeadless("check_install", { url: "https://shop.example.com" }, { origin: ORIGIN, fetch });
      expect(r.ok).toBe(true);
      expect(r.text).toMatch(text);
      expect(r.data).toMatchObject({ state, site: "shop-example-com" });
      expect(calls.at(-1)?.path).toBe("/api/onboarding/verify?site=shop-example-com&url=https%3A%2F%2Fshop.example.com");
    }
  });

  it("check_install without a url uses the store saved with the only tracking plan, else asks", async () => {
    const { fetch, calls } = mockFetch({
      "GET /api/command": { context: { sites: { tracking: ["trail-shop-co-uk"], web: [] } } },
      "GET /api/onboarding/plan": { plan: { site: "trail-shop-co-uk", siteUrl: "https://trail-shop.co.uk" } },
      "GET /api/onboarding/verify": { verified: false, host: "trail-shop.co.uk", checkedAt: "x", detail: "" },
    });
    const r = await runCommandHeadless("check_install", {}, { origin: ORIGIN, fetch });
    expect(r.text).toBe("Waiting: Darwin hasn't seen darwin.js on trail-shop.co.uk yet.");
    expect(calls.at(-1)?.path).toContain("site=trail-shop-co-uk&url=https%3A%2F%2Ftrail-shop.co.uk");
    const none = mockFetch({ "GET /api/command": { context: { sites: { tracking: [], web: [] } } } });
    const asked = await runCommandHeadless("check_install", {}, { origin: ORIGIN, fetch: none.fetch });
    expect(asked.ok).toBe(false);
    expect(asked.text).toMatch(/Which store/);
  });

  it("save_setup returns the resume link and never claims an email was sent", async () => {
    const { fetch, calls } = mockFetch({ "POST /api/account": { email: "jo@example.com", initials: "JO", resumeUrl: `${ORIGIN}/api/account/resume?token=abc` } });
    const r = await runCommandHeadless("save_setup", { email: "jo@example.com" }, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.href).toBe(`${ORIGIN}/api/account/resume?token=abc`);
    expect(r.text).toContain(`${ORIGIN}/api/account/resume?token=abc`);
    expect(r.text).toContain("Nothing was emailed");
    expect(r.text).not.toMatch(/\b(?:we|darwin) (?:sent|emailed)\b|check your (?:inbox|email)/i);
    expect(calls[0].body).toEqual({ email: "jo@example.com" });
    const missing = await runCommandHeadless("save_setup", {}, { origin: ORIGIN, fetch });
    expect(missing.ok).toBe(false);
    await expect(runCommandHeadless("save_setup", { email: "not-an-email" }, { origin: ORIGIN, fetch })).resolves.toMatchObject({ ok: false });
  });

  it("which_store says demo store vs connected repo and sites", async () => {
    const demo = mockFetch({ "GET /api/github/status": { configured: false }, "GET /api/account": { sites: [] }, "GET /api/command": { context: { sites: { tracking: [], web: [] } } } });
    const d = await runCommandHeadless("which_store", {}, { origin: ORIGIN, fetch: demo.fetch });
    expect(d.text).toMatch(/demo store/);
    expect(d.data).toMatchObject({ demo: true });
    const mine = mockFetch({
      "GET /api/github/status": { configured: true, repo: "acme/shop", connection: { repo: "acme/shop" } },
      "GET /api/account": { email: "jo@example.com", sites: ["acme-shop"] },
      "GET /api/command": { context: { sites: { tracking: ["acme-shop"], web: [] } } },
    });
    const m = await runCommandHeadless("which_store", {}, { origin: ORIGIN, fetch: mine.fetch });
    expect(m.text).toContain("the GitHub repo acme/shop and the site acme-shop");
    expect(m.data).toMatchObject({ demo: false, repo: "acme/shop", sites: ["acme-shop"] });
  });

  it("detect_platform names the platform with its evidence", async () => {
    const { fetch, calls } = mockFetch({ "GET /api/onboarding/inspect": { host: "shop.example.com", reachable: true, platform: "shopify", signals: ["cdn.shopify.com"] } });
    const r = await runCommandHeadless("detect_platform", { url: "shop.example.com" }, { origin: ORIGIN, fetch });
    expect(r).toMatchObject({ ok: true, text: "shop.example.com runs on Shopify (seen: cdn.shopify.com)." });
    expect(calls[0].path).toBe("/api/onboarding/inspect?url=shop.example.com");
    const down = mockFetch({ "GET /api/onboarding/inspect": { host: "gone.example", reachable: false, platform: "unknown", signals: [] } });
    expect((await runCommandHeadless("detect_platform", { url: "gone.example" }, { origin: ORIGIN, fetch: down.fetch })).ok).toBe(false);
  });

  it("research_competitors posts to /api/research and labels the sample report", async () => {
    const report = { id: "rsr_abc123", demo: true, notice: "Add TAVILY_API_KEY to run real research", summary: { text: "Three UK rivals undercut on price." }, competitors: [{ name: "Runr", priceRange: "£90–£150" }, { name: "Trailhead" }], suggestions: [], sources: [] };
    const { fetch, calls } = mockFetch({ "POST /api/research": report });
    const r = await runCommandHeadless("research_competitors", { query: "trail running shoes in the UK" }, { origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Competitors: Runr (£90–£150), Trailhead.");
    expect(r.text).toMatch(/labelled sample/);
    expect(r.href).toBe(`${ORIGIN}/console/research?id=rsr_abc123`);
    expect(calls[0].body).toEqual({ kind: "competitors", query: "trail running shoes in the UK" });
  });
});

describe("headless views", () => {
  it("darwin_state reads the loop, KPIs (all and real-only) and running tests", async () => {
    const kpis = (visitors: number) => ({ totalEvents: 1, overall: { visitors, orders: 10, revenue: 100000, conversionRate: 0.1 }, byKind: { human: { visitors, orders: 5, conversionRate: 0.05 }, agent: { visitors: 0, orders: 5, conversionRate: 0.5 } } });
    const { fetch, calls } = mockFetch({
      "GET /api/loop": LOOP,
      "GET /api/analytics/summary": kpis(100),
      "GET /api/briefing": { text: "t", items: [{ id: "agent:1", title: "One best pick", kind: "agent", status: "running", traffic: "simulated", say: "", actions: [] }] },
    });
    // includeSynthetic=0 answers the same route in this mock; the real API filters.
    const r = await darwinState({ origin: ORIGIN, fetch });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Gen 3 live");
    expect(r.text).toContain("One best pick [agent, running] (simulated traffic)");
    expect(calls.map((c) => c.path)).toContain("/api/analytics/summary?includeSynthetic=0");
  });

  it("lists every page with an absolute URL and finds pages by key or label", () => {
    const pages = darwinPages("http://x.test");
    expect(pages.every((p) => p.url.startsWith("http://x.test/") && p.purpose)).toBe(true);
    expect(findPage("http://x.test", "experiments")?.url).toBe("http://x.test/console/experiments");
    expect(findPage("http://x.test", "store agent")?.key).toBe("agents");
    expect(findPage("http://x.test", "nowhere")).toBeUndefined();
  });

  it("adds a confirm flag to risky commands' schemas only", () => {
    expect((headlessInputSchema("rollback").properties as Record<string, unknown>).confirm).toBeDefined();
    expect((headlessInputSchema("simulate_traffic").properties as Record<string, unknown>).confirm).toBeUndefined();
  });
});

describe("CLI args", () => {
  it("parses --key value pairs with types, --json input and --yes", () => {
    const a = parseCliArgs(["run", "simulate_traffic", "--humans", "20", "--agents=5", "--yes"]);
    expect(a).toMatchObject({ cmd: "run", positional: ["simulate_traffic"], input: { humans: 20, agents: 5 }, yes: true, json: false });

    const b = parseCliArgs(["run", "build_dashboard", "--json", '{"request":"coupon usage","site":"x"}', "--site", "trail-shop"]);
    expect(b.input).toEqual({ request: "coupon usage", site: "trail-shop" });
    expect(b.json).toBe(false);

    const c = parseCliArgs(["run", "set_autopilot", "--on", "true", "--no-verbose", "--dry-run"]);
    expect(c.input).toEqual({ on: true, verbose: false, dry_run: true });
  });

  it("a bare --json means machine output; plain words stay positional", () => {
    expect(parseCliArgs(["state", "--json"])).toMatchObject({ cmd: "state", json: true, input: {} });
    expect(parseCliArgs(["do", "send 200 shoppers", "-y"])).toMatchObject({ cmd: "do", positional: ["send 200 shoppers"], yes: true });
    expect(parseCliArgs(["run", "x", "--json", "{bad"]).error).toMatch(/JSON object/);
    expect(parseCliArgs([]).cmd).toBe("");
    expect(parseCliArgs(["--help"]).cmd).toBe("help");
  });
});
