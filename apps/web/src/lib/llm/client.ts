/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env (auto-detect order: OpenRouter → xAI → Apinex → Anthropic):
 *   LLM_PROVIDER=openrouter|xai|apinex|anthropic|none   (optional, else auto-detect)
 *   OPENROUTER_API_KEY  → OpenRouter (default model DeepSeek V4 Flash: `deepseek/deepseek-v4-flash`)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API (hackathon sponsor)
 *   APINEX_API_KEY      → Apinex's OpenAI-compatible API (default model free/gpt-6-luna). Free models need a
 *                         daily check-in on apinex.bond, so a failed call falls back to OpenRouter.
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   OPENROUTER_MODEL / XAI_MODEL / APINEX_MODEL / ANTHROPIC_MODEL override the default model.
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
import { z } from "zod";

export type LlmProvider = "openrouter" | "xai" | "apinex" | "anthropic" | "none";

/** Default OpenRouter model slug (override with OPENROUTER_MODEL). */
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY)
    return "openrouter";
  if (forced === "xai" && process.env.XAI_API_KEY) return "xai";
  if (forced === "apinex" && process.env.APINEX_API_KEY) return "apinex";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY)
    return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.APINEX_API_KEY) return "apinex";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "none";
}

function hasKey(provider: LlmProvider): boolean {
  switch (provider) {
    case "xai":
      return Boolean(process.env.XAI_API_KEY);
    case "apinex":
      return Boolean(process.env.APINEX_API_KEY);
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
  return modelFor(resolveProvider(preferred));
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
      return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    default:
      return "heuristic";
  }
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
  /** Use this provider when it has a key (see `resolveProvider`). */
  provider?: LlmProvider;
}

type OpenAiProvider = "xai" | "apinex" | "openrouter";

/** OpenAI-compatible client for xAI / Apinex / OpenRouter. OpenRouter gets its recommended attribution headers. */
function openaiClient(provider: OpenAiProvider): OpenAI {
  if (provider === "xai")
    return new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
  if (provider === "apinex")
    return new OpenAI({
      apiKey: process.env.APINEX_API_KEY,
      baseURL: process.env.APINEX_BASE_URL || "https://api.apinex.bond/v1",
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

/** One line per answered call: which provider and model answered, and how long it took. Never the prompt. */
function logAnswer(provider: LlmProvider, model: string, startedAt: number, note = "") {
  console.info(`[llm] ${provider} ${model} answered in ${Date.now() - startedAt}ms${note}`);
}

const errorLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 160);

/** xAI, Apinex and OpenRouter all speak the OpenAI chat completions API. */
async function openAiCompatible(provider: OpenAiProvider, { system, prompt, maxTokens = 4000 }: TextRequest): Promise<{ text: string; model: string }> {
  const model = modelFor(provider);
  const res = await openaiClient(provider).chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    // OpenRouter extension, not in the OpenAI types.
    ...reasoningExtra(provider),
  });
  return { text: res.choices[0]?.message?.content ?? "", model: res.model || model };
}

/** Plain text completion. Throws if no provider is configured. */
export async function generateText(req: TextRequest): Promise<string> {
  const provider = resolveProvider(req.provider);
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
      model: modelFor("anthropic"),
      max_tokens: req.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("LLM refused the request");
    logAnswer("anthropic", res.model || modelFor("anthropic"), startedAt);
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  }
  throw new Error("No LLM provider configured (set OPENROUTER_API_KEY, XAI_API_KEY, APINEX_API_KEY or ANTHROPIC_API_KEY)");
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
export function toolsUnsupported(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : 0;
  return (
    [400, 404, 405, 422, 501].includes(status) &&
    /tool|function/i.test(String(e?.message ?? ""))
  );
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
    model: llmModel(provider),
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
  const provider = resolveProvider(req.provider);
  if (provider === "none") throw new Error("No LLM provider configured");
  const maxSteps = Math.max(0, req.maxSteps ?? 6);
  const timeoutMs = req.timeoutMs ?? 45_000;
  const started = Date.now();
  let mode: ToolLoopResult["mode"] =
    provider === "anthropic" ? "json" : "native";
  const trace: TraceEntry[] = [];
  const calls: LlmToolCall[] = [];

  for (let step = 0; step <= maxSteps; step++) {
    const last =
      step === maxSteps ||
      (req.budgetMs !== undefined && Date.now() - started > req.budgetMs);
    let turn: { text: string; calls: LlmToolCall[] };
    if (mode === "native") {
      try {
        turn = await timed(
          nativeTurn(provider as OpenAiProvider, req, trace, last, step),
          timeoutMs,
        );
      } catch (err) {
        if (!toolsUnsupported(err)) throw err;
        console.warn(
          "[llm] native tool calling unsupported, using JSON tool calls:",
          String(err).slice(0, 160),
        );
        mode = "json";
        turn = await timed(
          jsonTurn(provider, req, trace, last, step),
          timeoutMs,
        );
      }
    } else {
      turn = await timed(jsonTurn(provider, req, trace, last, step), timeoutMs);
    }
    if (last || !turn.calls.length)
      return { text: turn.text, mode, steps: step + 1, calls, stopped: false };

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
      return { text: turn.text, mode, steps: step + 1, calls, stopped: true };
  }
  /* unreachable: the last step always returns */
  return { text: "", mode, steps: maxSteps + 1, calls, stopped: false };
}
