/**
 * One-tap actions from Darwin's watch. OWNED BY: team.
 *
 * A proactive message carries tokens. Each token is single-use, expires in 24 hours, and is bound to the exact
 * action and arguments it was minted with (the hash is checked again at run time). Tapping one runs it through
 * the team: Dash ships, Fizz stops, Pixel publishes, in a group chat, and Darwin confirms in the Inbox with an
 * undo when there is one.
 */
import type { AgentId, ChatMessage, TeamEvent } from "@/lib/contracts/team";
import type { ActionRisk, ProactiveAction, Signal, WatchAction } from "@/lib/contracts/watch";
import { actOnBriefing } from "@/lib/briefing";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import type { ToolContext } from "@/lib/assistant/tools";
import { actionRisk } from "./autonomy";
import { heuristicActionReply } from "./persona";
import { addMessage, createChat, setChatStatus } from "./store";
import { parseCall, runTeamTool, safeHref } from "./tools";
import {
  attachSignalChat,
  findSignal,
  getToken,
  hashAction,
  mintToken,
  remember,
  consumeToken,
  type StoredToken,
} from "./watch-store";

export interface ActionResult {
  ok: boolean;
  summary: string;
  agent: AgentId;
  synthetic?: boolean;
  navigate?: string;
  /** True when a change actually went live (so Darwin can check back in a week). */
  shipped?: boolean;
  undo?: WatchAction;
  undoLabel?: string;
}

/** Who does this. Dash ships, Fizz stops or steps the loop, Pixel publishes to a site. */
export function agentForAction(action: WatchAction): AgentId {
  if (action.type === "briefing") {
    if (action.action === "stop") return "fizz";
    return action.id.startsWith("web:") ? "pixel" : "dash";
  }
  if (action.type === "tool") return action.agent;
  return "darwin";
}

/** The buttons under a proactive message. "Keep testing" / "Not now" record a no. */
export function proposedActions(signal: Signal): { label: string; action: WatchAction }[] {
  const suggested = signal.suggestedAction;
  if (!suggested || suggested.type === "dismiss") return [];
  if (suggested.type === "briefing" && suggested.action === "ship") {
    return [
      { label: "Ship it", action: suggested },
      { label: "Keep testing", action: { type: "dismiss" } },
    ];
  }
  if (suggested.type === "briefing" && suggested.action === "stop") {
    return [
      { label: "Stop the test", action: suggested },
      { label: "Keep testing", action: { type: "dismiss" } },
    ];
  }
  if (suggested.type === "open") return [{ label: "Show me", action: suggested }];
  if (suggested.type === "tool" && suggested.tool === "step_loop") {
    return [
      { label: "Step it", action: suggested },
      { label: "Not now", action: { type: "dismiss" } },
    ];
  }
  return [
    { label: "Do it", action: suggested },
    { label: "Not now", action: { type: "dismiss" } },
  ];
}

export function toProactive(token: StoredToken): ProactiveAction {
  return { token: token.token, label: token.label, risk: token.risk, kind: token.action.type, expiresAt: token.expiresAt };
}

/** Mint the tokens for one message. `riskOf` lets a caller pass the signal title into the drastic check. */
export function mintActions(
  choices: { label: string; action: WatchAction }[],
  opts: { chatId: string; signal?: Signal; now?: number; riskLabel?: string },
): StoredToken[] {
  return choices.map((choice) =>
    mintToken({
      label: choice.label,
      risk: actionRisk(choice.action, opts.riskLabel ?? opts.signal?.title ?? ""),
      action: choice.action,
      chatId: opts.chatId,
      signalId: opts.signal?.id,
      fingerprint: opts.signal?.fingerprint,
      now: opts.now,
    }),
  );
}

/** Run an action the merchant (or a confirmed policy) already approved. Never asks again. */
export async function executeWatchAction(action: WatchAction, ctx: ToolContext = {}): Promise<ActionResult> {
  if (action.type === "dismiss") return { ok: true, summary: "Left it as it is.", agent: "darwin" };
  if (action.type === "open") {
    const href = safeHref(action.href);
    if (!href) return { ok: false, summary: `I can't open “${action.href.slice(0, 80)}”.`, agent: "darwin" };
    return { ok: true, summary: `Opening ${href}.`, agent: "darwin", navigate: href };
  }
  if (action.type === "briefing") {
    const result = await actOnBriefing(action.id, action.action);
    return {
      ok: result.ok,
      summary: result.text,
      agent: agentForAction(action),
      shipped: action.action === "ship" && result.ok,
    };
  }
  const prepared = parseCall(action.agent, action.tool, action.args);
  if ("error" in prepared) return { ok: false, summary: prepared.error, agent: action.agent };
  const outcome = await runTeamTool(prepared.tool, prepared.args, ctx);
  const undo = undoFor(action, outcome.ok);
  return {
    ok: outcome.ok,
    summary: outcome.summary,
    agent: action.agent,
    synthetic: outcome.synthetic,
    navigate: outcome.navigate,
    shipped: action.tool === "ship_winner" && outcome.ok,
    ...undo,
  };
}

function undoFor(action: Extract<WatchAction, { type: "tool" }>, ok: boolean): { undo?: WatchAction; undoLabel?: string } {
  if (!ok) return {};
  if (action.tool === "set_autopilot" && typeof action.args.on === "boolean") {
    const on = action.args.on;
    return {
      undo: { type: "tool", agent: "fizz", tool: "set_autopilot", args: { on: !on } },
      undoLabel: on ? "Turn autopilot back off" : "Turn autopilot back on",
    };
  }
  if (action.tool === "save_web_rule" && action.args.status === "paused" && typeof action.args.ruleId === "string") {
    return {
      undo: { type: "tool", agent: "pixel", tool: "save_web_rule", args: { ruleId: action.args.ruleId, status: "running" } },
      undoLabel: "Resume it",
    };
  }
  return {};
}

export interface ActionHost {
  emit: (event: TeamEvent) => void;
  /** Where Darwin confirms (the Inbox, or whichever chat the merchant is in). */
  originChatId: string;
  toolCtx: ToolContext;
  now?: number;
}

function post(host: ActionHost, message: Omit<ChatMessage, "id" | "at">): ChatMessage {
  const saved = addMessage(message);
  host.emit({ type: "message", message: saved });
  return saved;
}

/**
 * Answer one action token. Rejects expiry, a token whose arguments were changed, and a second tap.
 * `approved: false` is a no: Darwin remembers it and won't re-propose that idea for 30 days.
 */
export async function performActionToken(input: { id: string; approved: boolean }, host: ActionHost): Promise<void> {
  const now = host.now ?? Date.now();
  const token = getToken(input.id);
  if (!token) {
    post(host, { chatId: host.originChatId, from: "darwin", text: "That action isn't one of mine (it may be from an older briefing).", kind: "text" });
    return;
  }
  const say = (text: string, extra: Partial<ChatMessage> = {}) =>
    post(host, { chatId: token.chatId, from: "darwin", text, kind: extra.kind ?? "text", ...extra });

  if (Date.parse(token.expiresAt) <= now) {
    say("That one expired. Ask me again and I'll look at the numbers fresh.");
    return;
  }
  if (hashAction(token.action) !== token.argsHash) {
    consumeToken(token.token, "failed", now);
    say("That action no longer matches what I asked, so I didn't run it.");
    return;
  }
  if (token.usedAt) {
    say("Already done. I only run these once.");
    return;
  }
  if (!input.approved || token.action.type === "dismiss") {
    if (!consumeToken(token.token, "dismissed", now)) {
      say("Already done. I only run these once.");
      return;
    }
    const signal = token.signalId ? findSignal(token.signalId)?.signal : undefined;
    remember({
      kind: "rejected",
      at: new Date(now).toISOString(),
      fingerprint: token.fingerprint,
      signalId: token.signalId,
      label: signal?.title ?? token.label,
      baseline: signal?.score,
      detail: "The merchant said no.",
    });
    say(token.action.type === "dismiss" ? "Okay. I won't bring the same idea back unless the numbers move." : "Okay, cancelled. Nothing changed.");
    return;
  }
  if (!consumeToken(token.token, "ran", now)) {
    say("Already done. I only run these once.");
    return;
  }

  const agent = agentForAction(token.action);
  const where = token.chatId;
  if (token.action.type === "open") {
    const result = await executeWatchAction(token.action, host.toolCtx);
    if (result.navigate) host.emit({ type: "navigate", href: result.navigate });
    say(result.summary, { kind: "navigate", link: result.navigate ? { label: "Open", href: result.navigate } : undefined });
    return;
  }

  const group = createChat({
    kind: "group",
    title: token.label,
    members: ["darwin", agent].filter((m, i, a) => a.indexOf(m) === i) as AgentId[],
    createdBy: "darwin",
  });
  setChatStatus(group.id, "working");
  host.emit({ type: "chat_created", chat: { ...group, status: "working" } });
  if (token.signalId) attachSignalChat(token.signalId, group.id);
  host.emit({ type: "agent_status", agent, state: "working", chatId: group.id, label: token.label });
  post(host, { chatId: group.id, from: agent, text: `On it: ${token.label}`, kind: "progress" });
  post(host, { chatId: where, from: "darwin", text: `${nameOf(agent)} is on “${token.label}” in a group chat.`, kind: "progress" });

  let result: ActionResult;
  try {
    result = await executeWatchAction(token.action, host.toolCtx);
  } catch (err) {
    result = { ok: false, summary: err instanceof Error ? err.message : String(err), agent };
  }
  post(host, {
    chatId: group.id,
    from: agent,
    text: result.summary,
    kind: "report",
    ok: result.ok,
    ...(result.synthetic ? { synthetic: true } : {}),
  });
  host.emit({ type: "agent_status", agent, state: result.ok ? "success" : "error", chatId: group.id });
  setChatStatus(group.id, "done");
  if (result.navigate) host.emit({ type: "navigate", href: result.navigate });

  let actions: ProactiveAction[] | undefined;
  if (result.undo && result.undoLabel) {
    const undo = mintToken({
      label: result.undoLabel,
      risk: "safe" satisfies ActionRisk,
      action: result.undo,
      chatId: where,
      signalId: token.signalId,
      fingerprint: token.fingerprint,
      now,
    });
    actions = [toProactive(undo)];
  }
  say(heuristicActionReply(result.ok, result.summary, result.undoLabel), {
    kind: "report",
    ok: result.ok,
    ...(result.synthetic ? { synthetic: true } : {}),
    ...(actions ? { actions } : {}),
    ...(token.signalId ? { signalId: token.signalId } : {}),
    link: { label: "Open the chat", href: `/console/inbox?chat=${group.id}` },
  });
  rememberOutcome(token, result, now);
}

function rememberOutcome(token: StoredToken, result: ActionResult, now: number) {
  const at = new Date(now).toISOString();
  const signal = token.signalId ? findSignal(token.signalId)?.signal : undefined;
  remember({
    kind: "approved",
    at,
    fingerprint: token.fingerprint,
    signalId: token.signalId,
    label: signal?.title ?? token.label,
    detail: result.summary.slice(0, 300),
  });
  if (result.shipped) {
    let baseline: number | undefined;
    try {
      const summary = getAnalyticsSummary();
      if (summary.overall.visitors > 0) baseline = summary.overall.conversionRate;
    } catch {
      /* no baseline, so no week-later follow-up */
    }
    remember({
      kind: "shipped",
      at,
      fingerprint: token.fingerprint,
      signalId: token.signalId,
      label: signal?.title ?? token.label,
      detail: result.summary.slice(0, 300),
      baseline,
    });
  }
}

function nameOf(agent: AgentId): string {
  return agent === "darwin" ? "Darwin" : agent === "iris" ? "Iris" : agent === "pixel" ? "Pixel" : agent === "fizz" ? "Fizz" : "Dash";
}

/** True when this confirm id is a watch action token (as opposed to a chat confirm). */
export function isActionToken(id: string): boolean {
  return !!getToken(id);
}
