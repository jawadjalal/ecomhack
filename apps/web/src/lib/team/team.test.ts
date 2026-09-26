/**
 * The agent team: heuristic routing (no LLM), delegation concurrency and agent-created group chats (LLM mocked),
 * the confirm gate, and the LLM client's provider routing / fallback (real client, fetch stubbed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamEvent } from "@/lib/contracts/team";
import type { ToolLoopOptions, ToolLoopResult } from "@/lib/llm/team";

type Script = (opts: ToolLoopOptions) => Promise<Partial<ToolLoopResult> | string>;

const llm = vi.hoisted(() => ({
  available: false,
  /** Which script handles a loop: matched on the system prompt's first line. */
  scripts: [] as { match: RegExp; run: Script }[],
  loops: [] as { system: string; tools: string[]; route?: unknown }[],
}));

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/llm/client")>();
  return { ...real, llmAvailable: () => llm.available };
});

vi.mock("@/lib/llm/team", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/llm/team")>();
  return {
    ...real,
    routeLabel: () => (llm.available ? "llm:test-model" : "heuristic"),
    runToolLoop: async (opts: ToolLoopOptions): Promise<ToolLoopResult> => {
      llm.loops.push({ system: opts.system, tools: opts.tools.map((t) => t.name), route: opts.route });
      const script = llm.scripts.find((s) => s.match.test(opts.system));
      if (!script) throw new Error("no scripted loop");
      const out = await script.run(opts);
      const r = typeof out === "string" ? { text: out } : out;
      return { text: "", provider: "openrouter", model: "test-model", steps: 1, toolCalls: 0, mode: "tools", stopped: false, ...r };
    },
  };
});

const real = await vi.importActual<typeof import("@/lib/llm/team")>("@/lib/llm/team");
const { runTeamTurn, teamState, chatView, createUserChat, resetTeam, TEAM, MAX_PARALLEL } = await import("./index");
const { TEAM_TOOLS, META_TOOLS, safeHref } = await import("./tools");
const { splitAsk, routePart } = await import("./router");
const { getLoopState, resetLoop } = await import("@/lib/optimizer");
const { POST } = await import("@/app/api/team/chat/route");

async function turn(body: Parameters<typeof runTeamTurn>[0]) {
  const events: TeamEvent[] = [];
  await runTeamTurn(body, (e) => events.push(e));
  return events;
}
const messages = (events: TeamEvent[]) => events.flatMap((e) => (e.type === "message" ? [e.message] : []));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  llm.available = false;
  llm.scripts = [];
  llm.loops = [];
  resetTeam();
  await resetLoop();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("roster and tools", () => {
  it("every tool the roster shows exists in a registry, and names are unique per agent", () => {
    for (const agent of TEAM) {
      const names = (agent.tools ?? []).map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      for (const t of agent.tools ?? []) {
        expect(Boolean(TEAM_TOOLS[t.name]) || (META_TOOLS as readonly string[]).includes(t.name), `${agent.id}.${t.name}`).toBe(true);
        if (TEAM_TOOLS[t.name]) expect(!!TEAM_TOOLS[t.name].confirm, `${t.name} confirm flag`).toBe(!!t.confirm);
      }
    }
    expect(TEAM.find((a) => a.id === "darwin")?.mascot).toBe("leader");
  });

  it("navigate only allows Darwin's own pages", () => {
    expect(safeHref("dashboards")).toBe("/console/dashboards");
    expect(safeHref("/console/experiments?x=1")).toBe("/console/experiments?x=1");
    expect(safeHref("https://evil.example")).toBeUndefined();
    expect(safeHref("//evil.example")).toBeUndefined();
    expect(safeHref("/api/loop/reset")).toBeUndefined();
    expect(safeHref("/console/../api")).toBeUndefined();
  });

  it("splits multi-part asks and routes each part to its specialist", () => {
    expect(splitAsk("show my dashboards and list experiments, then ship the winner")).toEqual(["show my dashboards", "list experiments", "ship the winner"]);
    expect(routePart("audit allbirds.com").agent).toBe("iris");
    expect(routePart("merge PR #12")).toMatchObject({ agent: "dash", calls: [{ tool: "merge_pr", args: { number: 12 } }] });
    expect(routePart("change the headline to Free returns").agent).toBe("pixel");
    expect(routePart("open the experiments page").calls[0]).toEqual({ tool: "navigate", args: { page: "/console/experiments" } });
  });
});

describe("heuristic team (no LLM key)", () => {
  it("Darwin answers a simple ask itself with real tool results", async () => {
    const events = await turn({ text: "How are we doing?" });
    const msgs = messages(events);
    expect(msgs[0]).toMatchObject({ from: "user", text: "How are we doing?" });
    expect(msgs.find((m) => m.kind === "tool")).toMatchObject({ from: "darwin", tool: "get_kpis", ok: true });
    expect(msgs.at(-1)).toMatchObject({ from: "darwin", kind: "report" });
    expect(events.at(-1)).toMatchObject({ type: "done", model: "heuristic" });
    expect(events.some((e) => e.type === "chat_created" && e.chat.id === "chat_direct_darwin")).toBe(true);
  });

  it("a multi-part ask opens a group chat and runs the specialists with progress messages", async () => {
    const events = await turn({ text: "show my dashboards and list experiments and suggest personalization ideas" });
    const created = events.find((e) => e.type === "chat_created" && e.chat.kind === "group");
    expect(created).toBeTruthy();
    const group = created!.type === "chat_created" ? created!.chat : undefined;
    expect(group).toMatchObject({ createdBy: "darwin" });
    expect(group!.members).toEqual(expect.arrayContaining(["darwin", "iris", "fizz", "pixel"]));
    const inGroup = messages(events).filter((m) => m.chatId === group!.id);
    expect(inGroup.filter((m) => m.kind === "progress").every((m) => m.text.length <= 140)).toBe(true);
    expect(new Set(inGroup.filter((m) => m.kind === "tool").map((m) => m.from))).toEqual(new Set(["iris", "fizz", "pixel"]));
    expect(events.filter((e) => e.type === "progress").length).toBeGreaterThanOrEqual(3);
    const report = messages(events).at(-1)!;
    expect(report).toMatchObject({ from: "darwin", kind: "report", chatId: "chat_direct_darwin" });
    expect(report.text).toMatch(/Iris:/);
    // Persisted and listed.
    expect(chatView(group!.id)?.messages.length).toBe(inGroup.length);
    expect(teamState().chats.map((c) => c.id)).toContain(group!.id);
  });

  it("on onboarding, hello gets the team intro and no tools run", async () => {
    const events = await turn({ agentId: "darwin", text: "hi", context: { path: "/onboarding" } });
    const msgs = messages(events);
    expect(msgs.some((m) => m.kind === "tool")).toBe(false);
    expect(msgs.at(-1)?.text).toMatch(/Iris[\s\S]*Pixel[\s\S]*Fizz[\s\S]*Dash/);
  });

  it("navigate emits a navigate event with an allowed href", async () => {
    const events = await turn({ text: "take me to the dashboards page" });
    expect(events).toContainEqual({ type: "navigate", href: "/console/dashboards" });
  });

  it("the user can talk to a specialist directly", async () => {
    const events = await turn({ agentId: "fizz", text: "show experiments" });
    const msgs = messages(events);
    expect(msgs.every((m) => m.chatId === "chat_direct_fizz")).toBe(true);
    expect(msgs.find((m) => m.kind === "tool")).toMatchObject({ from: "fizz", tool: "list_experiments" });
    expect(msgs.at(-1)).toMatchObject({ from: "fizz", kind: "report" });
  });
});

describe("confirm gate", () => {
  it("side-effecting tools wait for the merchant, run once on approval, and can be cancelled", async () => {
    const events = await turn({ text: "turn autopilot on" });
    const ask = messages(events).find((m) => m.kind === "confirm");
    expect(ask).toMatchObject({ from: "fizz", tool: "set_autopilot", chatId: "chat_direct_darwin" });
    expect(ask!.pendingConfirm).toMatchObject({ agent: "fizz", tool: "set_autopilot", args: { on: true } });
    expect(getLoopState().autopilot).toBe(false);

    const done = await turn({ text: "", confirm: { id: ask!.pendingConfirm!.id, approved: true } });
    expect(messages(done).at(-1)).toMatchObject({ from: "fizz", kind: "report", ok: true });
    expect(getLoopState().autopilot).toBe(true);
    // Cleared from the stored message; a second approval does nothing.
    expect(chatView("chat_direct_darwin")!.messages.find((m) => m.id === ask!.id)?.pendingConfirm).toBeUndefined();
    const again = await turn({ text: "", confirm: { id: ask!.pendingConfirm!.id, approved: true } });
    expect(messages(again).at(-1)?.text).toMatch(/nothing waiting/i);

    const off = await turn({ text: "autopilot off" });
    const ask2 = messages(off).find((m) => m.kind === "confirm")!;
    const cancelled = await turn({ text: "", confirm: { id: ask2.pendingConfirm!.id, approved: false } });
    expect(messages(cancelled).at(-1)?.text).toMatch(/cancelled/i);
    expect(getLoopState().autopilot).toBe(true);
  });

  it("merge_pr from the LLM path asks first and never touches GitHub until approved (then previews without a token)", async () => {
    vi.stubEnv("DARWIN_TARGET_REPO", "acme/storefront");
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchSpy = vi.fn(async () => Response.json({}, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    llm.available = true;
    llm.scripts = [
      { match: /team lead/, run: async (o) => (await o.onToolCall({ name: "delegate", args: { tasks: [{ agent: "dash", task: "merge PR 7" }] } }), "Dash is waiting for your OK to merge #7.") },
      { match: /You are Dash/, run: async (o) => (await o.onToolCall({ name: "merge_pr", args: { number: 7 } })).content },
    ];
    const events = await turn({ text: "merge pr 7" });
    const ask = messages(events).find((m) => m.kind === "confirm")!;
    expect(ask.pendingConfirm).toMatchObject({ agent: "dash", tool: "merge_pr", args: { number: 7 } });
    expect(ask.text).toMatch(/acme\/storefront#7/);
    expect(fetchSpy).not.toHaveBeenCalled();

    const done = await turn({ text: "", confirm: { id: ask.pendingConfirm!.id, approved: true } });
    expect(messages(done).at(-1)?.text).toMatch(/Preview only: would squash-merge acme\/storefront#7/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("LLM team (mocked model)", () => {
  it("Darwin's delegations run concurrently (bounded) in a group chat, then Darwin reports", async () => {
    llm.available = true;
    let inFlight = 0;
    let peak = 0;
    const specialist: Script = async (o) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(30);
      inFlight--;
      return `done: ${o.messages[0].content}`;
    };
    llm.scripts = [
      {
        match: /team lead/,
        run: async (o) => {
          const r = await o.onToolCall({
            name: "delegate",
            args: {
              title: "Launch prep",
              tasks: [
                { agent: "iris", task: "check KPIs" },
                { agent: "fizz", task: "list tests" },
                { agent: "pixel", task: "suggest rules" },
                { agent: "dash", task: "pr status", hard: true },
              ],
            },
          });
          return (await o.onToolCall({ name: "report", args: { text: `All four reported. ${r.content.split("\n").length} results.` } })).stopText ?? "";
        },
      },
      { match: /You are (Iris|Fizz|Pixel|Dash)/, run: specialist },
    ];
    const events = await turn({ text: "get us ready for launch" });
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(MAX_PARALLEL);
    const group = events.find((e) => e.type === "chat_created" && e.chat.kind === "group");
    expect(group && group.type === "chat_created" && group.chat).toMatchObject({ title: "Launch prep", createdBy: "darwin" });
    expect(messages(events).at(-1)).toMatchObject({ from: "darwin", kind: "report", text: "All four reported. 4 results." });
    expect(events.at(-1)).toMatchObject({ type: "done", model: "llm:test-model" });
    // Pixel runs on the editor route; the others on the default.
    expect(llm.loops.find((l) => /You are Pixel/.test(l.system))?.route).toEqual({ role: "editor" });
    expect(llm.loops.find((l) => /You are Iris/.test(l.system))?.tools).toContain("ask");
    expect(llm.loops.find((l) => /You are Dash/.test(l.system))?.route).toEqual({ hard: true });
    expect(llm.loops.find((l) => /You are Iris/.test(l.system))?.route).toEqual({});
  });

  it("Darwin can open a group chat itself and post in it; specialists can ask each other once", async () => {
    llm.available = true;
    llm.scripts = [
      {
        match: /team lead/,
        run: async (o) => {
          await o.onToolCall({ name: "start_group_chat", args: { title: "Pricing review", members: ["iris", "fizz"], goal: "Find out why checkout drops" } });
          await o.onToolCall({ name: "post", args: { text: "Iris, look at the funnel first." } });
          await o.onToolCall({ name: "delegate", args: { tasks: [{ agent: "iris", task: "why does checkout drop?" }] } });
          return "Iris checked with Fizz.";
        },
      },
      {
        match: /You are Iris/,
        run: async (o) => {
          const a = await o.onToolCall({ name: "ask", args: { agent: "fizz", question: "any test on checkout?" } });
          return `Fizz says: ${a.content}`;
        },
      },
      {
        match: /You are Fizz/,
        run: async (o) => {
          const nested = await o.onToolCall({ name: "ask", args: { agent: "iris", question: "loop?" } });
          return nested.content.includes("can't") ? "No nested asks; none running." : "unexpected";
        },
      },
    ];
    const events = await turn({ text: "look into checkout" });
    const created = events.filter((e) => e.type === "chat_created" && e.chat.kind === "group");
    expect(created).toHaveLength(1);
    const chat = created[0].type === "chat_created" ? created[0].chat : undefined;
    expect(chat).toMatchObject({ title: "Pricing review", createdBy: "darwin", members: ["darwin", "iris", "fizz"] });
    const inGroup = messages(events).filter((m) => m.chatId === chat!.id);
    expect(inGroup.map((m) => m.text)).toEqual(expect.arrayContaining(["Find out why checkout drops", "Iris, look at the funnel first.", "@Fizz any test on checkout?"]));
    expect(inGroup.find((m) => m.from === "fizz" && m.kind === "text")?.text).toBe("No nested asks; none running.");
    expect(messages(events).at(-1)).toMatchObject({ chatId: "chat_direct_darwin", kind: "report", text: "Iris checked with Fizz." });
  });

  it("falls back to keyword routing when the model fails before acting", async () => {
    llm.available = true;
    llm.scripts = []; // every loop throws
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = await turn({ text: "show experiments" });
    expect(messages(events).find((m) => m.kind === "tool")).toMatchObject({ tool: "list_experiments", ok: true });
    expect(events.at(-1)).toMatchObject({ type: "done", model: "heuristic" });
  });
});

describe("chats API", () => {
  it("creates user chats and streams NDJSON ending in done", async () => {
    const group = createUserChat({ members: ["iris", "pixel"] });
    expect(group).toMatchObject({ kind: "group", createdBy: "user", members: ["darwin", "iris", "pixel"] });
    expect(createUserChat({ members: ["dash"] })).toMatchObject({ id: "chat_direct_dash", kind: "direct" });

    const res = await POST(new Request("http://localhost/api/team/chat", { method: "POST", body: JSON.stringify({ text: "how are we doing?" }) }));
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as TeamEvent);
    expect(lines.at(-1)).toMatchObject({ type: "done", chatId: "chat_direct_darwin" });
    expect(lines.some((e) => e.type === "message" && e.message.kind === "report")).toBe(true);

    const bad = await POST(new Request("http://localhost/api/team/chat", { method: "POST", body: JSON.stringify({ text: "" }) }));
    expect(bad.status).toBe(400);
    const missing = await POST(new Request("http://localhost/api/team/chat", { method: "POST", body: JSON.stringify({ chatId: "chat_nope", text: "hi" }) }));
    const last = JSON.parse((await missing.text()).trim().split("\n").at(-1)!);
    expect(last).toMatchObject({ type: "done", error: expect.stringMatching(/404/) });
  });
});

describe("provider routing (real client)", () => {
  const clear = () => {
    for (const k of ["LLM_PROVIDER", "XAI_API_KEY", "ANTHROPIC_API_KEY", "APINEX_API_KEY", "APINEX_MODEL", "APINEX_EDITOR_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_REASONING", "OPENROUTER_MAX_CONCURRENT"])
      vi.stubEnv(k, "");
  };

  it("DeepSeek via OpenRouter by default; APINex for the editor, hard tasks and overflow", () => {
    clear();
    expect(real.routeProviders()).toEqual([]);
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(real.routeProviders()).toEqual(["openrouter"]);
    expect(real.routeLabel()).toBe("llm:deepseek/deepseek-v4-flash");
    vi.stubEnv("APINEX_API_KEY", "ax");
    expect(real.routeProviders()).toEqual(["openrouter", "apinex"]);
    expect(real.routeProviders({ role: "editor" })).toEqual(["apinex", "openrouter"]);
    expect(real.routeProviders({ hard: true })[0]).toBe("apinex");
    vi.stubEnv("APINEX_EDITOR_MODEL", "anthropic/opus-test");
    expect(real.routeLabel({ role: "editor" })).toBe("llm:anthropic/opus-test");
    expect(real.routeLabel()).toBe("llm:deepseek/deepseek-v4-flash");
    // Overflow: OpenRouter at its concurrency limit → APINex first.
    vi.stubEnv("OPENROUTER_MAX_CONCURRENT", "2");
    const inflight = (globalThis as unknown as { __darwinLlmInFlight: Record<string, number> }).__darwinLlmInFlight;
    inflight.openrouter = 2;
    try {
      expect(real.routeProviders()).toEqual(["apinex", "openrouter"]);
    } finally {
      inflight.openrouter = 0;
    }
    vi.stubEnv("LLM_PROVIDER", "none");
    expect(real.routeProviders()).toEqual([]);
  });

  function stubProviders(handlers: { apinex?: (body: Record<string, unknown>) => Response; openrouter?: (body: Record<string, unknown>) => Response }) {
    const calls: { host: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const host = url.includes("apinex") ? "apinex" : "openrouter";
      calls.push({ host, body });
      const h = handlers[host as "apinex" | "openrouter"];
      return h ? h(body) : Response.json({ error: { message: "down" } }, { status: 503 });
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return calls;
  }
  const completion = (message: Record<string, unknown>) =>
    Response.json({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null, ...message } }] });

  it("runToolLoop: APINex out of credit (402) → OpenRouter; parallel tool calls run; answer returned", async () => {
    clear();
    vi.stubEnv("APINEX_API_KEY", "ax");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    let turnNo = 0;
    const calls = stubProviders({
      apinex: () => Response.json({ error: { message: "Daily check-in required", type: "billing_error" } }, { status: 402 }),
      openrouter: () =>
        ++turnNo === 1
          ? completion({ tool_calls: [{ id: "a", type: "function", function: { name: "get_kpis", arguments: "{}" } }, { id: "b", type: "function", function: { name: "loop_status", arguments: "{}" } }] })
          : completion({ content: "Conversion is 3%." }),
    });
    const ran: string[] = [];
    const res = await real.runToolLoop({
      system: "sys",
      messages: [{ role: "user", content: "how?" }],
      tools: [
        { name: "get_kpis", description: "k", parameters: { type: "object", properties: {} } },
        { name: "loop_status", description: "l", parameters: { type: "object", properties: {} } },
      ],
      route: { role: "editor" },
      onToolCall: async (c) => (ran.push(c.name), { content: "ok" }),
    });
    expect(res).toMatchObject({ text: "Conversion is 3%.", provider: "openrouter", toolCalls: 2, mode: "tools" });
    expect(ran.sort()).toEqual(["get_kpis", "loop_status"]);
    expect(calls[0].host).toBe("apinex");
    // Once APINex failed, the loop stays on the provider that works.
    expect(calls.slice(1).every((c) => c.host === "openrouter")).toBe(true);
    const last = calls.at(-1)!.body.messages as { role: string }[];
    expect(last.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("runToolLoop: a provider that rejects tools gets the JSON protocol", async () => {
    clear();
    vi.stubEnv("APINEX_API_KEY", "ax2");
    vi.stubEnv("APINEX_MODEL", "json-only-model");
    let n = 0;
    const calls = stubProviders({
      apinex: (body) =>
        body.tools
          ? Response.json({ error: { message: "tools are not supported for this model" } }, { status: 400 })
          : ++n === 1
            ? completion({ content: '{"tool":"get_kpis","args":{"realOnly":true}}' })
            : completion({ content: '{"reply":"Done from JSON mode."}' }),
    });
    const seen: unknown[] = [];
    const res = await real.runToolLoop({
      system: "sys",
      messages: [{ role: "user", content: "kpis" }],
      tools: [{ name: "get_kpis", description: "k", parameters: { type: "object", properties: { realOnly: { type: "boolean" } } } }],
      onToolCall: async (c) => (seen.push(c.args), { content: "ok: 10 visitors" }),
    });
    expect(res).toMatchObject({ text: "Done from JSON mode.", mode: "json", provider: "apinex" });
    expect(seen).toEqual([{ realOnly: true }]);
    expect(calls.every((c) => c.host === "apinex")).toBe(true);
  });

  it("runToolLoop throws when every provider fails (callers fall back to heuristics)", async () => {
    clear();
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    stubProviders({ openrouter: () => Response.json({ error: { message: "rate limited" } }, { status: 429 }) });
    await expect(real.runToolLoop({ system: "s", messages: [{ role: "user", content: "x" }], tools: [], onToolCall: async () => ({ content: "" }) })).rejects.toThrow();
  });
});
