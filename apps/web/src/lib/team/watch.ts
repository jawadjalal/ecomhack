/**
 * Darwin's heartbeat. OWNED BY: team.
 *
 *   runWatch({ reason, origin })  one pass: Iris and Fizz look, in parallel, through their real tools;
 *                                 the notability gate decides whether Darwin speaks; the Inbox gets at most
 *                                 one message, and configured channels get a copy.
 *   watchState()                  what the console strip shows.
 *   inboxView()                    what the Grok bot reads.
 *   updateAutonomy()               the Settings control and the command.
 *
 * Two overlapping runs can't both send: a lease in the json store. A run that hits its budget (tool calls,
 * model calls, or 60 seconds) stops cleanly and says so in the log. Every number in a message comes from a
 * tool result in that run; if a check throws, Darwin says what he couldn't look at.
 */
import type { TeamEvent } from "@/lib/contracts/team";
import type {
  AutonomyResponse,
  InboxMessage,
  Policy,
  QuietReason,
  Signal,
  TeamInboxResponse,
  WatchCheckReport,
  WatchRun,
  WatchRunResponse,
  WatchSettings,
  WatchStateResponse,
} from "@/lib/contracts/watch";
import { generateText, llmAvailable } from "@/lib/llm/client";
import { id } from "@/lib/ids";
import { executeWatchAction, mintActions, proposedActions, toProactive } from "./actions";
import { AUTONOMY_BLURB, canRunUnattended, compilePolicy, isAutonomyLevel, type PolicyFacts } from "./autonomy";
import { deliver, type OutboundMessage } from "./channels";
import { digestDue, gate, type GateContext } from "./notability";
import { couldNotCheck, heuristicDigest, heuristicMessage, personaSystem } from "./persona";
import { CHECKS, type Check, type CheckContext, type WatchToolResult } from "./signals";
import { addMessage, createChat, ensureInboxChat, listChatSummaries, listMessages, setChatStatus } from "./store";
import { parseCall, runTeamTool } from "./tools";
import {
  acquireLease,
  attachSignalChat,
  findSignal,
  getPolicy,
  getWatchSettings,
  lastRun,
  listMemory,
  listPolicies,
  listRuns,
  listSent,
  markPolicyUsed,
  openTokens,
  recordSent,
  releaseLease,
  remember,
  removePolicy,
  savePolicy,
  saveRun,
  setWatchSettings,
} from "./watch-store";

export const WATCH_INTERVAL_MS = 15 * 60 * 1000;
export const WATCH_BUDGET = { toolCalls: 24, llmCalls: 2, wallMs: 60_000 } as const;

type Listener = (event: TeamEvent) => void;
const bus = () => ((globalThis as unknown as { __darwinTeamBus?: Set<Listener> }).__darwinTeamBus ??= new Set<Listener>());

/** An open console (or a test) hears proactive messages as they are written. */
export function subscribeTeamEvents(listener: Listener): () => void {
  bus().add(listener);
  return () => bus().delete(listener);
}

function publish(event: TeamEvent) {
  for (const listener of bus()) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[watch] listener failed", err);
    }
  }
}

/* ------------------------------------------------------------------ one run */

interface Budget {
  toolCalls: number;
  llmCalls: number;
  wallMs: number;
  started: number;
  hit?: keyof typeof WATCH_BUDGET;
}

/** Wall-clock budget, separate from the logical clock tests inject. */
function freshBudget(): Budget {
  return { toolCalls: 0, llmCalls: 0, wallMs: 0, started: Date.now() };
}

function overBudget(budget: Budget, now: number): keyof typeof WATCH_BUDGET | undefined {
  budget.wallMs = now - budget.started;
  if (budget.wallMs >= WATCH_BUDGET.wallMs) return "wallMs";
  if (budget.toolCalls >= WATCH_BUDGET.toolCalls) return "toolCalls";
  if (budget.llmCalls >= WATCH_BUDGET.llmCalls) return "llmCalls";
  return undefined;
}

export interface RunWatchOptions {
  reason?: WatchRun["reason"];
  origin?: string;
  /** Tests inject the clock. Defaults to Date.now(). */
  now?: number;
  emit?: (event: TeamEvent) => void;
}

/** One heartbeat. Returns quickly with `ran: false` when another run holds the lease. */
export async function runWatch(opts: RunWatchOptions = {}): Promise<WatchRunResponse> {
  const now = opts.now ?? Date.now();
  const holder = acquireLease(now);
  if (!holder) {
    return { ok: true, ran: false, text: "A watch run is already in progress, so this one stayed out of its way." };
  }
  const emit: (event: TeamEvent) => void = (event) => {
    opts.emit?.(event);
    publish(event);
  };
  const budget = freshBudget();
  const origin = opts.origin?.replace(/\/+$/, "") || process.env.DARWIN_PUBLIC_URL?.replace(/\/+$/, "") || "http://localhost:3000";
  const run: WatchRun = {
    id: id("watch"),
    at: new Date(now).toISOString(),
    reason: opts.reason ?? "manual",
    durationMs: 0,
    checks: [],
    signals: [],
    verdicts: [],
    messageIds: [],
    used: { toolCalls: 0, llmCalls: 0, wallMs: 0 },
  };
  try {
    const previous = listRuns().flatMap((r) => r.signals);
    const ctx = checkContext({ now, origin, budget, previous, lastRunAt: lastRun()?.at });
    const groups = groupChecks();
    const reports = (await Promise.all(groups.map((group) => runGroup(group, ctx, budget)))).flat();
    run.signals = dedupe(reports.flatMap((r) => r.found ?? []));
    run.checks = reports.map(({ id: checkId, agent, label, ok, ms, signals, error }) => ({
      id: checkId,
      agent,
      label,
      ok,
      ms,
      signals,
      ...(error ? { error } : {}),
    }));

    const settings = getWatchSettings();
    const gateCtx: GateContext = { now, settings, sent: listSent(), memory: listMemory() };
    const decided = gate(run.signals, gateCtx);
    run.verdicts = decided.verdicts;
    const failed = reports.filter((r) => !r.ok).map((r) => r.label);
    const delivered: NonNullable<WatchRun["delivered"]> = [];
    const speakCtx: SpeakCtx = { now, origin, emit, budget, failed, settings, delivered };

    if (decided.speak && !budget.hit) {
      const messageId = await speak(decided.speak, speakCtx);
      if (messageId) run.messageIds.push(messageId);
    }
    if (!run.messageIds.length && digestDue(gateCtx, decided.digest.length > 0) && !budget.hit) {
      const messageId = await postDigest(decided.digest, speakCtx);
      if (messageId) run.messageIds.push(messageId);
    }
    if (!run.messageIds.length) run.quiet = quietReason(decided.verdicts, settings);
    if (delivered.length) run.delivered = delivered;

    run.budgetHit = budget.hit;
    run.used = { toolCalls: budget.toolCalls, llmCalls: budget.llmCalls, wallMs: Date.now() - budget.started };
    run.durationMs = run.used.wallMs;
    saveRun(run);
    const text = describeRun(run, failed);
    console.info(`[watch] ${text}`);
    return { ok: true, ran: true, text, run };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[watch] run failed", err);
    run.durationMs = Date.now() - budget.started;
    run.used = { toolCalls: budget.toolCalls, llmCalls: budget.llmCalls, wallMs: run.durationMs };
    run.quiet = "budget";
    saveRun(run);
    return { ok: false, ran: true, text: `The watch run stopped: ${message}`, run };
  } finally {
    releaseLease(holder);
  }
}

/** Checks hand their signals back through the report so a failed check can still return what it found. */
interface CheckReport extends WatchCheckReport {
  /** Signals this check found. Stripped before the run is saved (they live on `run.signals`). */
  found?: Signal[];
}

function groupChecks(): Check[][] {
  const iris = CHECKS.filter((c) => c.agent === "iris");
  const fizz = CHECKS.filter((c) => c.agent === "fizz");
  const rest = CHECKS.filter((c) => c.agent !== "iris" && c.agent !== "fizz");
  return [iris, fizz, rest].filter((g) => g.length);
}

async function runGroup(checks: Check[], ctx: CheckContext, budget: Budget): Promise<CheckReport[]> {
  const out: CheckReport[] = [];
  for (const check of checks) {
    const started = Date.now();
    const hit = overBudget(budget, started);
    if (hit) {
      budget.hit = hit;
      out.push({ id: check.id, agent: check.agent, label: check.label, ok: false, ms: 0, signals: 0, error: `Stopped: the ${hit === "wallMs" ? "time" : hit === "toolCalls" ? "tool-call" : "model"} budget for this run was used up.` });
      continue;
    }
    try {
      const found = await check.run(ctx);
      out.push({ id: check.id, agent: check.agent, label: check.label, ok: true, ms: Date.now() - started, signals: found.length, found });
    } catch (err) {
      out.push({
        id: check.id,
        agent: check.agent,
        label: check.label,
        ok: false,
        ms: Date.now() - started,
        signals: 0,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 240),
      });
    }
  }
  return out;
}

function checkContext(opts: { now: number; origin: string; budget: Budget; previous: Signal[]; lastRunAt?: string }): CheckContext {
  return {
    now: opts.now,
    origin: opts.origin,
    previous: opts.previous,
    lastRunAt: opts.lastRunAt,
    exhausted: () => !!overBudget(opts.budget, Date.now()),
    async call(tool, args = {}): Promise<WatchToolResult> {
      const hit = overBudget(opts.budget, Date.now());
      if (hit) {
        opts.budget.hit = hit;
        return { tool, ok: false, summary: `Couldn't run ${tool}: this watch run used up its ${hit === "wallMs" ? "time" : "tool-call"} budget.` };
      }
      opts.budget.toolCalls++;
  const agent = (["iris", "fizz", "dash", "pixel", "darwin"] as const).find((a) => {
        const parsed = parseCall(a, tool, args);
        return !("error" in parsed);
      });
  if (!agent) return { tool, ok: false, summary: `No one on the team has a tool called ${tool}.` };
  const prepared = parseCall(agent, tool, args);
      if ("error" in prepared) return { tool, ok: false, summary: prepared.error };
      const outcome = await runTeamTool(prepared.tool, prepared.args, { origin: opts.origin });
      return { tool, ok: outcome.ok, summary: outcome.summary, data: outcome.data, synthetic: outcome.synthetic };
    },
  };
}

function dedupe(signals: Signal[]): Signal[] {
  const byKey = new Map<string, Signal>();
  for (const signal of signals) {
    const prev = byKey.get(signal.fingerprint);
    if (!prev || (signal.score ?? 0) > (prev.score ?? 0)) byKey.set(signal.fingerprint, signal);
  }
  return [...byKey.values()];
}

function quietReason(verdicts: WatchRun["verdicts"], settings: WatchSettings): QuietReason {
  if (!settings.enabled || settings.autonomy === "off") return "autonomy-off";
  if (!verdicts.length) return "nothing-notable";
  const counts = new Map<QuietReason, number>();
  for (const v of verdicts) {
    if (v.spoke || !v.reason) continue;
    counts.set(v.reason, (counts.get(v.reason) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? "nothing-notable";
}

const QUIET_TEXT: Record<QuietReason, string> = {
  "nothing-notable": "Nothing notable enough to interrupt you.",
  duplicate: "I've already told you about what's going on, and it hasn't got worse.",
  "rate-limited": "I already messaged you recently, so this one waits.",
  "quiet-hours": "It's quiet hours, so I held it for the morning.",
  "autonomy-off": "Watching is on, but Darwin is set to stay silent.",
  cooldown: "You said no to this, and the numbers haven't moved enough to ask again.",
  budget: "I ran out of time before I could finish the check.",
};

function describeRun(run: WatchRun, failed: string[]): string {
  const looked = run.checks.map((c) => c.label).join(", ") || "nothing";
  const head = `Looked at ${looked}. ${run.signals.length} signal${run.signals.length === 1 ? "" : "s"}, ${run.messageIds.length} message${run.messageIds.length === 1 ? "" : "s"}.`;
  const quiet = run.messageIds.length ? "" : ` ${QUIET_TEXT[run.quiet ?? "nothing-notable"]}`;
  const missed = failed.length ? ` Couldn't check ${failed.join(", ")}.` : "";
  const budget = run.budgetHit ? " Stopped early: budget used up." : "";
  return `${head}${quiet}${missed}${budget}`;
}

/* ------------------------------------------------------------------ speaking */

interface SpeakCtx {
  now: number;
  origin: string;
  emit: (event: TeamEvent) => void;
  budget: Budget;
  failed: string[];
  settings: WatchSettings;
  delivered: NonNullable<WatchRun["delivered"]>;
}

async function speak(signal: Signal, ctx: SpeakCtx): Promise<string | undefined> {
  const chat = ensureInboxChat();
  const action = signal.suggestedAction;
  const facts = policyFacts(signal);
  if (action && action.type !== "open" && action.type !== "dismiss") {
    const decision = canRunUnattended(action, facts, { now: ctx.now, level: ctx.settings.autonomy });
    if (decision.allowed) return runUnattended(signal, decision.policy, decision.reason, ctx);
  }
  const text = await compose(signal, ctx);
  const tokens = mintActions(proposedActions(signal), { chatId: chat.id, signal, now: ctx.now, riskLabel: signal.title });
  const message = addMessage({
    chatId: chat.id,
    from: "darwin",
    text,
    kind: "report",
    ...(signal.synthetic ? { synthetic: true } : {}),
    signalId: signal.id,
    ...(tokens.length ? { actions: tokens.map(toProactive) } : {}),
    ...(signal.href ? { link: { label: "Show me", href: signal.href } } : {}),
  });
  ctx.emit({ type: "message", message });
  recordSent({ messageId: message.id, fingerprint: signal.fingerprint, signalId: signal.id, severity: signal.severity, score: signal.score ?? 0, at: message.at });
  const outbound: OutboundMessage = { text, severity: signal.severity, synthetic: signal.synthetic, actions: tokens.map(toProactive), href: signal.href };
  ctx.delivered.push(...(await deliver(outbound)));
  return message.id;
}

async function compose(signal: Signal, ctx: SpeakCtx): Promise<string> {
  const caveat = couldNotCheck(ctx.failed);
  const fallback = [heuristicMessage(signal), caveat].filter(Boolean).join(" ");
  if (!llmAvailable() || ctx.budget.llmCalls >= WATCH_BUDGET.llmCalls) return fallback;
  ctx.budget.llmCalls++;
  try {
    const text = (
      await generateText({
        system: personaSystem("Turn the facts below into the one message you send the merchant. Use only these facts. If a fact says simulated, keep that word."),
        prompt: `Signal: ${signal.title}\nFacts:\n${signal.facts.map((f) => `- ${f}`).join("\n")}${caveat ? `\nAlso say: ${caveat}` : ""}`,
        maxTokens: 220,
      })
    ).trim();
    if (!text || inventedNumber(text, signal.facts.join(" "))) return fallback;
    return text.slice(0, 600);
  } catch (err) {
    console.warn("[watch] message fell back to the template:", String(err).slice(0, 160));
    return fallback;
  }
}

/** A digit in the model's sentence that wasn't in the facts means it made something up. */
function inventedNumber(text: string, facts: string): boolean {
  const allowed = new Set((facts.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/,/g, "")));
  const used = text.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return used.some((n) => !allowed.has(n.replace(/,/g, "")));
}

function policyFacts(signal: Signal): PolicyFacts {
  const data = signal.data ?? {};
  const probability = typeof data.probabilityToBeat === "number" ? data.probabilityToBeat : undefined;
  const sample = typeof data.sample === "number" ? data.sample : undefined;
  const real = data.traffic === "real" && sample !== undefined ? Math.floor(sample / 2) : signal.synthetic ? 0 : undefined;
  return { probability, realPerArm: real, label: signal.title, synthetic: signal.synthetic };
}

/** auto-safe / a matching policy: do it, then tell the merchant what happened. */
async function runUnattended(signal: Signal, policy: Policy | undefined, why: string, ctx: SpeakCtx): Promise<string | undefined> {
  const action = signal.suggestedAction!;
  const agent = action.type === "tool" ? action.agent : action.type === "briefing" && action.action === "stop" ? "fizz" : action.type === "briefing" && action.id.startsWith("web:") ? "pixel" : "dash";
  const chat = ensureInboxChat();
  const group = createChat({ kind: "group", title: signal.title.slice(0, 80), members: ["darwin", agent], createdBy: "darwin" });
  setChatStatus(group.id, "working");
  ctx.emit({ type: "chat_created", chat: { ...group, status: "working" } });
  attachSignalChat(signal.id, group.id);
  const progress = addMessage({ chatId: group.id, from: agent, text: `On it: ${signal.title}`.slice(0, 140), kind: "progress" });
  ctx.emit({ type: "message", message: progress });
  const result = await executeWatchAction(action, { origin: ctx.origin });
  const done = addMessage({ chatId: group.id, from: agent, text: result.summary, kind: "report", ok: result.ok, ...(result.synthetic ? { synthetic: true } : {}) });
  ctx.emit({ type: "message", message: done });
  setChatStatus(group.id, "done");
  const lead = result.ok ? result.summary : `I tried and it didn't go through: ${result.summary}`;
  const policyNote = policy ? ` Your policy “${policy.text.slice(0, 120)}” is why I didn't wait.` : "";
  const text = `${lead}${policyNote}`.slice(0, 1100);
  const message = addMessage({
    chatId: chat.id,
    from: "darwin",
    text,
    kind: "report",
    ...(signal.synthetic || result.synthetic ? { synthetic: true } : {}),
    signalId: signal.id,
    link: { label: "Open the chat", href: `/console/inbox?chat=${group.id}` },
  });
  ctx.emit({ type: "message", message });
  recordSent({ messageId: message.id, fingerprint: signal.fingerprint, signalId: signal.id, severity: signal.severity, score: signal.score ?? 0, at: message.at });
  remember({
    kind: policy ? "auto" : "approved",
    at: new Date(ctx.now).toISOString(),
    fingerprint: signal.fingerprint,
    signalId: signal.id,
    label: signal.title,
    detail: `${why} ${result.summary}`.slice(0, 300),
    policyId: policy?.id,
  });
  if (policy) markPolicyUsed(policy.id, ctx.now);
  if (result.shipped) {
    remember({ kind: "shipped", at: new Date(ctx.now).toISOString(), fingerprint: signal.fingerprint, signalId: signal.id, label: signal.title, detail: result.summary.slice(0, 300) });
  }
  ctx.delivered.push(...(await deliver({ text, severity: signal.severity, synthetic: signal.synthetic, actions: [], href: `/console/inbox?chat=${group.id}` })));
  return message.id;
}

async function postDigest(signals: Signal[], ctx: SpeakCtx): Promise<string | undefined> {
  const chat = ensureInboxChat();
  const text = [heuristicDigest(signals), couldNotCheck(ctx.failed)].filter(Boolean).join(" ");
  const message = addMessage({
    chatId: chat.id,
    from: "darwin",
    text,
    kind: "report",
    ...(signals.some((s) => s.synthetic) ? { synthetic: true } : {}),
  });
  ctx.emit({ type: "message", message });
  recordSent({ messageId: message.id, fingerprint: `digest:${new Date(ctx.now).toISOString().slice(0, 10)}`, signalId: signals[0]?.id ?? "digest", severity: "low", score: 0, at: message.at, digest: true });
  ctx.delivered.push(...(await deliver({ text, severity: "low", synthetic: signals.some((s) => s.synthetic), actions: [] })));
  return message.id;
}

/* ------------------------------------------------------------------ reads */

export function nextRunAt(now = Date.now()): string | undefined {
  if (!scheduled()) return undefined;
  const last = lastRun();
  const from = last ? Date.parse(last.at) + WATCH_INTERVAL_MS : now + WATCH_INTERVAL_MS;
  return new Date(Math.max(from, now)).toISOString();
}

export function scheduled(): boolean {
  return process.env.DARWIN_WATCH === "1" || process.env.VERCEL === "1";
}

export function watchState(now = Date.now()): WatchStateResponse {
  const settings = getWatchSettings();
  const runs = listRuns();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const today = runs.filter((r) => Date.parse(r.at) >= dayAgo);
  const chat = ensureInboxChat();
  const unread = listChatSummaries().find((c) => c.id === chat.id)?.unread ?? 0;
  return {
    settings,
    policies: listPolicies(),
    runs,
    lastRunAt: runs[0]?.at,
    nextRunAt: nextRunAt(now),
    runsToday: today.length,
    signalsToday: today.reduce((n, r) => n + r.signals.length, 0),
    messagesToday: today.reduce((n, r) => n + r.messageIds.length, 0),
    inboxChatId: chat.id,
    unread,
    openActions: openTokens(now).map(toProactive),
    scheduled: scheduled(),
  };
}

export function inboxView(opts: { since?: string; limit?: number; now?: number } = {}): TeamInboxResponse {
  const chat = ensureInboxChat();
  const now = opts.now ?? Date.now();
  const open = new Set(openTokens(now).map((t) => t.token));
  const all = listMessages(chat.id).filter((m) => m.from !== "user");
  const sliced = all.filter((m) => !opts.since || m.at > opts.since).slice(-(opts.limit ?? 20));
  const messages: InboxMessage[] = sliced.map((m) => {
    const signal = m.signalId ? findSignal(m.signalId)?.signal : undefined;
    return {
      id: m.id,
      at: m.at,
      text: m.text,
      severity: signal?.severity ?? "normal",
      synthetic: !!m.synthetic,
      signalId: m.signalId,
      kind: signal?.kind,
      actions: (m.actions ?? []).filter((a) => open.has(a.token)),
      sources: signal?.sources ?? [],
      href: m.link?.href ?? signal?.href,
    };
  });
  return {
    chatId: chat.id,
    unread: listChatSummaries().find((c) => c.id === chat.id)?.unread ?? 0,
    messages,
    lastAt: all.at(-1)?.at,
    autonomy: getWatchSettings().autonomy,
    nextRunAt: nextRunAt(now),
  };
}

export async function updateAutonomy(input: {
  level?: unknown;
  timezone?: unknown;
  quietHours?: { start?: number; end?: number };
  enabled?: boolean;
  policy?: string;
  confirmPolicy?: string;
  removePolicy?: string;
  now?: number;
}): Promise<AutonomyResponse> {
  const now = input.now ?? Date.now();
  if (input.level !== undefined) {
    if (!isAutonomyLevel(input.level)) return { settings: getWatchSettings(), policies: listPolicies(), text: "Autonomy is one of: off, suggest, auto-safe, autopilot." };
    setWatchSettings({ autonomy: input.level });
  }
  if (typeof input.timezone === "string" && input.timezone.trim()) {
    try {
      Intl.DateTimeFormat("en-GB", { timeZone: input.timezone.trim() }).format(new Date());
      setWatchSettings({ timezone: input.timezone.trim() });
    } catch {
      return { settings: getWatchSettings(), policies: listPolicies(), text: `“${input.timezone}” isn't a timezone I know.` };
    }
  }
  if (input.quietHours && Number.isInteger(input.quietHours.start) && Number.isInteger(input.quietHours.end)) {
    const start = input.quietHours.start ?? 0;
    const end = input.quietHours.end ?? 0;
    if (start >= 0 && start <= 23 && end >= 0 && end <= 23) setWatchSettings({ quietHours: { start, end } });
  }
  if (typeof input.enabled === "boolean") setWatchSettings({ enabled: input.enabled });
  if (input.removePolicy) removePolicy(input.removePolicy);

  let compiled: Policy | undefined;
  if (input.policy?.trim()) {
    compiled = await compilePolicy(input.policy, { now });
    savePolicy(compiled);
  }
  if (input.confirmPolicy) {
    const policy = getPolicy(input.confirmPolicy);
    if (!policy) return { settings: getWatchSettings(), policies: listPolicies(), text: "There's no policy with that id." };
    compiled = savePolicy({ ...policy, confirmedAt: policy.confirmedAt ?? new Date(now).toISOString() });
  }
  const settings = getWatchSettings();
  const text = compiled
    ? compiled.confirmedAt
      ? `Standing policy on: ${compiled.compiled}`
      : `Here's how I read that: ${compiled.compiled} Confirm it and I'll follow it.`
    : AUTONOMY_BLURB[settings.autonomy];
  return { settings, policies: listPolicies(), ...(compiled ? { compiled } : {}), text };
}

/* ------------------------------------------------------------------ dev interval (one process) */

/** Start the 15-minute loop. No-op unless DARWIN_WATCH=1, and only one interval per process. */
export function startWatchLoop() {
  if (process.env.DARWIN_WATCH !== "1") return;
  const g = globalThis as unknown as { __darwinWatchTimer?: ReturnType<typeof setInterval> };
  if (g.__darwinWatchTimer) return;
  console.info(`[watch] heartbeat every ${WATCH_INTERVAL_MS / 60000} min (DARWIN_WATCH=1)`);
  g.__darwinWatchTimer = setInterval(() => {
    runWatch({ reason: "dev" }).catch((err) => console.warn("[watch] scheduled run failed", err));
  }, WATCH_INTERVAL_MS);
  g.__darwinWatchTimer.unref?.();
}

/** Test hook: stop the dev interval. */
export function stopWatchLoop() {
  const g = globalThis as unknown as { __darwinWatchTimer?: ReturnType<typeof setInterval> };
  if (g.__darwinWatchTimer) clearInterval(g.__darwinWatchTimer);
  g.__darwinWatchTimer = undefined;
}
