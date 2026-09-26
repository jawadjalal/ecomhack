import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, generateText, llmLabel, llmProvider, resolveProvider } from "./client";

describe("extractJson", () => {
  it("reads bare, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here you go:\n```json\n{"a":[1,2]}\n```\nThanks')).toEqual({ a: [1, 2] });
    expect(extractJson('Sure! {"title":"x","nested":{"b":true}} hope that helps')).toEqual({ title: "x", nested: { b: true } });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());
  const clear = () => {
    for (const k of ["LLM_PROVIDER", "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "XAI_MODEL"]) vi.stubEnv(k, "");
  };

  it("falls back to heuristics with no keys", () => {
    clear();
    expect(llmProvider()).toBe("none");
    expect(llmLabel()).toBe("heuristic");
  });

  it("prefers xAI (sponsor), then Anthropic, then OpenRouter", () => {
    clear();
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    expect(llmProvider()).toBe("openrouter");
    expect(llmLabel()).toBe("llm:deepseek/deepseek-chat");
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(llmProvider()).toBe("anthropic");
    vi.stubEnv("XAI_API_KEY", "k");
    vi.stubEnv("XAI_MODEL", "grok-test");
    expect(llmProvider()).toBe("xai");
    expect(llmLabel()).toBe("llm:grok-test");
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

describe("xAI → OpenRouter fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const completion = (model: string, content: string) =>
    Response.json({ id: "c1", object: "chat.completion", created: 1, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });

  function setup(withOpenRouter: boolean) {
    for (const k of ["LLM_PROVIDER", "ANTHROPIC_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_REASONING"]) vi.stubEnv(k, "");
    vi.stubEnv("XAI_API_KEY", "xai-test");
    vi.stubEnv("XAI_MODEL", "grok-test");
    vi.stubEnv("OPENROUTER_API_KEY", withOpenRouter ? "or-test" : "");
    const calls: { url: string; auth: string | null; model: string }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({ url, auth: headers.get("authorization"), model: body.model });
      if (url.startsWith("https://api.x.ai/")) return Response.json({ error: { message: "Incorrect API key provided", type: "invalid_request_error" } }, { status: 401 });
      return completion("deepseek/deepseek-chat", "hello from openrouter");
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return { calls, info };
  }

  it("retries once through OpenRouter when Grok fails, and logs who answered (not the prompt)", async () => {
    const { calls, info } = setup(true);
    const text = await generateText({ system: "sys", prompt: "SECRET PROMPT TEXT" });
    expect(text).toBe("hello from openrouter");
    expect(calls.map((c) => c.url)).toEqual(["https://api.x.ai/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"]);
    expect(calls[0]).toMatchObject({ auth: "Bearer xai-test", model: "grok-test" });
    expect(calls[1]).toMatchObject({ auth: "Bearer or-test", model: "deepseek/deepseek-chat" });
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toMatch(/^\[llm\] openrouter deepseek\/deepseek-chat answered in \d+ms \(fallback after xai failed\)$/);
    expect(line).not.toContain("SECRET");
  });

  it("throws the xAI error when there's no OpenRouter key to fall back on", async () => {
    const { calls, info } = setup(false);
    await expect(generateText({ system: "sys", prompt: "hi" })).rejects.toThrow(/401|Incorrect API key/);
    expect(calls).toHaveLength(1);
    expect(info).not.toHaveBeenCalled();
  });

  it("logs the provider and model when Grok answers", async () => {
    const { info } = setup(true);
    vi.stubGlobal("fetch", async () => completion("grok-test", "hi from grok"));
    expect(await generateText({ system: "sys", prompt: "hi" })).toBe("hi from grok");
    expect(String(info.mock.calls[0][0])).toMatch(/^\[llm\] xai grok-test answered in \d+ms$/);
  });
});
