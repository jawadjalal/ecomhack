/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env (auto-detect order: OpenRouter → xAI → Anthropic):
 *   LLM_PROVIDER=openrouter|xai|anthropic|none   (optional, else auto-detect)
 *   OPENROUTER_API_KEY  → OpenRouter (default model DeepSeek V4 Flash: `deepseek/deepseek-v4-flash`)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   OPENROUTER_MODEL / XAI_MODEL / ANTHROPIC_MODEL override the default model.
 *   OPENROUTER_REASONING=off  → ask OpenRouter to skip the model's thinking (faster loop steps).
 *   APINEX_API_KEY      → APINex (OpenAI-compatible, https://api.apinex.bond/v1). Default model `free/gpt-6-luna`
 *                         (APINEX_MODEL); APINEX_EDITOR_MODEL (default `anthropic/claude-opus-4.6`) for the
 *                         website editor / coding agent (Pixel).
 *                         Not auto-picked while another provider has a key: `pickProvider()` routes the editor,
 *                         "hard" tasks and OpenRouter overflow (LLM_OVERFLOW_AT concurrent calls, default 3) to it.
 *   Cross-provider fallback: an APINex error (402/429/5xx/timeout) retries on OpenRouter and vice versa
 *   (generateText, runToolLoop); after that callers use their heuristic.
 *
 * With no key, `llmAvailable()` is false and callers MUST fall back to heuristics,
 * so the demo always runs offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";

export type LlmProvider = "openrouter" | "xai" | "anthropic" | "apinex" | "none";

/** Default OpenRouter model slug (override with OPENROUTER_MODEL). */
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
/** Default APINex model (override with APINEX_MODEL; the editor uses APINEX_EDITOR_MODEL). */
export const DEFAULT_APINEX_MODEL = "free/gpt-6-luna";
/** Default APINex model for the website editor / coding agent (override with APINEX_EDITOR_MODEL). */
export const DEFAULT_APINEX_EDITOR_MODEL = "anthropic/claude-opus-4.6";
export const APINEX_BASE_URL = "https://api.apinex.bond/v1";

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY)
    return "openrouter";
  if (forced === "xai" && process.env.XAI_API_KEY) return "xai";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY)
    return "anthropic";
  if (forced === "apinex" && process.env.APINEX_API_KEY) return "apinex";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.APINEX_API_KEY) return "apinex";
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
    case "apinex":
      return Boolean(process.env.APINEX_API_KEY);
    default:
      return false;
  }
}

/**
 * The provider a request will actually use: `preferred` when it has a key (and LLM_PROVIDER isn't
 * "none"), otherwise the default from `llmProvider()`. Lets one feature pin a provider without changing the rest of the app.
 */
export function resolveProvider(preferred?: LlmProvider): LlmProvider {
  if (
    preferred &&
    preferred !== "none" &&
    process.env.LLM_PROVIDER !== "none" &&
    hasKey(preferred)
  )
    return preferred;
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
      return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    case "apinex":
      return process.env.APINEX_MODEL || DEFAULT_APINEX_MODEL;
    default:
      return "heuristic";
  }
}

/** APINex model for the website editor agent (Pixel). */
export function apinexEditorModel(): string {
  return process.env.APINEX_EDITOR_MODEL || DEFAULT_APINEX_EDITOR_MODEL;
}

/* ------------------------------------------------------------------ routing policy */

/** Model calls currently in flight, per provider (in-process). */
const inflight: Record<LlmProvider, number> = {
  openrouter: 0,
  xai: 0,
  anthropic: 0,
  apinex: 0,
  none: 0,
};

export function llmInFlight(provider: LlmProvider): number {
  return inflight[provider];
}

/** Concurrent OpenRouter calls before new work overflows to APINex (LLM_OVERFLOW_AT, default 3). */
export function overflowAt(): number {
  const n = Number(process.env.LLM_OVERFLOW_AT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

async function withSlot<T>(provider: LlmProvider, fn: () => Promise<T>): Promise<T> {
  inflight[provider]++;
  try {
    return await fn();
  } finally {
    inflight[provider]--;
  }
}

export interface ProviderChoice {
  provider: LlmProvider;
  /** Model override for that provider (undefined = the provider's default). */
  model?: string;
  /** Why this provider was picked (for logs/tests). */
  reason: "editor" | "hard" | "overflow" | "default";
}

/**
 * Which provider a piece of work should use. DeepSeek via OpenRouter (the default provider) for most calls;
 * APINex for (a) the website editor (APINEX_EDITOR_MODEL), (b) tasks flagged hard, (c) overflow when
 * ≥ LLM_OVERFLOW_AT OpenRouter calls are in flight. Falls back to the default when APINex has no key.
 */
export function pickProvider(opts: { editor?: boolean; hard?: boolean } = {}): ProviderChoice {
  const base = llmProvider();
  if (base === "none") return { provider: "none", reason: "default" };
  const apinex = hasKey("apinex") && process.env.LLM_PROVIDER !== "none";
  if (apinex && opts.editor)
    return { provider: "apinex", model: apinexEditorModel(), reason: "editor" };
  if (apinex && opts.hard) return { provider: "apinex", reason: "hard" };
  if (apinex && base === "openrouter" && inflight.openrouter >= overflowAt())
    return { provider: "apinex", reason: "overflow" };
  return { provider: base, reason: "default" };
}

/** The provider to retry on when `provider` fails: APINex ⇄ OpenRouter (when keyed), else none. */
export function fallbackProvider(provider: LlmProvider): LlmProvider | undefined {
  if (process.env.LLM_PROVIDER === "none") return undefined;
  if (provider === "apinex" && hasKey("openrouter")) return "openrouter";
  if (provider === "openrouter" && hasKey("apinex")) return "apinex";
  return undefined;
}

/** Errors worth retrying on another provider (payment/rate limit/server/network/timeout), not bad requests. */
export function retriableProviderError(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : 0;
  if ([401, 402, 403, 408, 409, 429].includes(status) || status >= 500) return true;
  if (!status) return true; // network error / timeout / empty body
  return false;
}

/** Model name without the vendor prefix, e.g. "deepseek-v4-flash" (for user-facing copy). */
export function llmShortModel(preferred?: LlmProvider): string {
  return llmModel(preferred).split("/").pop() || "heuristic";
}

/** Label for UI/PRs, e.g. "llm:deepseek/deepseek-v4-flash". Pass the request's `provider` override to label it. */
export function llmLabel(preferred?: LlmProvider) {
  return llmAvailable(preferred) ? `llm:${llmModel(preferred)}` : "heuristic";
}

export interface TextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Preferred provider for this call; used when its key is set, else the default provider. */
  provider?: LlmProvider;
  /** Model override, used only when the call runs on `provider` (not after a fallback). */
  model?: string;
  /** Retry on the other provider (APINex ⇄ OpenRouter) on a retriable error. Default true. */
  fallback?: boolean;
}

type OpenAiProvider = "xai" | "openrouter" | "apinex";

/** OpenAI-compatible client for OpenRouter / xAI / APINex. OpenRouter gets its recommended attribution headers. */
function openaiClient(provider: OpenAiProvider): OpenAI {
  if (provider === "xai")
    return new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
  if (provider === "apinex")
    return new OpenAI({
      apiKey: process.env.APINEX_API_KEY,
      baseURL: process.env.APINEX_BASE_URL || APINEX_BASE_URL,
    });
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer":
        process.env.DARWIN_PUBLIC_URL ||
        "https://github.com/jawadjalal/ecomhack",
      "X-Title": "Darwin",
    },
  });
}

const reasoningExtra = (provider: LlmProvider): object =>
  provider === "openrouter" && process.env.OPENROUTER_REASONING === "off"
    ? { reasoning: { enabled: false } }
    : {};

const isOpenAi = (p: LlmProvider): p is OpenAiProvider =>
  p === "xai" || p === "openrouter" || p === "apinex";

/** Plain text completion. Throws if no provider is configured. Retries once on the other provider (see `fallback`). */
export async function generateText(req: TextRequest): Promise<string> {
  const provider = resolveProvider(req.provider);
  const model = req.provider === provider ? req.model : undefined;
  try {
    return await withSlot(provider, () => completeText(provider, model, req));
  } catch (err) {
    const next = req.fallback === false ? undefined : fallbackProvider(provider);
    if (!next || !retriableProviderError(err)) throw err;
    console.warn(`[llm] ${provider} failed (${String(err).slice(0, 120)}), retrying on ${next}`);
    return withSlot(next, () => completeText(next, undefined, req));
  }
}

async function completeText(
  provider: LlmProvider,
  model: string | undefined,
  { system, prompt, maxTokens = 4000 }: TextRequest,
): Promise<string> {
  if (isOpenAi(provider)) {
    const client = openaiClient(provider);
    const res = await client.chat.completions.create({
      model: model || llmModel(provider),
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // OpenRouter extension, not in the OpenAI types.
      ...reasoningExtra(provider),
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
    if (res.stop_reason === "refusal")
      throw new Error("LLM refused the request");
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  throw new Error(
    "No LLM provider configured (set OPENROUTER_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY or APINEX_API_KEY)",
  );
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
export async function generateJson<T>(
  req: TextRequest & { schema: z.ZodType<T> },
): Promise<T> {
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

/* ------------------------------------------------------------------ agentic tool loop */

/** A tool the model may call. `parameters` is a JSON Schema object (see `toolFromZod`). */
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** The raw argument string when the model sent something that isn't a JSON object. */
  invalidArgs?: string;
}

export interface LlmToolResult {
  /** What the model sees as the tool's result. */
  content: string;
  /** End the loop right after this call (e.g. a side effect needs the user's confirmation first). */
  stop?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolLoopRequest {
  system: string;
  messages: ChatTurn[];
  tools: LlmTool[];
  execute: (call: LlmToolCall) => Promise<LlmToolResult>;
  /** Max model turns that may call tools; one more turn is always left for the final answer. Default 6. */
  maxSteps?: number;
  maxTokens?: number;
  provider?: LlmProvider;
  /** Model override, used only while the loop runs on `provider`. */
  model?: string;
  /** Switch to the other provider (APINex ⇄ OpenRouter) when a model call fails. Default true. */
  fallback?: boolean;
  /** Run the calls of one model turn concurrently (only for side-effect-free tools). Default: in order. */
  parallel?: boolean;
  /** Per model call. Default 45s. */
  timeoutMs?: number;
  /** Wall-clock budget for the whole loop; once spent, the model must answer. */
  budgetMs?: number;
  /** Told to the model when it is out of steps or time. */
  finalInstruction?: string;
}

export interface ToolLoopResult {
  /** The model's final answer (may be empty when `stopped`). */
  text: string;
  /** "native": OpenAI-compatible tool calling. "json": prompted JSON tool calls (Anthropic, or models without tools). */
  mode: "native" | "json";
  /** Model calls made. */
  steps: number;
  calls: LlmToolCall[];
  /** A tool asked to stop (see `LlmToolResult.stop`). */
  stopped: boolean;
  /** Provider that answered the last turn (differs from the request's after a fallback). */
  provider?: LlmProvider;
}

/** JSON Schema for a zod object, ready for a tool definition (no-arg schemas become `{type:"object"}`). */
export function toolFromZod(
  name: string,
  description: string,
  schema: z.ZodType,
): LlmTool {
  let parameters: Record<string, unknown> = { type: "object", properties: {} };
  try {
    const js = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>;
    delete js.$schema;
    if (js.type === "object") parameters = { properties: {}, ...js };
  } catch {
    /* keep the permissive schema */
  }
  return { name, description, parameters };
}

type TraceEntry = {
  text: string;
  calls: LlmToolCall[];
  results: { call: LlmToolCall; content: string }[];
};

const DEFAULT_FINAL =
  "You are out of tool calls: answer now, using the tool results above.";

function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`LLM call timed out after ${Math.round(ms / 1000)}s`),
          ),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The provider/model can't do native tool calling (OpenRouter: "No endpoints found that support tool use"). */
export function toolsUnsupported(err: unknown, provider?: LlmProvider): boolean {
  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : 0;
  if (![400, 404, 405, 422, 501].includes(status)) return false;
  // APINex's tool support is unverified: any request-shape rejection falls back to prompted JSON.
  if (provider === "apinex") return true;
  return /tool|function/i.test(String(e?.message ?? ""));
}

function parseArgs(raw: unknown): {
  args: Record<string, unknown>;
  invalid?: string;
} {
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return { args: raw as Record<string, unknown> };
  if (typeof raw !== "string" || !raw.trim()) return { args: {} };
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v))
      return { args: v as Record<string, unknown> };
  } catch {
    /* fall through */
  }
  return { args: {}, invalid: raw.slice(0, 300) };
}

async function nativeTurn(
  provider: OpenAiProvider,
  model: string | undefined,
  req: ToolLoopRequest,
  trace: TraceEntry[],
  last: boolean,
  step: number,
) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: req.system },
  ];
  for (const m of req.messages)
    messages.push({ role: m.role, content: m.content });
  for (const t of trace) {
    messages.push({
      role: "assistant",
      content: t.text || null,
      tool_calls: t.calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    });
    for (const r of t.results)
      messages.push({
        role: "tool",
        tool_call_id: r.call.id,
        content: r.content,
      });
  }
  if (last)
    messages.push({
      role: "user",
      content: req.finalInstruction ?? DEFAULT_FINAL,
    });
  const res = await openaiClient(provider).chat.completions.create({
    model: model || llmModel(provider),
    max_tokens: req.maxTokens ?? 1500,
    messages,
    tools: req.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
    tool_choice: last ? "none" : "auto",
    ...reasoningExtra(provider),
  });
  const msg = res.choices[0]?.message;
  const calls: LlmToolCall[] = [];
  for (const [i, tc] of (msg?.tool_calls ?? []).entries()) {
    if (tc.type !== "function") continue;
    const { args, invalid } = parseArgs(tc.function.arguments);
    calls.push({
      id: tc.id || `call_${step}_${i}`,
      name: tc.function.name,
      args,
      ...(invalid ? { invalidArgs: invalid } : {}),
    });
  }
  return { text: (msg?.content ?? "").trim(), calls };
}

const JsonTurnSchema = z
  .object({
    tool_calls: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          args: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(6)
      .optional(),
    tool: z.string().min(1).max(120).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    answer: z.string().max(8000).optional(),
  })
  .refine(
    (d) =>
      Boolean(d.tool_calls?.length) ||
      Boolean(d.tool) ||
      typeof d.answer === "string",
    { message: 'Give "tool_calls" or "answer".' },
  );

async function jsonTurn(
  provider: LlmProvider,
  model: string | undefined,
  req: ToolLoopRequest,
  trace: TraceEntry[],
  last: boolean,
  step: number,
) {
  const catalog = req.tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  args (JSON Schema): ${JSON.stringify(t.parameters).slice(0, 1200)}`,
    )
    .join("\n");
  const convo = req.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");
  const history = trace
    .flatMap((t) =>
      t.results.map(
        (r) =>
          `- ${r.call.name}(${JSON.stringify(r.call.args)}) → ${r.content.slice(0, 2500)}`,
      ),
    )
    .join("\n");
  const prompt = [
    `TOOLS:\n${catalog || "(none)"}`,
    `CONVERSATION:\n${convo}`,
    `TOOL RESULTS SO FAR:\n${history || "(none)"}`,
    last
      ? `${req.finalInstruction ?? DEFAULT_FINAL}\nRespond with JSON: {"answer": "<your answer>"}`
      : 'Respond with JSON, either {"tool_calls": [{"name": "<tool>", "args": {…}}, …]} to call one or more tools (they run in order), or {"answer": "<your answer>"} when done.',
  ].join("\n\n");
  const out = await generateJson({
    system: req.system,
    prompt,
    schema: JsonTurnSchema,
    maxTokens: req.maxTokens ?? 1500,
    provider,
    model,
    fallback: false,
  });
  const raw = out.tool_calls?.length
    ? out.tool_calls
    : out.tool
      ? [{ name: out.tool, args: out.args }]
      : [];
  const calls: LlmToolCall[] = last
    ? []
    : raw.map((c, i) => ({
        id: `json_${step}_${i}`,
        name: c.name,
        args: c.args ?? {},
      }));
  return { text: (out.answer ?? "").trim(), calls };
}

/**
 * Agentic tool loop. OpenRouter/xAI use native OpenAI-compatible tool calling (multi-turn: the assistant's
 * tool calls and each tool result are fed back as messages; several calls per turn are supported). Anthropic,
 * or a model that rejects `tools`, uses a prompted-JSON loop over the same tools. Bounded by `maxSteps`, a
 * per-call timeout and an optional wall-clock budget; the final turn has tools disabled so the model answers.
 * Throws if no provider is configured or a model call fails (callers keep their heuristic fallback).
 */
export async function runToolLoop(
  req: ToolLoopRequest,
): Promise<ToolLoopResult> {
  let provider = resolveProvider(req.provider);
  if (provider === "none") throw new Error("No LLM provider configured");
  let model = req.provider === provider ? req.model : undefined;
  const maxSteps = Math.max(0, req.maxSteps ?? 6);
  const timeoutMs = req.timeoutMs ?? 45_000;
  const started = Date.now();
  let mode: ToolLoopResult["mode"] =
    provider === "anthropic" ? "json" : "native";
  let fellBack = req.fallback === false;
  const trace: TraceEntry[] = [];
  const calls: LlmToolCall[] = [];

  /** One model turn on the current provider (native, or JSON when tools are rejected). */
  const modelTurn = async (last: boolean, step: number) => {
    if (mode === "native" && isOpenAi(provider)) {
      try {
        return await timed(
          withSlot(provider, () => nativeTurn(provider as OpenAiProvider, model, req, trace, last, step)),
          timeoutMs,
        );
      } catch (err) {
        if (!toolsUnsupported(err, provider)) throw err;
        console.warn(
          `[llm] native tool calling unsupported on ${provider}, using JSON tool calls:`,
          String(err).slice(0, 160),
        );
        mode = "json";
      }
    }
    // generateText (inside jsonTurn) holds the in-flight slot.
    return timed(jsonTurn(provider, model, req, trace, last, step), timeoutMs);
  };

  for (let step = 0; step <= maxSteps; step++) {
    const last =
      step === maxSteps ||
      (req.budgetMs !== undefined && Date.now() - started > req.budgetMs);
    let turn: { text: string; calls: LlmToolCall[] };
    try {
      turn = await modelTurn(last, step);
    } catch (err) {
      const next: LlmProvider | undefined = fellBack ? undefined : fallbackProvider(provider);
      if (!next || !retriableProviderError(err)) throw err;
      console.warn(`[llm] ${provider} failed (${String(err).slice(0, 120)}), continuing on ${next}`);
      fellBack = true;
      provider = next;
      model = undefined;
      mode = provider === "anthropic" ? "json" : "native";
      turn = await modelTurn(last, step);
    }
    if (last || !turn.calls.length)
      return { text: turn.text, mode, steps: step + 1, calls, stopped: false, provider };

    const entry: TraceEntry = {
      text: turn.text,
      calls: turn.calls,
      results: [],
    };
    trace.push(entry);
    calls.push(...turn.calls);
    let stopped = false;
    if (req.parallel) {
      const results = await Promise.all(
        turn.calls.map((c) =>
          req
            .execute(c)
            .catch(
              (e) =>
                ({
                  content: `error: ${String((e as Error)?.message ?? e).slice(0, 300)}`,
                }) as LlmToolResult,
            ),
        ),
      );
      results.forEach((r, i) =>
        entry.results.push({ call: turn.calls[i], content: r.content }),
      );
      stopped = results.some((r) => r.stop);
    } else {
      for (const c of turn.calls) {
        if (stopped) {
          entry.results.push({
            call: c,
            content:
              "skipped: an earlier call in this turn is waiting for the user",
          });
          continue;
        }
        let r: LlmToolResult;
        try {
          r = await req.execute(c);
        } catch (e) {
          r = {
            content: `error: ${String((e as Error)?.message ?? e).slice(0, 300)}`,
          };
        }
        entry.results.push({ call: c, content: r.content });
        if (r.stop) stopped = true;
      }
    }
    if (stopped)
      return { text: turn.text, mode, steps: step + 1, calls, stopped: true, provider };
  }
  /* unreachable: the last step always returns */
  return { text: "", mode, steps: maxSteps + 1, calls, stopped: false, provider };
}
