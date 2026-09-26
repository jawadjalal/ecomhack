/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env:
 *   LLM_PROVIDER=xai|anthropic|openrouter|none   (optional, else auto-detect)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API (hackathon sponsor)
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   OPENROUTER_API_KEY  → any OpenRouter model (cheap testing, e.g. DeepSeek)
 *   XAI_MODEL / ANTHROPIC_MODEL / OPENROUTER_MODEL override the default model.
 *   OPENROUTER_REASONING=off  → ask OpenRouter to skip the model's thinking (faster loop steps).
 *
 * With no key, `llmAvailable()` is false and callers MUST fall back to heuristics,
 * so the demo always runs offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";

export type LlmProvider = "xai" | "anthropic" | "openrouter" | "none";

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced === "xai" && process.env.XAI_API_KEY) return "xai";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "none";
}

function hasKey(provider: LlmProvider): boolean {
  switch (provider) {
    case "xai":
      return Boolean(process.env.XAI_API_KEY);
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY);
    default:
      return false;
  }
}

/**
 * The provider a request will actually use: `preferred` when it has a key (and LLM_PROVIDER isn't
 * "none"), otherwise the default from `llmProvider()`. Lets one feature (e.g. Grok certificates)
 * pin a provider without changing the rest of the app.
 */
export function resolveProvider(preferred?: LlmProvider): LlmProvider {
  if (preferred && preferred !== "none" && process.env.LLM_PROVIDER !== "none" && hasKey(preferred)) return preferred;
  return llmProvider();
}

export function llmAvailable(preferred?: LlmProvider) {
  return resolveProvider(preferred) !== "none";
}

export function llmModel(preferred?: LlmProvider): string {
  switch (resolveProvider(preferred)) {
    case "xai":
      return process.env.XAI_MODEL || "grok-4";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-opus-5";
    case "openrouter":
      return process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
    default:
      return "heuristic";
  }
}

/** Label for UI/PRs, e.g. "llm:grok-4". Pass the request's `provider` override to label it. */
export function llmLabel(preferred?: LlmProvider) {
  return llmAvailable(preferred) ? `llm:${llmModel(preferred)}` : "heuristic";
}

export interface TextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Preferred provider for this call; used when its key is set, else the default provider. */
  provider?: LlmProvider;
}

/** Plain text completion. Throws if no provider is configured. */
export async function generateText({ system, prompt, maxTokens = 4000, provider: preferred }: TextRequest): Promise<string> {
  const provider = resolveProvider(preferred);
  if (provider === "xai" || provider === "openrouter") {
    const client =
      provider === "xai"
        ? new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" })
        : new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: { "X-Title": "Darwin" },
          });
    const reasoningOff = provider === "openrouter" && process.env.OPENROUTER_REASONING === "off";
    const res = await client.chat.completions.create({
      model: llmModel(provider),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // OpenRouter extension, not in the OpenAI types.
      ...(reasoningOff ? ({ reasoning: { enabled: false } } as object) : {}),
    });
    return res.choices[0]?.message?.content ?? "";
  }
  if (provider === "anthropic") {
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: llmModel(provider),
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("LLM refused the request");
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  throw new Error("No LLM provider configured (set XAI_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON in LLM response");
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Ask for JSON matching a zod schema. Retries once with the validation error.
 * Throws if no provider or the output never validates — callers fall back to heuristics.
 */
export async function generateJson<T>(req: TextRequest & { schema: z.ZodType<T> }): Promise<T> {
  let prompt = `${req.prompt}\n\nRespond with a single JSON value only. No prose, no code fences.`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await generateText({ ...req, prompt });
    try {
      return req.schema.parse(extractJson(text));
    } catch (err) {
      lastError = err;
      prompt = `${req.prompt}\n\nYour previous answer was invalid: ${String(err).slice(0, 500)}\nRespond with a single valid JSON value only.`;
    }
  }
  throw lastError;
}
