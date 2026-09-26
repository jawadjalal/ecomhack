import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, llmLabel, llmProvider, resolveProvider } from "./client";

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
