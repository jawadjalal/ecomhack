/**
 * The team orchestrator. OWNED BY: team.
 *
 *   runTeamTurn(request, emit) → streams TeamEvents (see contracts/team.ts), always ending with { type: "done" }.
 *
 * Darwin (the manager) reads the merchant's ask and either answers with its own tools or delegates: several
 * independent parts run CONCURRENTLY (bounded, MAX_PARALLEL) in a group chat, each specialist running its own tool
 * loop (lib/llm runToolLoop) with its own tool set, posting short progress/tool messages; Darwin then reports back
 * in the merchant's chat. Specialists may `ask` a teammate (depth 1). Side-effecting tools never run on an agent's
 * say-so: they post a `confirm` message and run only when the merchant answers `confirm: { id, approved: true }`.
 *
 * Without an LLM key (or when every provider fails) the same flow runs on keyword routing (router.ts) with real
 * tool results; nothing is invented.
 */
import type { AgentId, Chat, ChatMessage, TeamChatRequest, TeamEvent, TeamPendingConfirm } from "@/lib/contracts/team";
import { AGENT_IDS } from "@/lib/contracts/team";
import { nextStepHint } from "@/lib/assistant/agent";
import { stateSnapshot, type ToolContext } from "@/lib/assistant/tools";
import { llmAvailable, routeLabel, runToolLoop, type LlmRoute, type LoopMessage, type LoopToolDef } from "@/lib/llm/client";
import { id } from "@/lib/ids";
import { DARWIN_VOICE } from "./persona";
import { SPECIALISTS, TEAM, TEAM_BY_ID } from "./roster";
import { isGreeting, isIntroAsk, ownerFor, routePart, splitAsk, type RoutedCall } from "./router";
import {
  addMessage,
  clearPendingConfirm,
  createChat,
  directChatId,
  ensureDirectChat,
  findPendingConfirm,
  getChat,
  listMessages,
  markRead,
  setChatStatus,
} from "./store";
import { isActionToken, performActionToken } from "./actions";
import { getToken } from "./watch-store";
import { isMetaTool, jsonSchemaOf, parseCall, runTeamTool, toolsFor, type TeamToolOutcome } from "./tools";

export const MAX_PARALLEL = 3;
export const PROGRESS_CHARS = 140;
const HISTORY = 12;

export type Emit = (event: TeamEvent) => void;

export interface TeamTurnInput extends TeamChatRequest {
  /** Darwin's origin (for tools that fetch Darwin's own pages). */
  origin?: string;
}

export class TeamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ turn context */

interface SpecialistResult {
  agent: AgentId;
  ok: boolean;
  /** What the agent concluded (LLM answer or tool summaries). */
  text: string;
  synthetic: boolean;
  /** Confirm prompts it left for the merchant. */
  waiting: string[];
}

interface Turn {
  emit: Emit;
  originChatId: string;
  toolCtx: ToolContext;
  onboarding: boolean;
  /** An LLM answered at least one step (for the done label). */
  usedLlm: boolean;
  /** Group chat Darwin opened this turn (delegate reuses it). */
  groupChatId?: string;
  toolsRan: string[];
  synthetic: boolean;
  waiting: string[];
  posted: boolean;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function say(turn: Turn, chatId: string, from: ChatMessage["from"], text: string, kind: ChatMessage["kind"] = "text", extra: Partial<ChatMessage> = {}): ChatMessage {
  const message = addMessage({ chatId, from, text: text.trim() || "…", kind, ...extra });
  turn.emit({ type: "message", message });
  if (chatId === turn.originChatId && from !== "user" && (kind === "report" || kind === "text")) turn.posted = true;
  return message;
}

function status(turn: Turn, agent: AgentId, state: "idle" | "thinking" | "working" | "success" | "error", chatId?: string, label?: string) {
  turn.emit({ type: "agent_status", agent, state, ...(chatId ? { chatId } : {}), ...(label ? { label: clip(label, PROGRESS_CHARS) } : {}) });
}

function openGroupChat(turn: Turn, title: string, members: AgentId[], createdBy: Chat["createdBy"]): Chat {
  const chat = createChat({ kind: "group", title, members: ["darwin", ...members.filter((m) => m !== "darwin")], createdBy });
  setChatStatus(chat.id, "working");
  turn.emit({ type: "chat_created", chat: { ...chat, status: "working" } });
  turn.groupChatId = chat.id;
  return chat;
}

/** Run `fn` over items with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const TOOL_LABELS: Record<string, string> = Object.fromEntries(TEAM.flatMap((a) => (a.tools ?? []).map((t) => [t.name, t.label])));

/* ------------------------------------------------------------------ running one tool call (any agent) */

interface CallResult {
  content: string;
  outcome?: TeamToolOutcome;
}

/**
 * Validate and run one of `agent`'s regular tools in `chatId`: confirm tools become a confirm message in the
 * merchant's chat instead of running; navigate emits a navigate event.
 */
async function callTool(turn: Turn, agent: AgentId, call: RoutedCall, chatId: string, step: number): Promise<CallResult> {
  const prepared = parseCall(agent, call.tool, call.args);
  if ("error" in prepared) return { content: prepared.error };
  const { tool } = prepared;
  let args = prepared.args;
  const label = TOOL_LABELS[tool.name] ?? tool.name;
  turn.emit({ type: "progress", chatId, agent, step, label: clip(label, PROGRESS_CHARS) });

  if (tool.confirm) {
    const blocked = tool.precheck?.(args);
    if (blocked) {
      say(turn, chatId, agent, clip(blocked, 400), "tool", { tool: tool.name, ok: false });
      return { content: `Can't run ${tool.name}: ${blocked}`, outcome: { ok: false, summary: blocked } };
    }
    try {
      if (tool.prepare) args = (await tool.prepare(args, turn.toolCtx)) as Record<string, unknown>;
    } catch (err) {
      return { content: `Couldn't prepare ${tool.name}: ${err instanceof Error ? err.message : String(err)}` };
    }
    const prompt = tool.confirmPrompt?.(args) ?? `Run ${tool.name}?`;
    const pendingConfirm: TeamPendingConfirm = { id: id("cfm"), agent, tool: tool.name, args, prompt };
    say(turn, turn.originChatId, agent, prompt, "confirm", { tool: tool.name, pendingConfirm });
    if (chatId !== turn.originChatId) say(turn, chatId, agent, clip(`Waiting for your OK: ${prompt}`, PROGRESS_CHARS), "progress");
    turn.waiting.push(prompt);
    return { content: `Asked the merchant to confirm (“${prompt}”). It runs only after they approve; don't call ${tool.name} again this turn.` };
  }

  const outcome = await runTeamTool(tool, args, turn.toolCtx);
  turn.toolsRan.push(tool.name);
  if (outcome.synthetic) turn.synthetic = true;
  if (outcome.navigate) {
    turn.emit({ type: "navigate", href: outcome.navigate });
    say(turn, turn.originChatId, agent, outcome.summary, "navigate", { link: { label: "Open", href: outcome.navigate } });
  } else {
    say(turn, chatId, agent, clip(outcome.summary, PROGRESS_CHARS), "tool", {
      tool: tool.name,
      ok: outcome.ok,
      ...(outcome.link ? { link: outcome.link } : {}),
      ...(outcome.synthetic ? { synthetic: true } : {}),
    });
  }
  let data = "";
  try {
    data = outcome.data === undefined ? "" : ` data: ${JSON.stringify(outcome.data).slice(0, 2500)}`;
  } catch {
    /* summary only */
  }
  return { content: `${outcome.ok ? "ok" : "FAILED"}${outcome.synthetic ? " [synthetic]" : ""}: ${outcome.summary}${data}`, outcome };
}

/* ------------------------------------------------------------------ specialists */

function specialistSystem(agent: AgentId, onboarding: boolean): string {
  const a = TEAM_BY_ID[agent];
  const mates = SPECIALISTS.filter((s) => s.id !== agent)
    .map((s) => `${s.id} (${s.name}, ${s.role})`)
    .join(", ");
  return [
    `You are ${a.name}, the ${a.role} on Darwin's team, working for an e-commerce merchant. ${a.blurb}`,
    "Do the task with your tools, then answer in at most 3 short sentences with what you found or did.",
    "Only cite numbers that appear in tool results. Say “simulated” when a result is marked synthetic. Money in tool data is integer pence (£12.50 = 1250).",
    "Tools that change things ask the merchant to confirm: call them directly; if a result says it is waiting for confirmation, don't call it again, just mention it.",
    `Use ask only when you truly need a teammate's help (${mates}); keep questions short.`,
    agent === "pixel" ? "Before editing a repo file, read it; propose_file_edit takes the full new content of each file. For live-site copy changes prefer draft_web_rule/save_web_rule." : "",
    onboarding ? "The merchant is still setting Darwin up: be brief and friendly." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const AskArgs = { type: "object", properties: { agent: { type: "string", enum: AGENT_IDS.filter((a) => a !== "darwin") }, question: { type: "string" } }, required: ["agent", "question"] };
const PostArgs = { type: "object", properties: { chatId: { type: "string" }, text: { type: "string", maxLength: 140 } }, required: ["text"] };

function loopTools(agent: AgentId, depth: number): LoopToolDef[] {
  const defs: LoopToolDef[] = toolsFor(agent).map((t) => ({ name: t.name, description: `${t.description}${t.confirm ? " [asks the merchant to confirm first]" : ""}`, parameters: jsonSchemaOf(t.args) }));
  if (agent !== "darwin" && depth === 0) defs.push({ name: "ask", description: "Ask a teammate a short question; returns their answer.", parameters: AskArgs });
  return defs;
}

function routeFor(agent: AgentId, hard?: boolean): LlmRoute {
  return { ...(agent === "pixel" ? { role: "editor" as const } : {}), ...(hard ? { hard: true } : {}) };
}

/**
 * One specialist works on one task in `chatId`. `preset`: tool calls the keyword router already picked (heuristic
 * path). With an LLM: its own tool loop, falling back to the keyword router if the model fails before acting.
 */
async function runSpecialist(turn: Turn, agent: AgentId, task: string, chatId: string, opts: { depth?: number; preset?: RoutedCall[]; hard?: boolean } = {}): Promise<SpecialistResult> {
  const depth = opts.depth ?? 0;
  const name = TEAM_BY_ID[agent].name;
  const waitingBefore = turn.waiting.length;
  status(turn, agent, "working", chatId, task);
  say(turn, chatId, agent, clip(`On it: ${task}`, PROGRESS_CHARS), "progress");
  const summaries: string[] = [];
  let synthetic = false;
  let ok = true;
  let step = 0;

  const run = async (call: RoutedCall) => {
    const r = await callTool(turn, agent, call, chatId, ++step);
    if (r.outcome) {
      summaries.push(r.outcome.summary);
      synthetic ||= !!r.outcome.synthetic;
      ok &&= r.outcome.ok;
    }
    return r;
  };

  let text = "";
  if (!opts.preset && llmAvailable()) {
    try {
      const res = await runToolLoop({
        system: specialistSystem(agent, turn.onboarding),
        messages: [{ role: "user", content: task }],
        tools: loopTools(agent, depth),
        maxSteps: 5,
        maxTokens: 1200,
        route: routeFor(agent, opts.hard),
        onToolCall: async ({ name: tool, args }) => {
          if (tool === "ask") {
            const target = String(args.agent ?? "") as AgentId;
            const question = String(args.question ?? "").slice(0, 300);
            if (depth > 0) return { content: "Teammates can't be asked from inside an answer. Use your own tools." };
            if (!SPECIALISTS.some((s) => s.id === target) || target === agent || !question) return { content: "Ask a different specialist (iris, pixel, fizz or dash) a non-empty question." };
            say(turn, chatId, agent, clip(`@${TEAM_BY_ID[target].name} ${question}`, PROGRESS_CHARS), "text");
            const answer = await runSpecialist(turn, target, question, chatId, { depth: depth + 1 });
            return { content: `${TEAM_BY_ID[target].name}: ${answer.text}` };
          }
          if (isMetaTool(tool)) return { content: `${tool} is Darwin's tool.` };
          return { content: (await run({ tool, args })).content };
        },
      });
      turn.usedLlm = true;
      text = res.text;
    } catch (err) {
      console.warn(`[team] ${name} LLM failed, using keyword routing:`, String(err).slice(0, 200));
    }
  }
  if (!text) {
    // Heuristic (or the model failed / returned nothing): run the routed calls this agent owns.
    const calls = opts.preset ?? routePart(task).calls.filter((c) => toolsFor(agent).some((t) => t.name === c.tool));
    if (!summaries.length) for (const c of calls) await run(c);
    text = summaries.length ? summaries.join(" ") : calls.length ? "" : `That isn't something I can do with my tools. ${ownerHint(task, agent)}`.trim();
    if (!text && turn.waiting.length > waitingBefore) text = "Waiting for your OK before I go ahead.";
  }
  const waiting = turn.waiting.slice(waitingBefore);
  // With an LLM the answer is new information: post it. Heuristic answers are the tool summaries already posted.
  if (!opts.preset && summaries.join(" ") !== text) say(turn, chatId, agent, clip(text, 600), "text", synthetic ? { synthetic: true } : {});
  status(turn, agent, ok ? "success" : "error", chatId);
  return { agent, ok, text, synthetic, waiting };
}

function ownerHint(task: string, agent: AgentId): string {
  const routed = routePart(task);
  if (routed.calls.length && routed.agent !== agent && routed.agent !== "darwin") return `${TEAM_BY_ID[routed.agent].name} can: ask Darwin to hand it over.`;
  return "";
}

/* ------------------------------------------------------------------ Darwin */

export function teamIntro(): string {
  const list = SPECIALISTS.map((s) => `${s.name} (${s.role.toLowerCase()}) ${s.blurb.charAt(0).toLowerCase()}${s.blurb.slice(1).replace(/\.$/, "")}`).join("; ");
  return `Hi, I'm Darwin, your team lead. Tell me what you want and I'll hand it to the right teammate: ${list}. Try “how are we doing?” or “audit my store and run a test”.`;
}

function darwinSystem(turn: Turn): string {
  const team = SPECIALISTS.map((s) => `- ${s.id} (${s.name}, ${s.role}): ${s.blurb} Tools: ${(s.tools ?? []).filter((t) => t.name !== "ask").map((t) => t.name).join(", ")}`).join("\n");
  return [
    "You are Darwin, the team lead of an AI team that runs a merchant's online store. The merchant talks to you; you plan, delegate and report.",
    DARWIN_VOICE,
    `Your team:\n${team}`,
    "How you work:",
    "- Quick questions your own tools answer (get_kpis, loop_status, step_loop, navigate): do them yourself.",
    "- Anything else: delegate. Put independent parts in ONE delegate call with several tasks; they run in parallel in a group chat. Each task is one clear instruction.",
    "- Use start_group_chat only for a bigger job you want a named room for; post short updates (≤140 chars) there with post.",
    "- Finish with report(text): 1-4 short sentences for the merchant. Only numbers from tool/teammate results; say “simulated” for synthetic results; mention anything waiting for their confirmation.",
    "- Tools marked [asks the merchant to confirm first] never run until the merchant approves; don't ask in prose.",
    turn.toolCtx.path ? `The merchant is on ${turn.toolCtx.path}.` : "",
    turn.onboarding
      ? "The merchant is on the onboarding screen, setting Darwin up. Be warm and short (2-3 sentences). Introduce the team if asked, help them navigate, and don't change the store."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const DelegateArgs = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          agent: { type: "string", enum: SPECIALISTS.map((s) => s.id) },
          task: { type: "string" },
          hard: { type: "boolean", description: "Multi-step or code-heavy: runs on the stronger model" },
        },
        required: ["agent", "task"],
      },
    },
    title: { type: "string", description: "Group chat title when there are several tasks" },
  },
  required: ["tasks"],
};
const GroupArgs = {
  type: "object",
  properties: { title: { type: "string" }, members: { type: "array", items: { type: "string", enum: SPECIALISTS.map((s) => s.id) } }, goal: { type: "string" } },
  required: ["title", "members", "goal"],
};
const ReportArgs = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };

function darwinTools(): LoopToolDef[] {
  return [
    { name: "delegate", description: "Hand tasks to specialists. Several tasks run in parallel in a group chat. Returns each result.", parameters: DelegateArgs },
    { name: "start_group_chat", description: "Open a named group chat with some specialists and post the goal. Later delegate calls use it.", parameters: GroupArgs },
    { name: "post", description: "Post a short update (≤140 chars) in a chat (default: the current group chat).", parameters: PostArgs },
    { name: "report", description: "Send your final answer to the merchant and finish.", parameters: ReportArgs },
    ...loopTools("darwin", 0),
  ];
}

interface Task {
  agent: AgentId;
  task: string;
  preset?: RoutedCall[];
  hard?: boolean;
}

/** Run tasks (concurrently, bounded) — in a group chat when there are several agents. */
async function delegate(turn: Turn, tasks: Task[], title?: string): Promise<SpecialistResult[]> {
  const agents = [...new Set(tasks.map((t) => t.agent))];
  let chatId = turn.groupChatId;
  if (!chatId && agents.length > 1) {
    const chat = openGroupChat(turn, title || "Team task", agents, "darwin");
    chatId = chat.id;
    say(turn, chat.id, "darwin", clip(`Plan: ${tasks.map((t) => `${TEAM_BY_ID[t.agent].name} → ${t.task}`).join("; ")}`, 400), "text");
    const names = agents.map((a) => TEAM_BY_ID[a].name);
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    say(turn, turn.originChatId, "darwin", `I've split this between ${who}. They're working on it in parallel in a group chat.`, "progress");
  } else if (!chatId) {
    say(turn, turn.originChatId, "darwin", `Handing this to ${TEAM_BY_ID[agents[0]].name}.`, "progress");
  }
  const where = chatId ?? turn.originChatId;
  const results = await mapLimit(tasks, MAX_PARALLEL, (t) => runSpecialist(turn, t.agent, t.task, where, { preset: t.preset, hard: t.hard }));
  if (chatId) setChatStatus(chatId, "done");
  return results;
}

function resultLines(results: SpecialistResult[]): string {
  return results.map((r) => `${TEAM_BY_ID[r.agent].name}: ${r.text}`).join("\n");
}

/** Heuristic report: specialist results + Darwin's own tool results + what's waiting + a next-step hint. */
function composeReport(turn: Turn, lines: string[]): string {
  const out = [...lines.filter(Boolean)];
  if (turn.waiting.length) out.push(turn.waiting.length === 1 ? "One thing needs your OK above." : `${turn.waiting.length} things need your OK above.`);
  const loopy = turn.toolsRan.some((t) => ["get_kpis", "loop_status", "step_loop", "list_experiments", "run_simulation"].includes(t));
  if (loopy) {
    try {
      const hint = nextStepHint(stateSnapshot());
      if (hint) out.push(hint);
    } catch {
      /* no hint */
    }
  }
  return out.join("\n\n") || "Done.";
}

function history(chatId: string, currentText: string): LoopMessage[] {
  const msgs = listMessages(chatId)
    .filter((m) => m.kind === "text" || m.kind === "report")
    .slice(-HISTORY);
  const out: LoopMessage[] = msgs.map((m) => ({ role: m.from === "user" ? ("user" as const) : ("assistant" as const), content: m.from === "user" ? m.text : `${m.from === "darwin" ? "" : `[${TEAM_BY_ID[m.from].name}] `}${m.text}` }));
  if (!out.length || out.at(-1)?.role !== "user") out.push({ role: "user", content: currentText });
  return out;
}

async function runDarwinLlm(turn: Turn, text: string): Promise<boolean> {
  const results: SpecialistResult[] = [];
  const own: string[] = [];
  let step = 0;
  try {
    const res = await runToolLoop({
      system: darwinSystem(turn),
      messages: history(turn.originChatId, text),
      tools: darwinTools(),
      maxSteps: 6,
      maxTokens: 1200,
      onToolCall: async ({ name, args }) => {
        if (name === "report") {
          const t = String(args.text ?? "").trim();
          return { content: "Reported.", stop: true, stopText: t };
        }
        if (name === "delegate") {
          const raw = Array.isArray(args.tasks) ? args.tasks : [];
          const tasks: Task[] = raw
            .map((x) => x as { agent?: unknown; task?: unknown; hard?: unknown })
            .filter((x) => SPECIALISTS.some((s) => s.id === x.agent) && typeof x.task === "string" && x.task.trim())
            .slice(0, 4)
            .map((x) => ({ agent: x.agent as AgentId, task: String(x.task).trim().slice(0, 400), hard: x.hard === true }));
          if (!tasks.length) return { content: "delegate needs tasks: [{agent: iris|pixel|fizz|dash, task}]" };
          const r = await delegate(turn, tasks, typeof args.title === "string" ? args.title : clip(text, 50));
          results.push(...r);
          return { content: resultLines(r) + (turn.waiting.length ? `\nWaiting for the merchant to confirm: ${turn.waiting.join(" | ")}` : "") };
        }
        if (name === "start_group_chat") {
          const members = (Array.isArray(args.members) ? args.members : []).filter((m): m is AgentId => SPECIALISTS.some((s) => s.id === m));
          if (!members.length) return { content: "start_group_chat needs members (iris, pixel, fizz, dash)." };
          const chat = openGroupChat(turn, String(args.title ?? "Team chat"), members, "darwin");
          if (args.goal) say(turn, chat.id, "darwin", clip(String(args.goal), 400), "text");
          return { content: `Group chat ${chat.id} open with ${members.join(", ")}. delegate now runs there.` };
        }
        if (name === "post") {
          const chatId = typeof args.chatId === "string" && getChat(args.chatId) ? args.chatId : (turn.groupChatId ?? turn.originChatId);
          say(turn, chatId, "darwin", clip(String(args.text ?? ""), PROGRESS_CHARS), "text");
          return { content: "Posted." };
        }
        const r = await callTool(turn, "darwin", { tool: name, args }, turn.originChatId, ++step);
        if (r.outcome) own.push(r.outcome.summary);
        return { content: r.content };
      },
    });
    turn.usedLlm = true;
    const reply = res.text || composeReport(turn, [...own, resultLines(results)]);
    say(turn, turn.originChatId, "darwin", reply, "report", turn.synthetic || results.some((r) => r.synthetic) ? { synthetic: true } : {});
    return true;
  } catch (err) {
    console.warn("[team] Darwin LLM failed:", String(err).slice(0, 200));
    if (!results.length && !own.length && !turn.waiting.length) return false; // nothing happened: heuristic from scratch
    say(turn, turn.originChatId, "darwin", composeReport(turn, [...own, resultLines(results)]), "report", turn.synthetic ? { synthetic: true } : {});
    return true;
  }
}

async function runDarwinHeuristic(turn: Turn, text: string) {
  if (isIntroAsk(text) || (turn.onboarding && isGreeting(text))) {
    say(turn, turn.originChatId, "darwin", teamIntro(), "report");
    return;
  }
  const parts = splitAsk(text).map((p) => routePart(p, { onboarding: turn.onboarding }));
  if (parts.some((p) => p.intro) && parts.every((p) => p.intro || !p.calls.length)) {
    say(turn, turn.originChatId, "darwin", teamIntro(), "report");
    return;
  }
  const replies = parts.filter((p) => !p.calls.length && p.reply).map((p) => p.reply!);
  const mine: RoutedCall[] = [];
  const tasks: Task[] = [];
  for (const p of parts) {
    if (!p.calls.length) continue;
    // Darwin does its own quick things itself; a single get_kpis/step_loop ask too (no need to delegate).
    const solo = parts.length === 1 && p.calls.every((c) => ["get_kpis", "step_loop", "loop_status", "navigate"].includes(c.tool));
    if (p.agent === "darwin" || solo) mine.push(...p.calls);
    else {
      const existing = tasks.find((t) => t.agent === p.agent);
      if (existing) {
        existing.task = `${existing.task}; ${p.text}`;
        existing.preset!.push(...p.calls);
      } else tasks.push({ agent: p.agent, task: p.text, preset: [...p.calls] });
    }
  }
  const own: string[] = [];
  let step = 0;
  for (const c of mine) {
    const r = await callTool(turn, "darwin", c, turn.originChatId, ++step);
    if (r.outcome && !r.outcome.navigate) own.push(r.outcome.summary);
  }
  const results = tasks.length ? await delegate(turn, tasks, clip(text, 50)) : [];
  const onlyNavigated = !own.length && !results.length && turn.toolsRan.every((t) => t === "navigate") && turn.toolsRan.length > 0;
  if (onlyNavigated && !replies.length) return;
  const lines = [...replies, ...own, ...results.map((r) => (results.length > 1 || tasks.length ? `${TEAM_BY_ID[r.agent].name}: ${r.text}` : r.text))];
  say(turn, turn.originChatId, "darwin", composeReport(turn, lines), "report", turn.synthetic ? { synthetic: true } : {});
}

/* ------------------------------------------------------------------ confirmations */

async function answerConfirm(turn: Turn, confirm: { id: string; approved: boolean }) {
  const pending = findPendingConfirm(confirm.id);
  if (!pending || !clearPendingConfirm(confirm.id)) {
    say(turn, turn.originChatId, "darwin", "There's nothing waiting for that confirmation (it may already be answered).", "text");
    return;
  }
  const chatId = pending.chatId;
  const agent = pending.agent;
  if (!confirm.approved) {
    say(turn, chatId, agent, "Okay, cancelled. Nothing changed.", "text");
    return;
  }
  status(turn, agent, "working", chatId, TOOL_LABELS[pending.tool] ?? pending.tool);
  const prepared = parseCall(agent, pending.tool, pending.args);
  if ("error" in prepared) {
    say(turn, chatId, agent, prepared.error, "tool", { tool: pending.tool, ok: false });
    status(turn, agent, "error", chatId);
    return;
  }
  turn.emit({ type: "progress", chatId, agent, step: 1, total: 1, label: clip(TOOL_LABELS[pending.tool] ?? pending.tool, PROGRESS_CHARS) });
  const outcome = await runTeamTool(prepared.tool, prepared.args, turn.toolCtx);
  turn.toolsRan.push(pending.tool);
  if (outcome.navigate) turn.emit({ type: "navigate", href: outcome.navigate });
  say(turn, chatId, agent, outcome.summary, "report", {
    tool: pending.tool,
    ok: outcome.ok,
    ...(outcome.link ? { link: outcome.link } : {}),
    ...(outcome.synthetic ? { synthetic: true } : {}),
  });
  status(turn, agent, outcome.ok ? "success" : "error", chatId);
}

/* ------------------------------------------------------------------ entry point */

function resolveChat(input: TeamTurnInput): { chat: Chat; created: boolean } {
  if (input.chatId) {
    const chat = getChat(input.chatId);
    if (!chat) throw new TeamError(`Chat ${input.chatId} not found.`, 404);
    return { chat, created: false };
  }
  if (input.confirm) {
    if (isActionToken(input.confirm.id)) {
      const token = getToken(input.confirm.id);
      const chat = token ? getChat(token.chatId) : undefined;
      if (chat) return { chat, created: false };
    }
    const pending = findPendingConfirm(input.confirm.id);
    const chat = pending ? getChat(pending.chatId) : undefined;
    if (chat) return { chat, created: false };
  }
  const agent = input.agentId ?? "darwin";
  const existed = !!getChat(directChatId(agent));
  return { chat: ensureDirectChat(agent, TEAM_BY_ID[agent].name), created: !existed };
}

/** One merchant turn. Emits events as they happen and always finishes with a `done` event. */
export async function runTeamTurn(input: TeamTurnInput, emit: Emit): Promise<void> {
  const { chat, created } = resolveChat(input);
  const path = input.context?.path;
  const turn: Turn = {
    emit,
    originChatId: chat.id,
    toolCtx: { origin: input.origin, path },
    onboarding: !!path && (path === "/onboarding" || path.startsWith("/onboarding/")),
    usedLlm: false,
    toolsRan: [],
    synthetic: false,
    waiting: [],
    posted: false,
  };
  if (created) emit({ type: "chat_created", chat });
  let error: string | undefined;
  try {
    if (input.confirm) {
      if (isActionToken(input.confirm.id)) {
        await performActionToken(input.confirm, { emit: turn.emit, originChatId: turn.originChatId, toolCtx: turn.toolCtx });
      } else {
        await answerConfirm(turn, input.confirm);
      }
    } else {
      const text = input.text.trim().slice(0, 2000);
      say(turn, chat.id, "user", text, "text");
      markRead(chat.id);
      const addressed: AgentId = input.agentId && chat.members.includes(input.agentId) ? input.agentId : chat.members.includes("darwin") ? "darwin" : chat.members[0];
      setChatStatus(chat.id, "working");
      if (addressed === "darwin") {
        status(turn, "darwin", "thinking", chat.id);
        const handled = llmAvailable() ? await runDarwinLlm(turn, text) : false;
        if (!handled) await runDarwinHeuristic(turn, text);
        status(turn, "darwin", "idle", chat.id);
      } else {
        // Talking to a specialist directly: it works in this chat and answers itself.
        const routed = routePart(text);
        const preset = llmAvailable() ? undefined : routed.calls.filter((c) => toolsFor(addressed).some((t) => t.name === c.tool));
        const r = await runSpecialist(turn, addressed, text, chat.id, preset ? { preset } : {});
        if (preset) say(turn, chat.id, addressed, r.text || composeReport(turn, []), "report", r.synthetic ? { synthetic: true } : {});
        status(turn, addressed, "idle", chat.id);
      }
      setChatStatus(chat.id, "active");
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error("[team] turn failed", err);
    try {
      say(turn, chat.id, "darwin", `Something went wrong on my side: ${clip(error, 200)}`, "text");
    } catch {
      /* store unavailable */
    }
  }
  emit({ type: "done", chatId: chat.id, model: turn.usedLlm ? routeLabel() : "heuristic", ...(error ? { error } : {}) });
}

/** Tools a specialist owns, by keyword (exported for tests/UI hints). */
export { ownerFor };
