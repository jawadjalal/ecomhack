/**
 * Provider-agnostic LLM helper for server code.
 *
 * Provider is picked from env:
 *   LLM_PROVIDER=xai|apinex|anthropic|openrouter|none   (optional, else auto-detect)
 *   XAI_API_KEY         → Grok via xAI's OpenAI-compatible API (hackathon sponsor)
 *   ANTHROPIC_API_KEY   → Claude via @anthropic-ai/sdk
 *   OPENROUTER_API_KEY  → any OpenRouter model. Default: DeepSeek V4 Flash (deepseek/deepseek-v4.1-flash), the model
 *                         Darwin and most calls run on.
 *   APINEX_API_KEY      → APINex's OpenAI-compatible API (https://api.apinex.bond/v1, default model free/gpt-6-luna).
 *                         Free models need a daily check-in on apinex.bond. Used for the team's editor (Pixel,
 *                         APINEX_EDITOR_MODEL), for tasks flagged hard, and as overflow when OpenRouter is busy.
 *   XAI_MODEL / APINEX_MODEL / APINEX_EDITOR_MODEL / ANTHROPIC_MODEL / OPENROUTER_MODEL override the default model.
 *   OPENROUTER_REASONING=off  → ask OpenRouter to skip the model's thinking (faster loop steps).
 *   OPENROUTER_MAX_CONCURRENT (default 4) → above this many OpenRouter calls in flight, routed calls overflow to APINex.
 *
 * Auto-detect order: xAI (sponsor) → Anthropic → OpenRouter → APINex. If a call fails it is retried once on the other
 * of OpenRouter / APINex (whichever has a key), then the caller's heuristic. Every answered call logs one line with
 * the provider and model (never the prompt).
 *
 * `runToolLoop` is the agent loop the team (lib/team) uses: native OpenAI-style tool calling, falling back to a JSON
 * protocol when a provider rejects tools, and to the next provider on 402/429/5xx/network errors.
 *
 * With no key, `llmAvailable()` is false and callers MUST fall back to heuristics,
 * so the demo always runs offline.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";

export type LlmProvider = "xai" | "apinex" | "anthropic" | "openrouter" | "none";
/** "editor": the team's website/code editor (Pixel) runs on APINEX_EDITOR_MODEL. */
export type LlmRole = "default" | "editor";

export function llmProvider(): LlmProvider {
  const forced = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (forced === "none") return "none";
  if (forced === "xai" && process.env.XAI_API_KEY) return "xai";
  if (forced === "apinex" && process.env.APINEX_API_KEY) return "apinex";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.XAI_API_KEY) return "xai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.APINEX_API_KEY) return "apinex";
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
  return modelFor(resolveProvider(preferred));
}

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";
export const DEFAULT_APINEX_MODEL = "free/gpt-6-luna";
export const APINEX_BASE_URL = "https://api.apinex.bond/v1";

function modelFor(provider: LlmProvider, role: LlmRole = "default"): string {
  switch (provider) {
    case "xai":
      return process.env.XAI_MODEL || "grok-4";
    case "apinex":
      if (role === "editor") return process.env.APINEX_EDITOR_MODEL || process.env.APINEX_MODEL || DEFAULT_APINEX_MODEL;
      return process.env.APINEX_MODEL || DEFAULT_APINEX_MODEL;
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || "claude-opus-5";
    case "openrouter":
      return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    default:
      return "heuristic";
  }
}

/** Label for UI/PRs, e.g. "llm:grok-4". */
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

/** One line per answered call: which provider and model answered, and how long it took. Never the prompt. */
function logAnswer(provider: LlmProvider, model: string, startedAt: number, note = "") {
  console.info(`[llm] ${provider} ${model} answered in ${Date.now() - startedAt}ms${note}`);
}

const errorLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 160);

type OpenAiProvider = "xai" | "apinex" | "openrouter";

/** Server-side only: keys never leave this module. */
function openAiClient(provider: OpenAiProvider): OpenAI {
  if (provider === "xai") return new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
  if (provider === "apinex") return new OpenAI({ apiKey: process.env.APINEX_API_KEY, baseURL: process.env.APINEX_BASE_URL || APINEX_BASE_URL });
  return new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", defaultHeaders: { "X-Title": "Darwin" } });
}

/** OpenRouter extension (not in the OpenAI types): skip the model's thinking. */
function openRouterExtras(provider: LlmProvider): object {
  return provider === "openrouter" && process.env.OPENROUTER_REASONING === "off" ? { reasoning: { enabled: false } } : {};
}

/** xAI, Apinex and OpenRouter all speak the OpenAI chat completions API. */
async function openAiCompatible(provider: OpenAiProvider, { system, prompt, maxTokens = 4000 }: TextRequest, role: LlmRole = "default"): Promise<{ text: string; model: string }> {
  const model = modelFor(provider, role);
  const res = await withSlot(provider, () =>
    openAiClient(provider).chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      ...openRouterExtras(provider),
    }),
  );
  return { text: res.choices[0]?.message?.content ?? "", model: res.model || model };
}

/** The other OpenAI-compatible provider to retry on: xAI/APINex → OpenRouter, OpenRouter → APINex. */
function retryProviderFor(provider: LlmProvider): OpenAiProvider | undefined {
  if (provider === "openrouter") return hasKey("apinex") ? "apinex" : undefined;
  if (provider === "xai" || provider === "apinex") return hasKey("openrouter") ? "openrouter" : undefined;
  return undefined;
}

/** Plain text completion. Throws if no provider is configured. */
export async function generateText(req: TextRequest): Promise<string> {
  const provider = resolveProvider(req.provider);
  const startedAt = Date.now();
  if (provider === "xai" || provider === "apinex" || provider === "openrouter") {
    try {
      const res = await openAiCompatible(provider, req);
      logAnswer(provider, res.model, startedAt);
      return res.text;
    } catch (err) {
      const retry = retryProviderFor(provider);
      if (!retry) throw err;
      console.warn(`[llm] ${provider} ${modelFor(provider)} failed (${errorLine(err)}); retrying once via ${retry === "openrouter" ? "OpenRouter" : "APINex"}`);
      const retryAt = Date.now();
      const res = await openAiCompatible(retry, req);
      logAnswer(retry, res.model, retryAt, ` (fallback after ${provider} failed)`);
      return res.text;
    }
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

/* ------------------------------------------------------------------ routing (team policy) */

/** How a call should be routed: the team's editor role, or a task flagged hard, prefers APINex. */
export interface LlmRoute {
  role?: LlmRole;
  hard?: boolean;
}

const g = globalThis as unknown as { __darwinLlmInFlight?: Record<string, number> };
const inFlight = (g.__darwinLlmInFlight ??= {});

/** Calls currently in flight per provider (in-process). */
export function llmInFlight(provider: LlmProvider): number {
  return inFlight[provider] ?? 0;
}

function openRouterLimit(): number {
  const n = Number(process.env.OPENROUTER_MAX_CONCURRENT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
}

/** Count a call against its provider while it runs (the overflow semaphore). */
async function withSlot<T>(provider: LlmProvider, fn: () => Promise<T>): Promise<T> {
  inFlight[provider] = (inFlight[provider] ?? 0) + 1;
  try {
    return await fn();
  } finally {
    inFlight[provider] = Math.max(0, (inFlight[provider] ?? 1) - 1);
  }
}

/**
 * Providers to try, in order, for a routed call. Policy: DeepSeek V4 Flash via OpenRouter by default; APINex first for
 * the editor role, for hard tasks, and as overflow when OPENROUTER_MAX_CONCURRENT calls are already in flight. Each falls
 * back to the other; the auto-detected default (xAI / Anthropic) is the last resort. Empty → heuristics.
 */
export function routeProviders(route: LlmRoute = {}): LlmProvider[] {
  if (process.env.LLM_PROVIDER === "none") return [];
  const or = hasKey("openrouter");
  const ax = hasKey("apinex");
  const preferApinex = ax && (route.role === "editor" || route.hard === true || !or || llmInFlight("openrouter") >= openRouterLimit());
  const chain: LlmProvider[] = [];
  if (preferApinex) chain.push("apinex");
  if (or) chain.push("openrouter");
  if (ax && !chain.includes("apinex")) chain.push("apinex");
  const fallback = llmProvider();
  if (fallback !== "none" && !chain.includes(fallback)) chain.push(fallback);
  return chain;
}

/** "llm:<model>" of the first provider a routed call would use, or "heuristic". */
export function routeLabel(route: LlmRoute = {}): string {
  const first = routeProviders(route)[0];
  return first ? `llm:${modelFor(first, route.role)}` : "heuristic";
}

/* ------------------------------------------------------------------ tool loop */

/** A tool the model may call. `parameters` is a JSON schema object (e.g. from z.toJSONSchema). */
export interface LoopToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LoopMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LoopToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolLoopOptions {
  system: string;
  /** Conversation so far (last one should be the user's ask). */
  messages: LoopMessage[];
  tools: LoopToolDef[];
  /** Run one call; return the observation for the model. `stop: true` ends the loop with `stopText` (e.g. a report). */
  onToolCall: (call: LoopToolCall) => Promise<{ content: string; stop?: boolean; stopText?: string }>;
  /** Model turns before it must answer (default 6). */
  maxSteps?: number;
  maxTokens?: number;
  route?: LlmRoute;
}

export interface ToolLoopResult {
  /** The model's final answer (or the stopping tool's `stopText`). */
  text: string;
  provider: LlmProvider;
  model: string;
  steps: number;
  toolCalls: number;
  /** "json" when the provider rejected native tools and the loop used the JSON protocol. */
  mode: "tools" | "json";
  /** A tool ended the loop. */
  stopped: boolean;
}

type Turn =
  | { role: "user" | "assistant"; content: string }
  | { role: "calls"; content: string; calls: { id: string; name: string; args: Record<string, unknown> }[] }
  | { role: "result"; id: string; name: string; content: string };

interface StepAnswer {
  text: string;
  calls: { id: string; name: string; args: Record<string, unknown> }[];
  model: string;
}

/** Providers (per model) that rejected native tool calling this process: they get the JSON protocol. */
const g2 = globalThis as unknown as { __darwinNoTools?: Set<string> };
const noTools = (g2.__darwinNoTools ??= new Set());

function errorStatus(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

/** The provider can't do tool calling (as opposed to being down, out of credit or rate limited). */
function toolsRejected(err: unknown): boolean {
  const status = errorStatus(err);
  return (status === 400 || status === 404 || status === 422 || status === 501) && /tool|function/i.test(errorLine(err));
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function toolsStep(provider: OpenAiProvider, opts: ToolLoopOptions, turns: Turn[], final: boolean): Promise<StepAnswer> {
  const model = modelFor(provider, opts.route?.role);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }];
  for (const t of turns) {
    if (t.role === "user" || t.role === "assistant") messages.push({ role: t.role, content: t.content });
    else if (t.role === "calls")
      messages.push({
        role: "assistant",
        content: t.content || null,
        tool_calls: t.calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      });
    else if (t.role === "result") messages.push({ role: "tool", tool_call_id: t.id, content: t.content });
  }
  const res = await withSlot(provider, () =>
    openAiClient(provider).chat.completions.create({
      model,
      max_tokens: opts.maxTokens ?? 1500,
      messages,
      tools: opts.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: final ? "none" : "auto",
      ...openRouterExtras(provider),
    }),
  );
  const msg = res.choices[0]?.message;
  const calls = (msg?.tool_calls ?? [])
    .filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === "function")
    .map((c, i) => ({ id: c.id || `call_${i}`, name: c.function.name, args: parseArgs(c.function.arguments) }));
  return { text: msg?.content ?? "", calls: final ? [] : calls, model: res.model || model };
}

function jsonProtocol(tools: LoopToolDef[], final: boolean): string {
  const catalog = tools.map((t) => `- ${t.name}: ${t.description} args: ${JSON.stringify((t.parameters as { properties?: unknown }).properties ?? {})}`).join("\n");
  return `TOOLS:\n${catalog}\n\n${
    final
      ? 'You are out of steps. Answer now with {"reply": "<your answer>"}.'
      : 'Answer with ONE JSON object: {"tool": "<name>", "args": {…}} to call a tool, or {"reply": "<your answer>"} when done. No prose, no code fences.'
  }`;
}

function renderTranscript(turns: Turn[]): string {
  return turns
    .map((t) => {
      if (t.role === "user") return `USER: ${t.content}`;
      if (t.role === "assistant") return `YOU: ${t.content}`;
      if (t.role === "calls") return t.calls.map((c) => `YOU CALLED: ${c.name}(${JSON.stringify(c.args)})`).join("\n");
      return t.role === "result" ? `RESULT of ${t.name}: ${t.content}` : "";
    })
    .join("\n");
}

async function jsonStep(provider: LlmProvider, opts: ToolLoopOptions, turns: Turn[], final: boolean, step: number): Promise<StepAnswer> {
  const system = `${opts.system}\n\n${jsonProtocol(opts.tools, final)}`;
  const prompt = renderTranscript(turns);
  let text: string;
  let model = modelFor(provider, opts.route?.role);
  if (provider === "anthropic") {
    const client = new Anthropic();
    const res = await client.messages.create({ model, max_tokens: opts.maxTokens ?? 1500, system, messages: [{ role: "user", content: prompt }] });
    text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    model = res.model || model;
  } else if (provider === "xai" || provider === "apinex" || provider === "openrouter") {
    const res = await withSlot(provider, () =>
      openAiClient(provider).chat.completions.create({
        model,
        max_tokens: opts.maxTokens ?? 1500,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        ...openRouterExtras(provider),
      }),
    );
    text = res.choices[0]?.message?.content ?? "";
    model = res.model || model;
  } else throw new Error("No LLM provider configured");
  let parsed: { tool?: unknown; args?: unknown; reply?: unknown } = {};
  try {
    parsed = extractJson(text) as typeof parsed;
  } catch {
    return { text: text.trim(), calls: [], model };
  }
  if (!final && typeof parsed.tool === "string" && parsed.tool) {
    const args = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? (parsed.args as Record<string, unknown>) : {};
    return { text: "", calls: [{ id: `json_${step}`, name: parsed.tool, args }], model };
  }
  return { text: typeof parsed.reply === "string" ? parsed.reply : text.trim(), calls: [], model };
}

/**
 * The agent loop: the model calls tools (several per turn run concurrently) until it answers, a tool stops it, or
 * `maxSteps` runs out. Each model turn tries the route's providers in order: a provider that rejects native tools
 * is retried with the JSON protocol; any other failure moves to the next provider. Throws only if every provider
 * failed on a turn (callers then fall back to heuristics / the tool results they already have).
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const chain = routeProviders(opts.route);
  if (!chain.length) throw new Error("No LLM provider configured");
  const maxSteps = Math.max(1, opts.maxSteps ?? 6);
  const turns: Turn[] = opts.messages.map((m) => ({ role: m.role, content: m.content }));
  let current = 0;
  let toolCalls = 0;
  let mode: ToolLoopResult["mode"] = "tools";

  for (let step = 0; step < maxSteps; step++) {
    const final = step === maxSteps - 1;
    let answer: StepAnswer | undefined;
    let provider: LlmProvider = chain[current];
    let lastErr: unknown;
    for (let i = current; i < chain.length && !answer; i++) {
      provider = chain[i];
      const key = `${provider}:${modelFor(provider, opts.route?.role)}`;
      const startedAt = Date.now();
      const native = provider !== "anthropic" && !noTools.has(key);
      try {
        answer = native ? await toolsStep(provider as OpenAiProvider, opts, turns, final) : await jsonStep(provider, opts, turns, final, step);
        if (!native) mode = "json";
        current = i;
        logAnswer(provider, answer.model, startedAt, i > 0 ? ` (fallback after ${chain[i - 1]} failed)` : "");
      } catch (err) {
        if (native && toolsRejected(err)) {
          noTools.add(key);
          try {
            answer = await jsonStep(provider, opts, turns, final, step);
            mode = "json";
            current = i;
            logAnswer(provider, answer.model, startedAt, " (json tools)");
            break;
          } catch (err2) {
            lastErr = err2;
          }
        } else lastErr = err;
        console.warn(`[llm] ${provider} ${modelFor(provider, opts.route?.role)} failed (${errorLine(lastErr)})${i + 1 < chain.length ? `; trying ${chain[i + 1]}` : ""}`);
      }
    }
    if (!answer) throw lastErr ?? new Error("Every LLM provider failed");

    if (!answer.calls.length) {
      return { text: answer.text.trim(), provider, model: answer.model, steps: step + 1, toolCalls, mode, stopped: false };
    }
    turns.push({ role: "calls", content: answer.text, calls: answer.calls });
    const results = await Promise.all(answer.calls.map((c) => opts.onToolCall({ name: c.name, args: c.args })));
    toolCalls += answer.calls.length;
    answer.calls.forEach((c, i) => turns.push({ role: "result", id: c.id, name: c.name, content: results[i].content.slice(0, 4000) }));
    const stop = results.find((r) => r.stop);
    if (stop) return { text: (stop.stopText ?? stop.content).trim(), provider, model: answer.model, steps: step + 1, toolCalls, mode, stopped: true };
  }
  // maxSteps reached with a tool call on the final turn is impossible (final turns get no tools); keep TS happy.
  return { text: "", provider: chain[current], model: modelFor(chain[current], opts.route?.role), steps: maxSteps, toolCalls, mode, stopped: false };
}
