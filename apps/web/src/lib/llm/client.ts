/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env (auto-detect order: xAI → OpenRouter → Anthropic → Apinex):
 *   LLM_PROVIDER=xai|openrouter|anthropic|apinex|none   (optional, else auto-detect)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API (hackathon sponsor)
 *   APINEX_API_KEY      → Apinex's OpenAI-compatible API (default model free/gpt-6-luna). Free models need a
 *                         daily check-in on apinex.bond, so a failed call falls back to OpenRouter.
 *   OPENROUTER_API_KEY  → OpenRouter (default model DeepSeek V4 Flash: `deepseek/deepseek-v4-flash`)
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   XAI_MODEL / APINEX_MODEL / OPENROUTER_MODEL / ANTHROPIC_MODEL override the default model.
 *   APINEX_BASE_URL     → override the Apinex endpoint.
 *   OPENROUTER_REASONING=off  → ask OpenRouter to skip the model's thinking (faster loop steps).
 *
 * A feature can pin a provider per call (`provider`, one or a list in order of preference, see `resolveProvider`)
 * and a model per provider (`models`): the Ask Darwin assistant's tool loop prefers OpenRouter (reliable native tool
 * calling); certificates prefer Grok (xAI, else Grok through OpenRouter); everything else uses auto-detect.
 * `llmRouting()` reports who answers what (ops only: /api/llm/health), `probeProvider()` checks one provider.
 *
 * Every call has a hard timeout (LLM_TIMEOUT_MS, default 20 s) and no SDK-level retries (a 429 is never retried
 * on the same provider). A failed or timed-out call is retried ONCE on the fallback provider: OpenRouter for
 * xAI / Apinex / Anthropic, Apinex for OpenRouter (when that one has a key); otherwise it throws and callers use
 * their heuristic. Every answered call logs one line with the provider and model (never the prompt).
 * Model names stay in logs: user-facing copy should say "AI" / "rules", never a model or provider name.
 *
 * With no key, `llmAvailable()` is false and callers MUST fall back to heuristics,
 * so the demo always runs offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";

export type LlmProvider =
  | "xai"
  | "apinex"
  | "openrouter"
  | "anthropic"
  | "none";

/** Default OpenRouter model slug (override with OPENROUTER_MODEL). */
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
/** Default Apinex model (override with APINEX_MODEL). */
export const DEFAULT_APINEX_MODEL = "free/gpt-6-luna";

/** A preferred provider, or several in order of preference. */
export type PreferredProvider = LlmProvider | readonly LlmProvider[];
/** Per-request model override for a provider, e.g. `{ openrouter: "x-ai/grok-4-fast" }`. */
export type ModelOverrides = Partial<Record<LlmProvider, string>>;

/** Auto-detect order when LLM_PROVIDER doesn't force one. */
export const AUTO_DETECT_ORDER: readonly LlmProvider[] = [
  "xai",
  "openrouter",
  "anthropic",
  // Last: capped at 5 requests/min and needs a daily check-in. Still usable via LLM_PROVIDER=apinex, a
  // per-request `provider`, and as OpenRouter's fallback.
  "apinex",
];

/** Hard per-call timeout (ms) for every provider: LLM_TIMEOUT_MS, default 20 s. A timeout counts as a failure. */
export function llmTimeoutMs(): number {
  const v = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 20_000;
}

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced && hasKey(forced)) return forced;
  return AUTO_DETECT_ORDER.find(hasKey) ?? "none";
}

export function hasKey(provider: LlmProvider): boolean {
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
export function resolveProvider(preferred?: PreferredProvider): LlmProvider {
  if (process.env.LLM_PROVIDER === "none") return "none";
  const list: readonly LlmProvider[] =
    typeof preferred === "string" ? [preferred] : (preferred ?? []);
  for (const p of list) if (p !== "none" && hasKey(p)) return p;
  return llmProvider();
}

export function llmAvailable(preferred?: PreferredProvider) {
  return resolveProvider(preferred) !== "none";
}

export function llmModel(
  preferred?: PreferredProvider,
  models?: ModelOverrides,
): string {
  return modelFor(resolveProvider(preferred), models);
}

function modelFor(provider: LlmProvider, models?: ModelOverrides): string {
  const override = models?.[provider]?.trim();
  if (override && provider !== "none") return override;
  switch (provider) {
    case "xai":
      return process.env.XAI_MODEL || "grok-4";
    case "apinex":
      return process.env.APINEX_MODEL || DEFAULT_APINEX_MODEL;
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-opus-5";
    case "openrouter":
      return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    default:
      return "heuristic";
  }
}

/** Model name without the vendor prefix, e.g. "deepseek-v4-flash" (for logs; the UI never shows model names). */
export function llmShortModel(preferred?: PreferredProvider): string {
  return llmModel(preferred).split("/").pop() || "heuristic";
}

/** Label for logs/PRs/stored records, e.g. "llm:deepseek/deepseek-v4-flash". Pass the request's `provider` override to label it. */
export function llmLabel(
  preferred?: PreferredProvider,
  models?: ModelOverrides,
) {
  return llmAvailable(preferred)
    ? `llm:${llmModel(preferred, models)}`
    : "heuristic";
}

export interface TextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Preferred provider(s) for this call; the first with a key is used, else the default provider (see `resolveProvider`). */
  provider?: PreferredProvider;
  /** Model per provider for this call (also used when a failed call falls back to another provider). */
  models?: ModelOverrides;
  /** Hard timeout for this call (default `llmTimeoutMs()`). */
  timeoutMs?: number;
}

type OpenAiProvider = "xai" | "apinex" | "openrouter";

/** OpenAI-compatible client for xAI / Apinex / OpenRouter. OpenRouter gets its recommended attribution headers. */
function openaiClient(
  provider: OpenAiProvider,
  timeoutMs = llmTimeoutMs(),
): OpenAI {
  // No SDK retries (a 429 must not hit the same provider again) and a hard timeout (a timeout is a failure).
  const common = { timeout: timeoutMs, maxRetries: 0 };
  if (provider === "xai")
    return new OpenAI({
      ...common,
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
  if (provider === "apinex")
    return new OpenAI({
      ...common,
      apiKey: process.env.APINEX_API_KEY,
      baseURL: process.env.APINEX_BASE_URL || "https://api.apinex.bond/v1",
    });
  return new OpenAI({
    ...common,
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
function logAnswer(
  provider: LlmProvider,
  model: string,
  startedAt: number,
  note = "",
) {
  console.info(
    `[llm] ${provider} ${model} answered in ${Date.now() - startedAt}ms${note}`,
  );
}

const errorLine = (err: unknown) =>
  (err instanceof Error ? err.message : String(err))
    .replace(/\s+/g, " ")
    .slice(0, 160);

/** Where a failed call is retried (once): OpenRouter for the others, Apinex for OpenRouter; undefined = nowhere. */
export function fallbackFor(provider: LlmProvider): LlmProvider | undefined {
  if (provider === "none") return undefined;
  const to: LlmProvider = provider === "openrouter" ? "apinex" : "openrouter";
  return hasKey(to) ? to : undefined;
}

/** xAI, Apinex and OpenRouter all speak the OpenAI chat completions API. */
async function openAiCompatible(
  provider: OpenAiProvider,
  { system, prompt, maxTokens = 4000, models, timeoutMs }: TextRequest,
): Promise<{ text: string; model: string }> {
  const model = modelFor(provider, models);
  const ms = timeoutMs ?? llmTimeoutMs();
  const res = await timed(
    openaiClient(provider, ms).chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // OpenRouter extension, not in the OpenAI types.
      ...reasoningExtra(provider),
    }),
    ms + 1_000,
  );
  return {
    text: res.choices[0]?.message?.content ?? "",
    model: res.model || model,
  };
}

/** One call to one provider, no fallback. */
async function callProvider(
  provider: Exclude<LlmProvider, "none">,
  req: TextRequest,
): Promise<{ text: string; model: string }> {
  if (provider !== "anthropic") return openAiCompatible(provider, req);
  const ms = req.timeoutMs ?? llmTimeoutMs();
  const client = new Anthropic({ timeout: ms, maxRetries: 0 });
  const res = await timed(
    client.beta.messages.create({
      model: modelFor("anthropic", req.models),
      max_tokens: req.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    }),
    ms + 1_000,
  );
  if (res.stop_reason === "refusal") throw new Error("LLM refused the request");
  return {
    text: res.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    model: res.model || modelFor("anthropic", req.models),
  };
}

/**
 * Plain text completion. Throws if no provider is configured. A failed or timed-out call (429 included) is
 * retried once on `fallbackFor(provider)`, never on the same provider.
 */
/** After a 429, skip that provider until its Retry-After passes and go straight to the fallback. */
const coolingUntil = new Map<LlmProvider, number>();

function isRateLimit(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || /rate limit|too many requests/i.test(errorLine(err));
}

function retryAfterMs(err: unknown): number {
  const headers = (err as { headers?: Headers | Record<string, string> })?.headers;
  const raw = headers instanceof Headers ? headers.get("retry-after") : headers?.["retry-after"];
  const fromHeader = Number(raw);
  const fromText = Number(/retry in (\d+)\s*s/i.exec(errorLine(err))?.[1]);
  const seconds = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : Number.isFinite(fromText) && fromText > 0 ? fromText : 60;
  return Math.min(seconds, 300) * 1000;
}

/** Test hook: forget rate-limit cooldowns. */
export function resetLlmCooldowns() {
  coolingUntil.clear();
}

export async function generateText(req: TextRequest): Promise<string> {
  const provider = resolveProvider(req.provider);
  const startedAt = Date.now();
  if (provider !== "none") {
    const to = fallbackFor(provider);
    const canFallBack = Boolean(to && to !== "none");
    const cooling = canFallBack && (coolingUntil.get(provider) ?? 0) > Date.now();
    try {
      if (cooling) throw new Error("rate-limited recently; skipping until the cooldown ends");
      const res = await callProvider(provider, req);
      logAnswer(provider, res.model, startedAt);
      return res.text;
    } catch (err) {
      if (!to || to === "none") throw err;
      if (!cooling && isRateLimit(err)) coolingUntil.set(provider, Date.now() + retryAfterMs(err));
      if (!cooling)
        console.warn(
          `[llm] ${provider} ${modelFor(provider, req.models)} failed (${errorLine(err)}); retrying once via ${to}`,
        );
      const retryAt = Date.now();
      const res = await callProvider(to, req);
      logAnswer(to, res.model, retryAt, ` (fallback after ${provider} failed)`);
      return res.text;
    }
  }
  throw new Error(
    "No LLM provider configured (set XAI_API_KEY, APINEX_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY)",
  );
}

/* ------------------------------------------------------------------ routing report + health probe (ops only) */

/** Certificates: Grok direct, else Grok through OpenRouter (READINESS_GROK_MODEL), else the default provider. */
export const CERTIFY_PROVIDERS: readonly LlmProvider[] = ["xai", "openrouter"];
export const DEFAULT_READINESS_GROK_MODEL = "x-ai/grok-4-fast";
export function certifyModels(): ModelOverrides {
  return {
    openrouter:
      process.env.READINESS_GROK_MODEL?.trim() || DEFAULT_READINESS_GROK_MODEL,
  };
}
/** The assistant's tool loop: OpenRouter when it has a key, else the default provider. */
export const ASSISTANT_PROVIDERS: readonly LlmProvider[] = ["openrouter"];

export interface LlmRoute {
  provider: LlmProvider;
  /** Model id, or "heuristic". Ops only: never shown in the UI. */
  model: string;
}

function route(
  preferred?: PreferredProvider,
  models?: ModelOverrides,
): LlmRoute {
  const provider = resolveProvider(preferred);
  return {
    provider,
    model: provider === "none" ? "heuristic" : modelFor(provider, models),
  };
}

/** Who answers what right now, from the keys that are set (no network). */
export function llmRouting(): {
  default: LlmRoute;
  assistant: LlmRoute;
  certify: LlmRoute;
  /** Where a failed default call is retried (once), if anywhere. */
  fallback: LlmRoute | null;
  /** Auto-detect order. */
  order: LlmProvider[];
  /** Hard per-call timeout. */
  timeoutMs: number;
} {
  return {
    default: route(),
    assistant: route(ASSISTANT_PROVIDERS),
    certify: route(CERTIFY_PROVIDERS, certifyModels()),
    fallback: (() => {
      const to = fallbackFor(resolveProvider());
      return to ? { provider: to, model: modelFor(to) } : null;
    })(),
    order: [...AUTO_DETECT_ORDER],
    timeoutMs: llmTimeoutMs(),
  };
}

export interface ProviderHealth {
  provider: Exclude<LlmProvider, "none">;
  configured: boolean;
  ok: boolean;
  ms?: number;
  /** Model id that answered (ops only). */
  model?: string;
  /** Short error line (never a key or env value). */
  error?: string;
}

/**
 * One tiny call ("reply OK") straight to one provider: no fallback, so a broken provider shows as broken.
 * Never throws. Not configured → `{ configured: false, ok: false }` without a call.
 */
export async function probeProvider(
  provider: Exclude<LlmProvider, "none">,
  timeoutMs = 10_000,
): Promise<ProviderHealth> {
  if (!hasKey(provider)) return { provider, configured: false, ok: false };
  const started = Date.now();
  const req: TextRequest = {
    system: "You are a health check. Reply with the single word OK.",
    prompt: "reply OK",
    maxTokens: 16,
  };
  try {
    const call = callProvider(provider, { ...req, timeoutMs });
    const res = await timed(call, timeoutMs);
    return {
      provider,
      configured: true,
      ok: true,
      ms: Date.now() - started,
      model: res.model,
    };
  } catch (err) {
    return {
      provider,
      configured: true,
      ok: false,
      ms: Date.now() - started,
      model: modelFor(provider),
      error: errorLine(err).replace(
        /(sk|xai|or|apx)-[\w-]{6,}/gi,
        "[redacted]",
      ),
    };
  }
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
  provider?: PreferredProvider;
  models?: ModelOverrides;
  /** Run the calls of one model turn concurrently (only for side-effect-free tools). Default: in order. */
  parallel?: boolean;
  /** Per model call. Default `llmTimeoutMs()` (LLM_TIMEOUT_MS, 20 s). */
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
  const startedAt = Date.now();
  const model = modelFor(provider, req.models);
  const res = await openaiClient(
    provider,
    req.timeoutMs ?? llmTimeoutMs(),
  ).chat.completions.create({
    model,
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
  logAnswer(provider, res.model || model, startedAt);
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
    models: req.models,
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
 * Agentic tool loop. OpenRouter/xAI/Apinex use native OpenAI-compatible tool calling (multi-turn: the assistant's
 * tool calls and each tool result are fed back as messages; several calls per turn are supported). Anthropic,
 * or a model that rejects `tools`, uses a prompted-JSON loop over the same tools. Bounded by `maxSteps`, a
 * per-call timeout and an optional wall-clock budget; the final turn has tools disabled so the model answers.
 * A failed or timed-out turn is retried once on `fallbackFor(provider)`, which then runs the rest of the loop.
 * Throws if no provider is configured or a model call fails (callers keep their heuristic fallback).
 */
export async function runToolLoop(
  req: ToolLoopRequest,
): Promise<ToolLoopResult> {
  let provider = resolveProvider(req.provider);
  if (provider === "none") throw new Error("No LLM provider configured");
  let fellBack = false;
  const maxSteps = Math.max(0, req.maxSteps ?? 6);
  const timeoutMs = req.timeoutMs ?? llmTimeoutMs();
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
        const to = fallbackFor(provider);
        if (!toolsUnsupported(err) && !fellBack && to && to !== "anthropic") {
          // Failed or timed out (429 included): retry this turn (and the rest of the loop) once on the fallback.
          console.warn(
            `[llm] ${provider} ${modelFor(provider, req.models)} failed (${errorLine(err)}); retrying once via ${to}`,
          );
          provider = to;
          fellBack = true;
          turn = await timed(
            nativeTurn(to as OpenAiProvider, req, trace, last, step),
            timeoutMs,
          );
        } else {
          if (!toolsUnsupported(err)) throw err;
          console.warn(
            "[llm] native tool calling unsupported, using JSON tool calls:",
            errorLine(err),
          );
          mode = "json";
          turn = await timed(
            jsonTurn(provider, req, trace, last, step),
            timeoutMs,
          );
        }
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
          req.execute(c).catch(
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

/* ------------------------------------------------------------------ internals for lib/llm/team */

/** Shared pieces the agent team's routed tool loop (lib/llm/team) builds on, so both use one client setup. */
export const llmInternals = { modelFor, openaiClient, reasoningExtra, logAnswer, errorLine, isRateLimit, retryAfterMs, coolingUntil, timed };
export type { OpenAiProvider };
