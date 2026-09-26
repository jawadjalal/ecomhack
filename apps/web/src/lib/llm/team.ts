/**
 * The agent team's routed tool loop (lib/team). Built on the shared client in ./client (same keys, timeouts,
 * 429 cooldowns and logging). Routing policy: DeepSeek via OpenRouter by default; APINex first for the editor
 * role (Pixel, APINEX_EDITOR_MODEL), for tasks flagged hard, and as overflow when OPENROUTER_MAX_CONCURRENT calls
 * are in flight. A provider that rejects native tools gets a JSON tool protocol; any other failure moves on.
 */
import Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { extractJson, hasKey, llmProvider, llmTimeoutMs, llmInternals, type LlmProvider, type OpenAiProvider } from "./client";

const { openaiClient, reasoningExtra, logAnswer, errorLine, isRateLimit, retryAfterMs, coolingUntil } = llmInternals;

/** "editor": the team's website/code editor (Pixel) runs on APINEX_EDITOR_MODEL. */
export type LlmRole = "default" | "editor";

function modelFor(provider: LlmProvider, role: LlmRole = "default"): string {
  if (role === "editor" && provider === "apinex") {
    const m = process.env.APINEX_EDITOR_MODEL?.trim();
    if (m) return m;
  }
  return llmInternals.modelFor(provider);
}

const openAiClient = (provider: OpenAiProvider) => openaiClient(provider, llmTimeoutMs());
const openRouterExtras = reasoningExtra;
const coolingNow = (provider: LlmProvider) => (coolingUntil.get(provider) ?? 0) > Date.now();

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
    const client = new Anthropic({ timeout: llmTimeoutMs(), maxRetries: 0 });
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
      if (i + 1 < chain.length && coolingNow(provider)) {
        lastErr = new Error(`${provider} was rate-limited recently; skipping until the cooldown ends`);
        continue;
      }
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
        if (isRateLimit(lastErr)) coolingUntil.set(provider, Date.now() + retryAfterMs(lastErr));
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
