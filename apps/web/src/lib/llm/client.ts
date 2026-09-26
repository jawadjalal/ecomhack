/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env:
 *   LLM_PROVIDER=xai|apinex|anthropic|openrouter|none   (optional, else auto-detect)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API (hackathon sponsor)
 *   APINEX_API_KEY      → Apinex's OpenAI-compatible API (default model free/gpt-6-luna). Free models need a
 *                         daily check-in on apinex.bond, so a failed call falls back to OpenRouter.
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   OPENROUTER_API_KEY  → any OpenRouter model (cheap testing, e.g. DeepSeek)
 *   XAI_MODEL / APINEX_MODEL / ANTHROPIC_MODEL / OPENROUTER_MODEL override the default model.
 *   OPENROUTER_REASONING=off  → ask OpenRouter to skip the model's thinking (faster loop steps).
 *
 * If a Grok (xAI) or Apinex call fails and OPENROUTER_API_KEY is set, the call is retried once through OpenRouter
 * (OPENROUTER_MODEL). Every answered call logs one line with the provider and model (never the prompt).
 *
 * With no key, `llmAvailable()` is false and callers MUST fall back to heuristics,
 * so the demo always runs offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";

export type LlmProvider = "xai" | "apinex" | "anthropic" | "openrouter" | "none";

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced === "xai" && process.env.XAI_API_KEY) return "xai";
  if (forced === "apinex" && process.env.APINEX_API_KEY) return "apinex";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.APINEX_API_KEY) return "apinex";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "none";
}

export function llmAvailable() {
  return llmProvider() !== "none";
}

export function llmModel(): string {
  return modelFor(llmProvider());
}

function modelFor(provider: LlmProvider): string {
  switch (provider) {
    case "xai":
      return process.env.XAI_MODEL || "grok-4";
    case "apinex":
      return process.env.APINEX_MODEL || "free/gpt-6-luna";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-opus-5";
    case "openrouter":
      return process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
    default:
      return "heuristic";
  }
}

/** Label for UI/PRs, e.g. "llm:grok-4". */
export function llmLabel() {
  return llmAvailable() ? `llm:${llmModel()}` : "heuristic";
}

export interface TextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/** One line per answered call: which provider and model answered, and how long it took. Never the prompt. */
function logAnswer(provider: LlmProvider, model: string, startedAt: number, note = "") {
  console.info(`[llm] ${provider} ${model} answered in ${Date.now() - startedAt}ms${note}`);
}

const errorLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 160);

/** xAI, Apinex and OpenRouter all speak the OpenAI chat completions API. */
async function openAiCompatible(provider: "xai" | "apinex" | "openrouter", { system, prompt, maxTokens = 4000 }: TextRequest): Promise<{ text: string; model: string }> {
  const client =
    provider === "xai"
      ? new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" })
      : provider === "apinex"
        ? new OpenAI({ apiKey: process.env.APINEX_API_KEY, baseURL: process.env.APINEX_BASE_URL || "https://api.apinex.bond/v1" })
        : new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: { "X-Title": "Darwin" },
        });
  const model = modelFor(provider);
  const reasoningOff = provider === "openrouter" && process.env.OPENROUTER_REASONING === "off";
  const res = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    // OpenRouter extension, not in the OpenAI types.
    ...(reasoningOff ? ({ reasoning: { enabled: false } } as object) : {}),
  });
  return { text: res.choices[0]?.message?.content ?? "", model: res.model || model };
}

/** Plain text completion. Throws if no provider is configured. */
export async function generateText(req: TextRequest): Promise<string> {
  const provider = llmProvider();
  const startedAt = Date.now();
  if (provider === "xai" || provider === "apinex") {
    try {
      const res = await openAiCompatible(provider, req);
      logAnswer(provider, res.model, startedAt);
      return res.text;
    } catch (err) {
      if (!process.env.OPENROUTER_API_KEY) throw err;
      console.warn(`[llm] ${provider} ${modelFor(provider)} failed (${errorLine(err)}); retrying once via OpenRouter`);
      const retryAt = Date.now();
      const res = await openAiCompatible("openrouter", req);
      logAnswer("openrouter", res.model, retryAt, ` (fallback after ${provider} failed)`);
      return res.text;
    }
  }
  if (provider === "openrouter") {
    const res = await openAiCompatible("openrouter", req);
    logAnswer("openrouter", res.model, startedAt);
    return res.text;
  }
  if (provider === "anthropic") {
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: llmModel(),
      max_tokens: req.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("LLM refused the request");
    logAnswer("anthropic", res.model || llmModel(), startedAt);
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  throw new Error("No LLM provider configured (set XAI_API_KEY, APINEX_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY)");
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
