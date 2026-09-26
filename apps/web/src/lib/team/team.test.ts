/**
 * Darwin's agent team: heuristic routing (no LLM key), delegation concurrency, group chats created by agents,
 * the confirm gate, Pixel's changeset → PR flow, and provider routing / fallback. The OpenAI SDK is mocked;
 * the real LLM client (runToolLoop) drives it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, TeamEvent } from "@/lib/contracts";

type CreateParams = { model: string; messages: { role: string; content: unknown }[]; tools?: unknown[] };
const oa = vi.hoisted(() => ({
  create: vi.fn<(p: CreateParams, baseURL: string) => Promise<unknown>>(),
}));
vi.mock("openai", () => ({
  default: class {
    baseURL: string;
    constructor(o: { baseURL?: string }) {
      this.baseURL = o?.baseURL ?? "";
    }
    chat = { completions: { create: (p: CreateParams) => oa.create(p, this.baseURL) } };
  },
}));

const toolCalls = (...list: [string, Record<string, unknown>][]) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: list.map(([name, args], i) => ({ id: `c${i}_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } })),
      },
    },
  ],
});
const text = (content: string) => ({ choices: [{ message: { content } }] });
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const KEYS = [
  "LLM_PROVIDER",
  "XAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "APINEX_API_KEY",
  "APINEX_MODEL",
  "APINEX_EDITOR_MODEL",
  "LLM_OVERFLOW_AT",
  "GITHUB_TOKEN",
  "DARWIN_TARGET_REPO",
];

const { runTeamTurn, resetTeam, getTeamState, getChatView, createUserChat, planHeuristic, limiter } = await import("./index");
const { getLoopState, resetLoop, stepLoop } = await import("@/lib/optimizer");
const llm = await import("@/lib/llm/client");
const { POST } = await import("@/app/api/team/chat/route");

const env = { ...process.env };

beforeEach(async () => {
  for (const k of KEYS) delete process.env[k];
  oa.create.mockReset();
  resetTeam();
  await resetLoop();
});
afterEach(() => {
  process.env = { ...env };
});

async function turn(input: Parameters<typeof runTeamTurn>[0]) {
  const events: TeamEvent[] = [];
  await runTeamTurn(input, (e) => events.push(e));
  return events;
}
const messages = (events: TeamEvent[]) => events.flatMap((e) => (e.type === "message" ? [e.message] : []));
const who = (p: CreateParams) => String(p.messages[0].content).match(/^You are (\w+)/)?.[1].toLowerCase() ?? "?";
const hasToolResults = (p: CreateParams) => p.messages.some((m) => m.role === "tool");

/* ------------------------------------------------------------------ heuristic path (no LLM key) */

describe("heuristic team (no LLM key)", () => {
  it("splits a multi-part ask into a group chat with concurrent specialists and a report", async () => {
    const events = await turn({ text: "How are we doing and show experiments" });
    const group = events.find((e) => e.type === "chat_created" && e.chat.kind === "group");
    expect(group && group.type === "chat_created" && group.chat.members).toEqual(["darwin", "iris", "fizz"]);
    const groupId = group && group.type === "chat_created" ? group.chat.id : "";
    const msgs = messages(events);
    expect(msgs.some((m) => m.chatId === groupId && m.from === "iris" && m.kind === "progress")).toBe(true);
    expect(msgs.some((m) => m.chatId === groupId && m.from === "fizz" && m.kind === "report")).toBe(true);
    // Both specialists started before either reported (they ran concurrently).
    const idx = (pred: (e: TeamEvent) => boolean) => events.findIndex(pred);
    const fizzStart = idx((e) => e.type === "agent_status" && e.agent === "fizz" && e.state === "thinking");
    const irisReport = idx((e) => e.type === "message" && e.message.from === "iris" && e.message.kind === "report");
    expect(fizzStart).toBeGreaterThan(-1);
    expect(fizzStart).toBeLessThan(irisReport);
    const report = msgs.find((m) => m.from === "darwin" && m.kind === "report");
    expect(report?.text).toMatch(/Iris: [^]*\n- Fizz: /);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", model: "heuristic" });
    // Progress lines are short.
    for (const m of msgs.filter((x) => x.kind === "progress")) expect(m.text.length).toBeLessThanOrEqual(140);
  });

  it("routes a single ask to one specialist in the same chat (no group chat)", async () => {
    const events = await turn({ text: "show experiments" });
    expect(events.some((e) => e.type === "chat_created" && e.chat.kind === "group")).toBe(false);
    const report = messages(events).find((m) => m.kind === "report");
    expect(report).toMatchObject({ from: "fizz", tool: "list_experiments" });
    expect(messages(events).filter((m) => m.kind === "tool")).toHaveLength(0); // the report carries the single result
    const direct = await turn({ agentId: "fizz", text: "show experiments" });
    expect(messages(direct).map((m) => `${m.from}:${m.kind}`)).toEqual(["user:text", "fizz:progress", "fizz:report"]);
  });

  it("keeps fragments with their clause (\"200 humans and 20 agents\")", () => {
    const plan = planHeuristic("simulate 200 humans and 20 agents");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ agent: "fizz", calls: [{ tool: "run_simulation", args: { humans: 200, agents: 20 } }] });
    expect(planHeuristic("open the dashboards page").darwin).toEqual([{ tool: "navigate", args: { href: "/console/dashboards" } }]);
    expect(planHeuristic("merge PR #12").items[0]).toMatchObject({ agent: "dash", calls: [{ tool: "merge_pr", args: { number: 12 } }] });
    expect(planHeuristic("change the hero headline to Run further").items[0].agent).toBe("pixel");
  });

  it("navigates with an allowed in-app href only", async () => {
    const events = await turn({ text: "take me to the research page" });
    expect(events).toContainEqual({ type: "navigate", href: "/console/research", agent: "darwin" });
    const bad = await turn({ agentId: "iris", text: "hello" });
    expect(bad.some((e) => e.type === "navigate")).toBe(false);
  });
});

/* ------------------------------------------------------------------ confirm gate */

describe("confirm gate", () => {
  it("never runs a side-effecting tool until the merchant confirms", async () => {
    await stepLoop();
    const before = getLoopState();
    expect(before.phase).not.toBe("idle");
    const events = await turn({ text: "reset the loop" });
    const confirm = messages(events).find((m) => m.kind === "confirm");
    expect(confirm).toMatchObject({ from: "fizz", tool: "reset_loop" });
    expect(confirm?.pendingConfirm?.id).toBeTruthy();
    expect(getLoopState().phase).toBe(before.phase); // not reset

    const answer = await turn({ text: "", confirm: { id: confirm!.pendingConfirm!.id, approved: true } });
    const updated = messages(answer).find((m) => m.id === confirm!.id);
    expect(updated?.pendingConfirm?.resolved).toBe("approved");
    expect(getLoopState().phase).toBe("idle");
    expect(messages(answer).some((m) => m.from === "fizz" && m.kind === "report" && /Reset done/.test(m.text))).toBe(true);

    // Answering twice does nothing.
    const again = await turn({ text: "", confirm: { id: confirm!.pendingConfirm!.id, approved: true } });
    expect(messages(again).at(-1)?.text).toMatch(/already answered/);
  });

  it("cancels cleanly", async () => {
    const events = await turn({ text: "autopilot on" });
    const confirm = messages(events).find((m) => m.kind === "confirm")!;
    const answer = await turn({ text: "", confirm: { id: confirm.pendingConfirm!.id, approved: false } });
    expect(getLoopState().autopilot).toBe(false);
    expect(messages(answer).find((m) => m.id === confirm.id)?.pendingConfirm?.resolved).toBe("cancelled");
  });
});

/* ------------------------------------------------------------------ LLM path */

describe("LLM team", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test";
  });

  it("runs delegations concurrently in a group chat and reports back", async () => {
    let active = 0;
    let maxActive = 0;
    oa.create.mockImplementation(async (p) => {
      const agent = who(p);
      if (agent === "darwin")
        return hasToolResults(p)
          ? text("Iris: 4 visitors. Fizz: loop is at observe. Want me to step it?")
          : toolCalls(["delegate", { agent: "iris", task: "Get KPIs" }], ["delegate", { agent: "fizz", task: "Loop status" }]);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return text(`${agent} done`);
    });
    const events = await turn({ text: "Give me the numbers and the loop status" });
    expect(maxActive).toBe(2);
    const group = events.find((e) => e.type === "chat_created" && e.chat.kind === "group");
    expect(group).toMatchObject({ chat: { createdBy: "darwin" } });
    const members = events.filter((e) => e.type === "chat_updated" && e.chat.kind === "group").at(-1);
    expect(members && members.type === "chat_updated" && members.chat.members).toEqual(expect.arrayContaining(["darwin", "iris", "fizz"]));
    const msgs = messages(events);
    expect(msgs.filter((m) => m.kind === "report" && (m.from === "iris" || m.from === "fizz"))).toHaveLength(2);
    expect(msgs.at(-1)).toMatchObject({ from: "darwin", kind: "report", text: expect.stringMatching(/Want me to step it/) });
    expect(events.at(-1)).toMatchObject({ type: "done", model: "llm:deepseek/deepseek-v4-flash" });
  });

  it("lets a specialist open its own group chat and ask a teammate (depth 1)", async () => {
    oa.create.mockImplementation(async (p) => {
      const agent = who(p);
      const n = oa.create.mock.calls.filter(([q]) => who(q) === agent).length;
      if (agent === "darwin") return hasToolResults(p) ? text("Done.") : toolCalls(["delegate", { agent: "iris", task: "Check numbers with Fizz" }]);
      if (agent === "iris") {
        if (n === 1) return toolCalls(["start_group_chat", { title: "Numbers room", members: ["fizz"], goal: "Compare notes" }]);
        if (n === 2) return toolCalls(["ask", { agent: "fizz", question: "Is a test running?" }]);
        return text("Fizz says no test is running.");
      }
      if (agent === "fizz") {
        // Depth 1: no ask tool offered.
        expect((p.tools as { function: { name: string } }[]).some((t) => t.function.name === "ask")).toBe(false);
        return text("No test is running.");
      }
      return text("?");
    });
    const events = await turn({ text: "check the numbers" });
    const byIris = events.find((e) => e.type === "chat_created" && e.chat.createdBy === "iris");
    expect(byIris).toMatchObject({ chat: { title: "Numbers room", members: ["iris", "fizz"] } });
    const roomId = byIris && byIris.type === "chat_created" ? byIris.chat.id : "";
    const room = getChatView(roomId)!.messages;
    expect(room.some((m) => m.from === "iris" && m.text.startsWith("@Fizz"))).toBe(true);
    expect(room.some((m) => m.from === "fizz" && m.kind === "report" && /No test/.test(m.text))).toBe(true);
  });

  it("gates a specialist's side effect behind a confirm and stops its loop", async () => {
    await stepLoop();
    const phase = getLoopState().phase;
    oa.create.mockImplementation(async (p) => {
      const agent = who(p);
      if (agent === "darwin") return hasToolResults(p) ? text("Fizz needs your OK to reset.") : toolCalls(["delegate", { agent: "fizz", task: "Reset the loop" }]);
      if (agent === "fizz") return hasToolResults(p) ? text("should not be called") : toolCalls(["reset_loop", {}]);
      return text("?");
    });
    const events = await turn({ text: "start over" });
    expect(getLoopState().phase).toBe(phase);
    const confirm = messages(events).find((m) => m.kind === "confirm");
    expect(confirm).toMatchObject({ from: "fizz", tool: "reset_loop" });
    // The confirm lands in the merchant's chat, not the group chat.
    const direct = getTeamState().chats.find((c) => c.kind === "direct")!;
    expect(confirm?.chatId).toBe(direct.id);
    expect(oa.create.mock.calls.filter(([p]) => who(p) === "fizz")).toHaveLength(1);
    await turn({ text: "", confirm: { id: confirm!.pendingConfirm!.id, approved: true } });
    expect(getLoopState().phase).toBe("idle");
  });

  it("falls back to keyword routing when the model fails before doing anything", async () => {
    oa.create.mockRejectedValue(httpError(500, "upstream down"));
    const events = await turn({ text: "show experiments" });
    expect(events.at(-1)).toMatchObject({ type: "done", model: "heuristic" });
    expect(messages(events).some((m) => m.from === "fizz" && m.kind === "report")).toBe(true);
  });

  it("Pixel codes on APINex's editor model; the changeset PR needs a confirm and shows the diff", async () => {
    process.env.APINEX_API_KEY = "apx";
    process.env.DARWIN_TARGET_REPO = "acme/storefront";
    const seen: { agent: string; model: string; base: string }[] = [];
    oa.create.mockImplementation(async (p, base) => {
      const agent = who(p);
      seen.push({ agent, model: p.model, base });
      const n = seen.filter((s) => s.agent === agent).length;
      if (agent === "darwin") return hasToolResults(p) ? text("Pixel prepared the PR.") : toolCalls(["delegate", { agent: "pixel", task: "Add a returns note" }]);
      if (agent === "pixel") {
        if (n === 1) return toolCalls(["write_file", { path: "src/returns.md", content: "Free returns for 60 days.\n" }]);
        if (n === 2) return toolCalls(["open_pr", { title: "Add returns note" }]);
      }
      return text("?");
    });
    const events = await turn({ text: "add a returns note to the site" });
    const pixel = seen.filter((s) => s.agent === "pixel");
    expect(pixel[0]).toMatchObject({ model: "anthropic/claude-opus-4.6", base: "https://api.apinex.bond/v1" });
    expect(seen.find((s) => s.agent === "darwin")).toMatchObject({ base: "https://openrouter.ai/api/v1" });
    const confirm = messages(events).find((m) => m.kind === "confirm")!;
    expect(confirm).toMatchObject({ from: "pixel", tool: "open_pr" });
    expect(confirm.pendingConfirm?.diff).toEqual([expect.objectContaining({ path: "src/returns.md", added: 2, preview: expect.stringContaining("+Free returns") })]);
    const answer = await turn({ text: "", confirm: { id: confirm.pendingConfirm!.id, approved: true } });
    const done = messages(answer).find((m: ChatMessage) => m.from === "pixel" && m.kind === "report");
    expect(done?.text).toMatch(/Dry run .*“Add returns note” on acme\/storefront/);
  });
});

/* ------------------------------------------------------------------ providers */

describe("provider routing", () => {
  it("picks APINex for the editor, hard tasks and OpenRouter overflow; OpenRouter otherwise", async () => {
    process.env.OPENROUTER_API_KEY = "or";
    expect(llm.pickProvider({ editor: true })).toMatchObject({ provider: "openrouter", reason: "default" }); // no APINex key
    process.env.APINEX_API_KEY = "apx";
    process.env.LLM_OVERFLOW_AT = "1";
    expect(llm.pickProvider()).toMatchObject({ provider: "openrouter", reason: "default" });
    expect(llm.pickProvider({ editor: true })).toEqual({ provider: "apinex", model: "anthropic/claude-opus-4.6", reason: "editor" });
    expect(llm.pickProvider({ hard: true })).toMatchObject({ provider: "apinex", reason: "hard" });
    let release!: () => void;
    oa.create.mockImplementationOnce(() => new Promise((r) => (release = () => r(text("slow")))));
    const slow = llm.generateText({ system: "s", prompt: "p" });
    await Promise.resolve();
    expect(llm.llmInFlight("openrouter")).toBe(1);
    expect(llm.pickProvider()).toMatchObject({ provider: "apinex", reason: "overflow" });
    release();
    await slow;
    expect(llm.pickProvider()).toMatchObject({ provider: "openrouter" });
    // APINex alone is picked when it's the only key.
    delete process.env.OPENROUTER_API_KEY;
    expect(llm.llmProvider()).toBe("apinex");
    expect(llm.llmModel()).toBe("free/gpt-6-luna");
  });

  it("falls back APINex ⇄ OpenRouter on 402/429/5xx", async () => {
    process.env.OPENROUTER_API_KEY = "or";
    process.env.APINEX_API_KEY = "apx";
    oa.create.mockImplementation(async (_p, base) => {
      if (base.includes("apinex")) throw httpError(402, "Payment required");
      return text("from openrouter");
    });
    expect(await llm.generateText({ system: "s", prompt: "p", provider: "apinex" })).toBe("from openrouter");
    const loop = await llm.runToolLoop({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [], execute: async () => ({ content: "" }), provider: "apinex" });
    expect(loop).toMatchObject({ text: "from openrouter", provider: "openrouter" });

    oa.create.mockReset();
    oa.create.mockImplementation(async (_p, base) => {
      if (base.includes("openrouter")) throw httpError(429, "Rate limited");
      return text("from apinex");
    });
    expect(await llm.generateText({ system: "s", prompt: "p" })).toBe("from apinex");
    // A bad request is not retried elsewhere.
    oa.create.mockReset();
    oa.create.mockRejectedValue(httpError(400, "bad prompt"));
    await expect(llm.generateText({ system: "s", prompt: "p" })).rejects.toThrow("bad prompt");
  });

  it("uses JSON tool calls when APINex rejects native tools", async () => {
    process.env.APINEX_API_KEY = "apx";
    oa.create
      .mockRejectedValueOnce(httpError(400, "Unsupported parameter"))
      .mockResolvedValueOnce(text('{"tool_calls":[{"name":"echo","args":{"v":1}}]}'))
      .mockResolvedValueOnce(text('{"answer":"done"}'));
    const calls: string[] = [];
    const res = await llm.runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "echo", description: "echo", parameters: { type: "object" } }],
      execute: async (c) => {
        calls.push(c.name);
        return { content: "ok" };
      },
      provider: "apinex",
    });
    expect(res).toMatchObject({ text: "done", mode: "json" });
    expect(calls).toEqual(["echo"]);
  });
});

/* ------------------------------------------------------------------ misc */

describe("team API", () => {
  it("bounds concurrency", async () => {
    const run = limiter(2);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        run(async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(max).toBe(2);
  });

  it("creates user chats (Darwin joins groups) and exposes state", () => {
    const direct = createUserChat({ members: ["iris"] });
    expect(direct).toMatchObject({ kind: "direct", members: ["iris"] });
    expect(createUserChat({ members: ["iris"] }).id).toBe(direct.id);
    const group = createUserChat({ members: ["pixel", "dash"] });
    expect(group).toMatchObject({ kind: "group", members: ["darwin", "pixel", "dash"], createdBy: "user" });
    const state = getTeamState();
    expect(state.agents.map((a) => a.id)).toEqual(["darwin", "iris", "pixel", "fizz", "dash"]);
    expect(state.chats).toHaveLength(2);
  });

  it("streams NDJSON from POST /api/team/chat", async () => {
    const res = await POST(new Request("http://localhost/api/team/chat", { method: "POST", body: JSON.stringify({ text: "show experiments" }) }));
    expect(res.headers.get("content-type")).toMatch(/ndjson/);
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as TeamEvent);
    expect(lines.at(-1)?.type).toBe("done");
    expect(lines.some((e) => e.type === "message" && e.message.from === "fizz")).toBe(true);
    const bad = await POST(new Request("http://localhost/api/team/chat", { method: "POST", body: "{}" }));
    expect(bad.status).toBe(400);
  });
});
