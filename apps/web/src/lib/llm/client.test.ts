import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const oa = vi.hoisted(() => ({
  create: vi.fn(),
  opts: [] as Record<string, unknown>[],
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: oa.create } };
    constructor(o: Record<string, unknown>) {
      oa.opts.push(o);
    }
  },
}));

import {
  DEFAULT_OPENROUTER_MODEL,
  extractJson,
  llmLabel,
  llmProvider,
  resolveProvider,
  runToolLoop,
  toolFromZod,
  type LlmToolCall,
} from "./client";

describe("extractJson", () => {
  it("reads bare, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(
      extractJson('Here you go:\n```json\n{"a":[1,2]}\n```\nThanks'),
    ).toEqual({ a: [1, 2] });
    expect(
      extractJson('Sure! {"title":"x","nested":{"b":true}} hope that helps'),
    ).toEqual({ title: "x", nested: { b: true } });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());
  const clear = () => {
    for (const k of [
      "LLM_PROVIDER",
      "XAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
      "OPENROUTER_MODEL",
      "XAI_MODEL",
    ])
      vi.stubEnv(k, "");
  };

  it("falls back to heuristics with no keys", () => {
    clear();
    expect(llmProvider()).toBe("none");
    expect(llmLabel()).toBe("heuristic");
  });

  it("prefers OpenRouter (DeepSeek V4 Flash by default), then xAI, then Anthropic", () => {
    clear();
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(llmProvider()).toBe("anthropic");
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("XAI_MODEL", "grok-test");
    expect(llmProvider()).toBe("xai");
    expect(llmLabel()).toBe("llm:grok-test");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    expect(llmProvider()).toBe("openrouter");
    expect(DEFAULT_OPENROUTER_MODEL).toBe("deepseek/deepseek-v4-flash");
    expect(llmLabel()).toBe("llm:deepseek/deepseek-v4-flash");
    vi.stubEnv("OPENROUTER_MODEL", "other/model");
    expect(llmLabel()).toBe("llm:other/model");
  });

  it("honours LLM_PROVIDER when that provider has a key", () => {
    clear();
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("LLM_PROVIDER", "openrouter");
    expect(llmProvider()).toBe("openrouter");
    vi.stubEnv("LLM_PROVIDER", "none");
    expect(llmProvider()).toBe("none");
  });

  it("uses a per-request provider override only when that provider has a key", () => {
    clear();
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    expect(resolveProvider("xai")).toBe("anthropic");
    expect(llmLabel("xai")).toBe("llm:claude-opus-5");
    vi.stubEnv("XAI_API_KEY", "k");
    expect(llmProvider()).toBe("anthropic");
    expect(resolveProvider("xai")).toBe("xai");
    expect(llmLabel("xai")).toBe("llm:grok-4");
    vi.stubEnv("LLM_PROVIDER", "none");
    expect(resolveProvider("xai")).toBe("none");
  });
});

/* ------------------------------------------------------------------ runToolLoop (OpenAI client mocked) */

const calls = (...list: [string, Record<string, unknown>][]) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: list.map(([name, args], i) => ({
          id: `c${i}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        })),
      },
    },
  ],
});
const text = (content: string) => ({ choices: [{ message: { content } }] });
const TOOLS = [
  toolFromZod("lookup", "Look something up", z.object({ q: z.string() })),
  toolFromZod("act", "Change something", z.object({})),
];

describe("runToolLoop", () => {
  beforeEach(() => {
    for (const k of [
      "LLM_PROVIDER",
      "XAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_MODEL",
      "OPENROUTER_REASONING",
    ])
      vi.stubEnv(k, "");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    oa.create.mockReset();
    oa.opts.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("builds JSON-schema tools from zod", () => {
    expect(TOOLS[0].parameters).toMatchObject({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    });
    expect(TOOLS[1].parameters).toMatchObject({ type: "object" });
  });

  it("feeds tool results back as messages, runs parallel calls, then returns the answer", async () => {
    oa.create
      .mockResolvedValueOnce(
        calls(["lookup", { q: "a" }], ["lookup", { q: "b" }]),
      )
      .mockResolvedValueOnce(text("done: A B"));
    const seen: LlmToolCall[] = [];
    const out = await runToolLoop({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      execute: async (c) => {
        seen.push(c);
        return { content: String(c.args.q).toUpperCase() };
      },
    });
    expect(out).toMatchObject({
      text: "done: A B",
      mode: "native",
      steps: 2,
      stopped: false,
    });
    expect(seen.map((c) => c.args.q)).toEqual(["a", "b"]);
    const first = oa.create.mock.calls[0][0];
    expect(first.model).toBe("deepseek/deepseek-v4-flash");
    expect(first.tools[0]).toMatchObject({
      type: "function",
      function: { name: "lookup" },
    });
    expect(first.tool_choice).toBe("auto");
    const second = oa.create.mock.calls[1][0];
    expect(second.messages.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(second.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "c0",
      content: "A",
    });
    expect(oa.opts[0]).toMatchObject({
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "X-Title": "Darwin" },
    });
    expect(
      (oa.opts[0].defaultHeaders as Record<string, string>)["HTTP-Referer"],
    ).toBeTruthy();
  });

  it("stops when a tool asks to (confirm gate) and skips the rest of that turn", async () => {
    oa.create.mockResolvedValueOnce(calls(["act", {}], ["lookup", { q: "x" }]));
    const execute = vi.fn(async (c: LlmToolCall) =>
      c.name === "act"
        ? { content: "waiting", stop: true }
        : { content: "ran" },
    );
    const out = await runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "do it" }],
      tools: TOOLS,
      execute,
    });
    expect(out.stopped).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(oa.create).toHaveBeenCalledTimes(1);
  });

  it("is bounded by maxSteps: the last turn disables tools", async () => {
    oa.create.mockResolvedValue(calls(["lookup", { q: "again" }]));
    const execute = vi.fn(async () => ({ content: "ok" }));
    const out = await runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "loop" }],
      tools: TOOLS,
      execute,
      maxSteps: 2,
    });
    expect(oa.create).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(oa.create.mock.calls[2][0].tool_choice).toBe("none");
    expect(out.stopped).toBe(false);
  });

  it("falls back to prompted-JSON tool calls when the model rejects tools", async () => {
    oa.create
      .mockRejectedValueOnce(
        Object.assign(new Error("No endpoints found that support tool use"), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(
        text('{"tool_calls":[{"name":"lookup","args":{"q":"z"}}]}'),
      )
      .mockResolvedValueOnce(text('{"answer":"Z it is"}'));
    const execute = vi.fn(async () => ({ content: "Z" }));
    const out = await runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: TOOLS,
      execute,
    });
    expect(out).toMatchObject({ text: "Z it is", mode: "json" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "lookup", args: { q: "z" } }),
    );
    expect(oa.create.mock.calls[1][0].tools).toBeUndefined();
  });

  it("rethrows other errors and refuses without a key", async () => {
    oa.create.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { status: 429 }),
    );
    await expect(
      runToolLoop({
        system: "s",
        messages: [{ role: "user", content: "q" }],
        tools: TOOLS,
        execute: async () => ({ content: "" }),
      }),
    ).rejects.toThrow(/rate limited/);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(
      runToolLoop({
        system: "s",
        messages: [],
        tools: TOOLS,
        execute: async () => ({ content: "" }),
      }),
    ).rejects.toThrow(/No LLM provider/);
  });
});
