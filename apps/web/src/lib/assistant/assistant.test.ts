/**
 * Darwin's managing assistant: the keyword router (no LLM key), the confirm flow for side-effecting tools,
 * and the LLM tool loop with the model mocked (same pattern as optimizer/llm.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  available: false,
  responses: [] as unknown[],
  calls: [] as { system: string; prompt: string }[],
}));

vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.available,
  llmLabel: () => (llm.available ? "llm:grok-test" : "heuristic"),
  llmProvider: () => (llm.available ? "xai" : "none"),
  resolveProvider: () => (llm.available ? "xai" : "none"),
  llmModel: () => "grok-test",
  generateText: async () => "",
  generateJson: async (req: { system: string; prompt: string; schema: { parse: (v: unknown) => unknown } }) => {
    llm.calls.push({ system: req.system, prompt: req.prompt });
    const next = llm.responses.shift();
    if (next === undefined) throw new Error("no scripted LLM response");
    if (next instanceof Error) throw next;
    return req.schema.parse(next);
  },
}));

const { routeIntent, runAssistant, MAX_STEPS } = await import("./agent");
const { TOOLS, runTool, toolCatalog } = await import("./tools");
const { getLoopState, resetLoop, stepLoop } = await import("@/lib/optimizer");
const { listExperiments } = await import("@/lib/experiments/store");
const { simulateTraffic } = await import("@/lib/simulator");
const { getGithubStatus } = await import("@/lib/github");
const listPullRequests = () => getGithubStatus().recentPullRequests;
const { isProtectedPath } = await import("@/lib/auth/admin");
const { proxy, config: proxyConfig } = await import("@/proxy");
const { POST } = await import("@/app/api/assistant/route");

const user = (content: string) => [{ role: "user" as const, content }];
const env = { ...process.env };

beforeEach(async () => {
  llm.available = false;
  llm.responses = [];
  llm.calls = [];
  await resetLoop();
});

afterEach(() => {
  process.env = { ...env };
});

describe("tool registry", () => {
  it("marks exactly the side-effecting tools as confirm-required", () => {
    const confirm = Object.values(TOOLS)
      .filter((t) => "requiresConfirm" in t && t.requiresConfirm)
      .map((t) => t.name)
      .sort();
    expect(confirm).toEqual(["reset_loop", "set_autopilot", "ship_winner"]);
  });

  it("validates arguments and never throws", async () => {
    const bad = await runTool("run_simulation", { humans: -5 });
    expect(bad.ok).toBe(false);
    expect(bad.summary).toMatch(/Bad arguments/);
    const unknown = await runTool("drop_database", {});
    expect(unknown.ok).toBe(false);
  });

  it("describes every tool (with its args) for the model", () => {
    const catalog = toolCatalog();
    for (const name of Object.keys(TOOLS)) expect(catalog).toContain(`- ${name}`);
    expect(catalog).toMatch(/ship_winner \[asks the merchant to confirm first\]/);
    expect(catalog).toMatch(/"humans"/);
  });
});

describe("heuristic intent router", () => {
  it.each([
    ["How are we doing?", "get_kpis"],
    ["what's our conversion rate", "get_kpis"],
    ["run the loop", "step_loop"],
    ["step", "step_loop"],
    ["where is the loop at?", "loop_status"],
    ["turn autopilot on", "set_autopilot"],
    ["autopilot off please", "set_autopilot"],
    ["ship the winner", "ship_winner"],
    ["show me the experiments", "list_experiments"],
    ["chart coupon codes per minute", "add_chart"],
    ["show my dashboards", "list_dashboards"],
    ["simulate 300 shoppers and 10 agents", "run_simulation"],
    ["audit allbirds.com", "audit_readiness"],
    ["certify https://shop.example.com", "certify_store"],
    ["send a shopper for running shoes under £100", "send_test_shopper"],
    ["agent funnel", "agent_funnel"],
    ["suggest personalization ideas", "suggest_web_rules"],
    ["reset everything", "reset_loop"],
  ])("%s → %s", (message, tool) => {
    expect(routeIntent(message).calls[0]?.tool).toBe(tool);
  });

  it("pulls arguments out of the message", () => {
    expect(routeIntent("autopilot off").calls[0].args).toEqual({ on: false });
    expect(routeIntent("start autopilot").calls[0].args).toEqual({ on: true });
    expect(routeIntent("simulate 300 shoppers and 10 agents").calls[0].args).toEqual({ humans: 300, agents: 10 });
    expect(routeIntent("audit https://allbirds.com/, please").calls[0].args).toEqual({ url: "https://allbirds.com/" });
    expect(routeIntent("send a shopper for trail shoes under £140").calls[0].args).toEqual({ brief: "trail shoes under £140" });
  });

  it("answers help without tools and asks for a URL when one is missing", () => {
    expect(routeIntent("help").calls).toEqual([]);
    expect(routeIntent("help").reply).toMatch(/managing assistant/);
    const audit = routeIntent("can you run a readiness audit?");
    expect(audit.calls).toEqual([]);
    expect(audit.reply).toMatch(/URL/);
  });

  it("replies from real data with no LLM key", async () => {
    const empty = await runAssistant({ messages: user("How are we doing?") });
    expect(empty.model).toBe("heuristic");
    expect(empty.actions.map((a) => a.tool)).toEqual(["get_kpis"]);
    expect(empty.reply).toMatch(/no visitors yet/);
    expect(empty.actions[0].synthetic).toBeUndefined();

    const sim = await simulateTraffic({ humans: 40, agents: 0, seed: 7 });
    const res = await runAssistant({ messages: user("How are we doing?") });
    expect(res.reply).toContain(`${sim.humans} visitors`);
    expect(res.reply).toMatch(/simulated traffic \(synthetic\)/);
    expect(res.actions[0].synthetic).toBe(true);
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  it("labels simulations it runs as synthetic", async () => {
    const res = await runAssistant({ messages: user("simulate 25 shoppers and 0 agents") });
    expect(res.actions[0]).toMatchObject({ tool: "run_simulation", ok: true, synthetic: true, args: { humans: 25, agents: 0 } });
    expect(res.reply).toMatch(/Simulated 25 humans and 0 AI agents \(synthetic\)/);
  });

  it("steps the loop", async () => {
    const res = await runAssistant({ messages: user("run the loop") });
    expect(res.actions[0]).toMatchObject({ tool: "step_loop", ok: true });
    expect(getLoopState().phase).toBe("observe");
    expect(res.reply).toMatch(/idle → observe/);
  });
});

describe("confirm flow", () => {
  it("asks before turning autopilot on, and only runs it once confirmed", async () => {
    const ask = await runAssistant({ messages: user("turn autopilot on") });
    expect(ask.actions).toEqual([]);
    expect(ask.pendingConfirm).toEqual({ tool: "set_autopilot", args: { on: true }, prompt: expect.stringMatching(/Turn autopilot on\?/) });
    expect(getLoopState().autopilot).toBe(false);

    const done = await runAssistant({ messages: user("turn autopilot on"), confirm: { ...ask.pendingConfirm!, approved: true } });
    expect(done.actions).toEqual([expect.objectContaining({ tool: "set_autopilot", ok: true })]);
    expect(done.pendingConfirm).toBeUndefined();
    expect(getLoopState().autopilot).toBe(true);
  });

  it("does nothing when cancelled", async () => {
    const ask = await runAssistant({ messages: user("reset everything") });
    expect(ask.pendingConfirm?.tool).toBe("reset_loop");
    const res = await runAssistant({ messages: user("reset everything"), confirm: { tool: "reset_loop", approved: false } });
    expect(res.actions).toEqual([]);
    expect(res.reply).toMatch(/cancelled/i);
  });

  it("refuses to 'confirm' a tool that doesn't need confirmation", async () => {
    const res = await runAssistant({ messages: [], confirm: { tool: "run_simulation", args: { humans: 5 }, approved: true } });
    expect(res.actions).toEqual([]);
    expect(res.reply).toMatch(/nothing to confirm/);
  });

  it("doesn't ask to ship when there's nothing to ship, and says why", async () => {
    delete process.env.DARWIN_TARGET_REPO;
    const noRepo = await runAssistant({ messages: user("ship the winner") });
    expect(noRepo.pendingConfirm).toBeUndefined();
    expect(noRepo.actions[0]).toMatchObject({ tool: "ship_winner", ok: false });
    expect(noRepo.actions[0].summary).toMatch(/no repository is connected/);

    process.env.DARWIN_TARGET_REPO = "acme/storefront";
    const nothing = await runAssistant({ messages: user("ship the winner") });
    expect(nothing.pendingConfirm).toBeUndefined();
    expect(nothing.actions[0].summary).toMatch(/Nothing to ship yet/);
  });

  it("ships a decided winner only after confirmation (dry-run PR without GITHUB_TOKEN)", async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.DARWIN_TARGET_REPO = "acme/storefront";
    // Run the real loop until an experiment is decided (synthetic traffic, heuristic designer).
    for (let i = 0; i < 16 && !listExperiments().some((e) => e.status === "completed"); i++) await stepLoop();
    const done = listExperiments().find((e) => e.status === "completed");
    expect(done).toBeDefined();

    const before = listPullRequests().length;
    const ask = await runAssistant({ messages: user("ship it") });
    expect(ask.pendingConfirm).toMatchObject({ tool: "ship_winner", prompt: expect.stringContaining(done!.name) });
    expect(ask.actions).toEqual([]);
    expect(listPullRequests().length).toBe(before);

    const res = await runAssistant({ messages: user("ship it"), confirm: { tool: "ship_winner", args: {}, approved: true } });
    expect(res.actions[0]).toMatchObject({ tool: "ship_winner", ok: true });
    expect(res.actions[0].summary).toMatch(/Dry run|up to date|opened|updated/);
    expect(listPullRequests().length).toBeGreaterThanOrEqual(before);
  }, 60_000);
});

describe("LLM tool loop (model mocked)", () => {
  beforeEach(() => {
    llm.available = true;
  });

  it("calls a tool, then replies, with history and a state snapshot in the prompt", async () => {
    llm.responses.push({ thought: "need numbers", tool: "get_kpis", args: {} }, { reply: "No visitors yet. Want me to start the loop?", suggestions: ["Run the loop"] });
    const res = await runAssistant({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello! How can I help?" },
        { role: "user", content: "How are we doing?" },
      ],
      context: { path: "/console" },
    });
    expect(res.model).toBe("llm:grok-test");
    expect(res.reply).toBe("No visitors yet. Want me to start the loop?");
    expect(res.suggestions).toEqual(["Run the loop"]);
    expect(res.actions.map((a) => a.tool)).toEqual(["get_kpis"]);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0].system).toMatch(/Darwin, your store's managing assistant/);
    expect(llm.calls[0].system).toMatch(/Never invent numbers/);
    expect(llm.calls[0].prompt).toMatch(/STATE \(live/);
    expect(llm.calls[0].prompt).toMatch(/"phase":"idle"/);
    expect(llm.calls[0].prompt).toMatch(/Merchant: hi\nDarwin: Hello! How can I help\?\nMerchant: How are we doing\?/);
    expect(llm.calls[1].prompt).toMatch(/1\. get_kpis\(\{\}\) → ok/);
  });

  it("returns a pending confirmation instead of running a side-effecting tool", async () => {
    llm.responses.push({ thought: "merchant asked", tool: "set_autopilot", args: { on: true } });
    const res = await runAssistant({ messages: user("put it on autopilot") });
    expect(res.pendingConfirm).toMatchObject({ tool: "set_autopilot", args: { on: true } });
    expect(res.actions).toEqual([]);
    expect(getLoopState().autopilot).toBe(false);

    llm.responses.push({ reply: "Autopilot is on." });
    const done = await runAssistant({ messages: user("put it on autopilot"), confirm: { tool: "set_autopilot", args: { on: true }, approved: true } });
    expect(getLoopState().autopilot).toBe(true);
    expect(done.reply).toBe("Autopilot is on.");
    expect(done.actions).toEqual([expect.objectContaining({ tool: "set_autopilot", ok: true })]);
    expect(llm.calls.at(-1)!.prompt).toMatch(/merchant confirmed set_autopilot/);
  });

  it("falls back to the keyword router when the model fails before doing anything", async () => {
    llm.responses.push(new Error("503 from xAI"));
    const res = await runAssistant({ messages: user("How are we doing?") });
    expect(res.model).toBe("heuristic");
    expect(res.actions.map((a) => a.tool)).toEqual(["get_kpis"]);
  });

  it("summarises the tools that ran if the model fails mid-turn", async () => {
    llm.responses.push({ tool: "loop_status", args: {} }, new Error("timeout"));
    const res = await runAssistant({ messages: user("status?") });
    expect(res.actions.map((a) => a.tool)).toEqual(["loop_status"]);
    expect(res.reply).toMatch(/Gen 0, phase “idle”/);
    expect(res.model).toBe("heuristic");
  });

  it("doesn't rerun a repeated call, reports unknown tools, and stops within MAX_STEPS", async () => {
    for (let i = 0; i < MAX_STEPS + 2; i++) llm.responses.push(i === 1 ? { tool: "hack_the_planet", args: {} } : { tool: "loop_status", args: {} });
    const res = await runAssistant({ messages: user("status?") });
    expect(llm.calls.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(res.actions.filter((a) => a.tool === "loop_status")).toHaveLength(1);
    expect(res.actions.find((a) => a.tool === "hack_the_planet")).toMatchObject({ ok: false });
    expect(res.reply.length).toBeGreaterThan(0);
  });
});

describe("POST /api/assistant", () => {
  it("is behind the admin gate", async () => {
    expect(isProtectedPath("/api/assistant")).toBe(true);
    expect(proxyConfig.matcher).toContain("/api/assistant");
    process.env.DARWIN_ADMIN_TOKEN = "s3cret";
    const { NextRequest } = await import("next/server");
    expect(proxy(new NextRequest("https://darwin.example/api/assistant", { method: "POST" })).status).toBe(401);
    const ok = proxy(new NextRequest("https://darwin.example/api/assistant", { method: "POST", headers: { authorization: "Bearer s3cret" } }));
    expect(ok.status).toBe(200);
  });

  it("validates the body and answers a turn", async () => {
    const bad = await POST(new Request("http://x/api/assistant", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(400);
    const ok = await POST(new Request("http://x/api/assistant", { method: "POST", body: JSON.stringify({ messages: user("help") }) }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ model: "heuristic", actions: [] });
    expect(body.reply).toMatch(/Audit shop\.example\.com/);
  });
});
