/**
 * Provider fallback over real HTTP (global fetch stubbed). Kept apart from client.test.ts, which mocks the OpenAI SDK.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, llmLabel, llmProvider, resetLlmCooldowns } from "./client";

describe("xAI → OpenRouter fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const completion = (model: string, content: string) =>
    Response.json({ id: "c1", object: "chat.completion", created: 1, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });

  function setup(withOpenRouter: boolean) {
    for (const k of ["LLM_PROVIDER", "APINEX_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_REASONING"]) vi.stubEnv(k, "");
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
    expect(calls[1]).toMatchObject({ auth: "Bearer or-test", model: "deepseek/deepseek-v4-flash" });
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

describe("Apinex", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is picked from APINEX_API_KEY, runs free/gpt-6-luna, and falls back to OpenRouter on a billing error", async () => {
    for (const k of ["LLM_PROVIDER", "XAI_API_KEY", "APINEX_MODEL", "ANTHROPIC_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_REASONING"]) vi.stubEnv(k, "");
    vi.stubEnv("APINEX_API_KEY", "apx-test");
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    expect(llmProvider()).toBe("openrouter"); // OpenRouter is ahead of Apinex in auto-detect
    vi.stubEnv("LLM_PROVIDER", "apinex");
    expect(llmProvider()).toBe("apinex");
    expect(llmLabel()).toBe("llm:free/gpt-6-luna");

    const calls: { url: string; auth: string | null; model: string }[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization"), model: JSON.parse(String(init?.body ?? "{}")).model });
      if (url.startsWith("https://api.apinex.bond/")) return Response.json({ error: { message: "Daily check-in required to use free models.", type: "billing_error" } }, { status: 402 });
      return Response.json({ id: "c1", object: "chat.completion", created: 1, model: "deepseek/deepseek-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "from openrouter" } }] });
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await generateText({ system: "sys", prompt: "hi" })).toBe("from openrouter");
    expect(calls[0]).toMatchObject({ url: "https://api.apinex.bond/v1/chat/completions", auth: "Bearer apx-test", model: "free/gpt-6-luna" });
    expect(calls[1].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(String(info.mock.calls[0][0])).toMatch(/\(fallback after apinex failed\)$/);
  });
});

describe("rate limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetLlmCooldowns();
  });

  it("doesn't wait out a 429: falls back at once, then skips the provider until Retry-After passes", async () => {
    for (const k of ["XAI_API_KEY", "APINEX_MODEL", "ANTHROPIC_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_REASONING"]) vi.stubEnv(k, "");
    vi.stubEnv("LLM_PROVIDER", "apinex"); // OpenRouter is the default now; pin Apinex to exercise its cooldown
    vi.stubEnv("APINEX_API_KEY", "apx-test");
    vi.stubEnv("OPENROUTER_API_KEY", "or-test");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      if (url.startsWith("https://api.apinex.bond/"))
        return Response.json({ error: { message: "Rate limit exceeded. Max 5 requests per minute for this API key. Retry in 60s." } }, { status: 429, headers: { "retry-after": "60" } });
      return Response.json({ id: "c1", object: "chat.completion", created: 1, model: "deepseek/deepseek-chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] });
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const t = Date.now();
    expect(await generateText({ system: "s", prompt: "p" })).toBe("ok");
    expect(await generateText({ system: "s", prompt: "p" })).toBe("ok");
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(urls.filter((u) => u.startsWith("https://api.apinex.bond/"))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith("https://openrouter.ai/"))).toHaveLength(2);
  });
});
