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
