/**
 * Model routing, verified over the real OpenAI SDK with global fetch stubbed (no network): auto-detect order,
 * per-request preferences, the once-only OpenRouter fallback, the assistant pinned to OpenRouter, certificates on
 * Grok (direct or through OpenRouter), the health probe, and the heuristic fallback with no keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CERTIFY_PROVIDERS,
  certifyModels,
  generateText,
  llmAvailable,
  llmProvider,
  llmRouting,
  probeProvider,
  resolveProvider,
  runToolLoop,
} from "./client";
import { ASSISTANT_PROVIDER } from "@/lib/assistant/agent";

const KEYS = [
  "LLM_PROVIDER",
  "XAI_API_KEY",
  "XAI_MODEL",
  "APINEX_API_KEY",
  "APINEX_MODEL",
  "APINEX_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_REASONING",
  "READINESS_GROK_MODEL",
  "LLM_TIMEOUT_MS",
];

type Call = { url: string; model: string; auth: string | null };

/** Stub fetch: hosts in `fail` answer 402, everyone else answers "OK" with the requested model. */
function stubProviders(fail: string[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({
        url,
        model: body.model,
        auth: new Headers(init?.headers).get("authorization"),
      });
      if (fail.some((h) => url.includes(h)))
        return Response.json(
          { error: { message: "Payment required", type: "billing_error" } },
          { status: 402 },
        );
      return Response.json({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "OK" },
          },
        ],
      });
    },
  );
  return calls;
}

beforeEach(() => {
  for (const k of KEYS) vi.stubEnv(k, "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auto-detect order: xAI → OpenRouter → Anthropic → Apinex", () => {
  it("picks the first provider with a key", () => {
    expect(llmProvider()).toBe("none");
    vi.stubEnv("APINEX_API_KEY", "apx");
    expect(llmProvider()).toBe("apinex");
    vi.stubEnv("ANTHROPIC_API_KEY", "an");
    expect(llmProvider()).toBe("anthropic");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(llmProvider()).toBe("openrouter");
    vi.stubEnv("XAI_API_KEY", "xai");
    expect(llmProvider()).toBe("xai");
    vi.stubEnv("LLM_PROVIDER", "apinex");
    expect(llmProvider()).toBe("apinex");
  });

  it("honours a per-request preference (one provider or a list), only when it has a key", () => {
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(resolveProvider()).toBe("openrouter");
    expect(resolveProvider("apinex")).toBe("apinex");
    expect(resolveProvider("xai")).toBe("openrouter");
    expect(resolveProvider(["xai", "apinex"])).toBe("apinex");
    vi.stubEnv("LLM_PROVIDER", "none");
    expect(resolveProvider("openrouter")).toBe("none");
  });

  it("sends a default call to OpenRouter ahead of Apinex", async () => {
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders();
    expect(await generateText({ system: "s", prompt: "p" })).toBe("OK");
    expect(calls.map((c) => [new URL(c.url).host, c.model])).toEqual([
      ["openrouter.ai", "deepseek/deepseek-v4-flash"],
    ]);
  });
});

describe("fallback: a failed xAI / Apinex call is retried once through OpenRouter", () => {
  it("Apinex fails → OpenRouter answers", async () => {
    vi.stubEnv("LLM_PROVIDER", "apinex");
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders(["apinex"]);
    expect(await generateText({ system: "s", prompt: "p" })).toBe("OK");
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "api.apinex.bond",
      "openrouter.ai",
    ]);
  });

  it("OpenRouter fails → Apinex answers (Apinex stays in the fallback chain)", async () => {
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders(["openrouter"]);
    expect(await generateText({ system: "s", prompt: "p" })).toBe("OK");
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "openrouter.ai",
      "api.apinex.bond",
    ]);
  });

  it("a 429 is never retried on the same provider: straight to the fallback, once", async () => {
    vi.stubEnv("LLM_PROVIDER", "apinex");
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(new URL(url).host);
        if (url.includes("apinex"))
          return Response.json(
            {
              error: {
                message:
                  "Rate limit exceeded. Max 5 requests per minute for this API key.",
              },
            },
            { status: 429, headers: { "retry-after": "0" } },
          );
        const body = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({
          id: "c",
          object: "chat.completion",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "OK" },
            },
          ],
        });
      },
    );
    expect(await generateText({ system: "s", prompt: "p" })).toBe("OK");
    expect(calls).toEqual(["api.apinex.bond", "openrouter.ai"]);
  });

  it("a call that hangs times out (LLM_TIMEOUT_MS), counts as a failure and falls back; nothing hangs", async () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "150");
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(new URL(url).host);
        if (url.includes("x.ai"))
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          );
        const body = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(
          Response.json({
            id: "c",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "OK" },
              },
            ],
          }),
        );
      },
    );
    const started = Date.now();
    expect(await generateText({ system: "s", prompt: "p" })).toBe("OK");
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(calls).toEqual(["api.x.ai", "openrouter.ai"]);

    // With nowhere to fall back, the timeout throws (callers use their heuristic) instead of hanging.
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const t0 = Date.now();
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      /time|abort/i,
    );
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it("retries only once: when the fallback also fails, the error surfaces after two calls", async () => {
    vi.stubEnv("LLM_PROVIDER", "apinex");
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders(["apinex", "openrouter"]);
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      /402|Payment/,
    );
    expect(calls).toHaveLength(2);
  });

  it("the tool loop falls back too", async () => {
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders(["x.ai"]);
    const out = await runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      execute: async () => ({ content: "" }),
    });
    expect(out.text).toBe("OK");
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "api.x.ai",
      "openrouter.ai",
    ]);
  });
});

describe("feature routes", () => {
  it("the assistant's tool loop is pinned to OpenRouter even when auto-detect picks another provider", async () => {
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(ASSISTANT_PROVIDER).toBe("openrouter");
    expect(llmRouting()).toMatchObject({
      default: { provider: "xai" },
      assistant: {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
      },
    });
    const calls = stubProviders();
    await runToolLoop({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: [],
      provider: ASSISTANT_PROVIDER,
      execute: async () => ({ content: "" }),
    });
    expect(new URL(calls[0].url).host).toBe("openrouter.ai");
  });

  it("certificates use Grok through OpenRouter (x-ai/grok-4-fast) when there's no xAI key, Grok direct when there is", async () => {
    vi.stubEnv("APINEX_API_KEY", "apx");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(llmRouting().certify).toEqual({
      provider: "openrouter",
      model: "x-ai/grok-4-fast",
    });
    const calls = stubProviders();
    await generateText({
      system: "s",
      prompt: "p",
      provider: CERTIFY_PROVIDERS,
      models: certifyModels(),
    });
    expect(calls[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "x-ai/grok-4-fast",
    });

    vi.stubEnv("XAI_API_KEY", "xai");
    expect(llmRouting().certify).toEqual({ provider: "xai", model: "grok-4" });
    // Grok down: the retry through OpenRouter still runs Grok.
    const again = stubProviders(["x.ai"]);
    await generateText({
      system: "s",
      prompt: "p",
      provider: CERTIFY_PROVIDERS,
      models: certifyModels(),
    });
    expect(again.map((c) => [new URL(c.url).host, c.model])).toEqual([
      ["api.x.ai", "grok-4"],
      ["openrouter.ai", "x-ai/grok-4-fast"],
    ]);
  });

  it("the readiness trial agent follows the same rule", async () => {
    const { trialAgent } = await import("@/lib/readiness/certify");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    expect(trialAgent()).toMatchObject({
      kind: "grok",
      via: "openrouter",
      model: "x-ai/grok-4-fast",
    });
    vi.stubEnv("XAI_API_KEY", "xai");
    expect(trialAgent()).toMatchObject({ kind: "grok", via: "xai" });
  });
});

describe("no keys: heuristics everywhere", () => {
  it("reports no provider and refuses to call", async () => {
    expect(llmAvailable()).toBe(false);
    expect(llmRouting()).toMatchObject({
      default: { provider: "none", model: "heuristic" },
      assistant: { provider: "none", model: "heuristic" },
      certify: { provider: "none", model: "heuristic" },
      fallback: null,
      order: ["xai", "openrouter", "anthropic", "apinex"],
      timeoutMs: 20_000,
    });
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      /No LLM provider/,
    );
  });
});

describe("health probe", () => {
  it("skips unconfigured providers, calls configured ones directly (no fallback) and never leaks the key", async () => {
    expect(await probeProvider("xai")).toEqual({
      provider: "xai",
      configured: false,
      ok: false,
    });
    vi.stubEnv("APINEX_API_KEY", "apx-supersecretkey123");
    vi.stubEnv("OPENROUTER_API_KEY", "or");
    const calls = stubProviders(["apinex"]);
    const bad = await probeProvider("apinex");
    expect(bad).toMatchObject({
      provider: "apinex",
      configured: true,
      ok: false,
    });
    expect(bad.error).toBeTruthy();
    expect(JSON.stringify(bad)).not.toContain("supersecret");
    expect(calls).toHaveLength(1); // no OpenRouter retry for a probe
    const good = await probeProvider("openrouter");
    expect(good).toMatchObject({
      provider: "openrouter",
      configured: true,
      ok: true,
      model: "deepseek/deepseek-v4-flash",
    });
    expect(good.ms).toBeGreaterThanOrEqual(0);
  });
});
