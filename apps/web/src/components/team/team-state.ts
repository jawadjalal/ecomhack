/**
 * Client state for the team chat panel: tabs, chats, messages, live agent status and progress.
 * Pure (no React, no fetch) so the reducer is easy to test. The hook lives in ./use-team.ts.
 */
import type { AgentId, AgentState, Chat, ChatMessage, ChatSummary, TeamAgent, TeamEvent } from "@/lib/contracts";

/* ------------------------------------------------------------------ types */

export type TabRef =
  | { key: string; kind: "direct"; agent: AgentId; chatId?: string }
  | { key: string; kind: "group"; chatId: string };

export const DARWIN_TAB = "dm:darwin";
export const directKey = (agent: AgentId) => `dm:${agent}`;

/** A message as the panel holds it: server messages plus local-only ones (optimistic sends, friendly errors). */
export interface UiMessage extends ChatMessage {
  local?: boolean;
  error?: boolean;
}

export interface AgentLive {
  state: AgentState;
  chatId?: string;
  note?: string;
  /** ms timestamp of the last status change (for "sleeping" and for letting success/error settle). */
  since: number;
}

export interface LiveProgress {
  agent: AgentId;
  step: number;
  total?: number;
  label: string;
}

export interface TeamUiState {
  agents: TeamAgent[];
  chats: Record<string, Chat>;
  /** Messages by chat id. */
  messages: Record<string, UiMessage[]>;
  /** Messages for a tab whose chat id isn't known yet (first message to an agent). */
  pending: Record<string, UiMessage[]>;
  status: Partial<Record<AgentId, AgentLive>>;
  /** Live progress per chat, per agent. */
  progress: Record<string, Partial<Record<AgentId, LiveProgress>>>;
  unread: Record<string, number>;
  suggestions: Record<string, string[]>;
  /** Tabs with a request in flight. */
  busy: Record<string, boolean>;
  tabs: TabRef[];
  active: string;
  open: boolean;
}

export type TeamAction =
  | { type: "hydrate"; agents: TeamAgent[]; chats: ChatSummary[] }
  | { type: "restore"; tabs: TabRef[]; active: string }
  | { type: "chat_loaded"; chat: Chat; messages: ChatMessage[] }
  | { type: "event"; tabKey: string; event: TeamEvent; now: number }
  | { type: "local"; tabKey: string; message: UiMessage }
  | { type: "busy"; tabKey: string; on: boolean }
  | { type: "open_tab"; tab: TabRef; activate?: boolean }
  | { type: "close_tab"; key: string }
  | { type: "activate"; key: string }
  | { type: "set_open"; open: boolean }
  | { type: "resolve_confirm"; chatId: string; confirmId: string; resolved: "approved" | "cancelled" }
  /** Every stream has ended: nobody can still be mid-task, so let the mascots rest. */
  | { type: "settle"; now: number };

/* ------------------------------------------------------------------ helpers */

export function initialState(): TeamUiState {
  return {
    agents: [],
    chats: {},
    messages: {},
    pending: {},
    status: {},
    progress: {},
    unread: {},
    suggestions: {},
    busy: {},
    tabs: [{ key: DARWIN_TAB, kind: "direct", agent: "darwin" }],
    active: DARWIN_TAB,
    open: false,
  };
}

/** The merchant's own one-to-one chat with `agent`, if the server already has one. */
export function directChatId(chats: Iterable<Chat>, agent: AgentId): string | undefined {
  let best: Chat | undefined;
  for (const c of chats) {
    if (c.kind !== "direct" || c.createdBy !== "user") continue;
    const others = c.members.filter((m) => m !== agent);
    const mine = c.members.includes(agent) && (agent === "darwin" ? others.length === 0 : others.every((m) => m === "darwin"));
    if (mine && (!best || (c.updatedAt ?? c.createdAt) > (best.updatedAt ?? best.createdAt))) best = c;
  }
  return best?.id;
}

/** Chat id a tab shows (undefined until the first reply for a brand-new direct chat). */
export function tabChatId(tab: TabRef): string | undefined {
  return tab.chatId;
}

export function tabMessages(s: TeamUiState, tab: TabRef): UiMessage[] {
  const id = tabChatId(tab);
  return [...(id ? (s.messages[id] ?? []) : []), ...(s.pending[tab.key] ?? [])];
}

/** Splits a streamed buffer into complete NDJSON events; returns the unfinished tail. */
export function splitNdjson(buffer: string): { events: TeamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: TeamEvent[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as TeamEvent;
      if (ev && typeof ev === "object" && typeof (ev as { type?: unknown }).type === "string") events.push(ev);
    } catch {
      /* a malformed line: skip it */
    }
  }
  return { events, rest };
}

function addMessage(list: UiMessage[] | undefined, m: UiMessage): UiMessage[] {
  const all = list ?? [];
  if (all.some((x) => x.id === m.id)) return all.map((x) => (x.id === m.id ? { ...x, ...m } : x));
  // The server echoes what the merchant typed: drop the optimistic copy.
  const base = m.from === "user" ? dropOptimistic(all, m.text) : all;
  return [...base, m];
}

function dropOptimistic(list: UiMessage[], text: string): UiMessage[] {
  const i = list.findIndex((x) => x.local && x.from === "user" && x.text.trim() === text.trim());
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

function visibleChat(s: TeamUiState): string | undefined {
  if (!s.open) return undefined;
  const tab = s.tabs.find((t) => t.key === s.active);
  return tab ? tabChatId(tab) : undefined;
}

/** Give a direct tab its chat id once the server tells us, moving the optimistic messages over. */
function bindTab(s: TeamUiState, tabKey: string, chatId: string): TeamUiState {
  const tab = s.tabs.find((t) => t.key === tabKey);
  if (!tab || tab.kind !== "direct" || tab.chatId) return s;
  if (s.chats[chatId]?.kind === "group") return s;
  const moved = s.pending[tabKey] ?? [];
  const pending = { ...s.pending };
  delete pending[tabKey];
  let merged = s.messages[chatId] ?? [];
  for (const m of moved) merged = addMessage(merged, m);
  return {
    ...s,
    tabs: s.tabs.map((t) => (t.key === tabKey ? { ...t, chatId } : t)),
    pending,
    messages: { ...s.messages, [chatId]: merged },
  };
}

/* ------------------------------------------------------------------ reducer */

export function teamReducer(s: TeamUiState, a: TeamAction): TeamUiState {
  switch (a.type) {
    case "hydrate": {
      const chats = { ...s.chats };
      for (const c of a.chats) {
        const { lastMessage: _l, messageCount: _n, ...chat } = c;
        void _l;
        void _n;
        chats[c.id] = chat;
      }
      const tabs = s.tabs
        .map((t) => (t.kind === "direct" && !t.chatId ? { ...t, chatId: directChatId(Object.values(chats), t.agent) } : t))
        .filter((t) => t.kind === "direct" || chats[t.chatId]);
      const active = tabs.some((t) => t.key === s.active) ? s.active : DARWIN_TAB;
      return { ...s, agents: a.agents.length ? a.agents : s.agents, chats, tabs, active };
    }
    case "restore": {
      const tabs = a.tabs.some((t) => t.key === DARWIN_TAB) ? a.tabs : [{ key: DARWIN_TAB, kind: "direct" as const, agent: "darwin" as const }, ...a.tabs];
      return { ...s, tabs, active: tabs.some((t) => t.key === a.active) ? a.active : DARWIN_TAB };
    }
    case "chat_loaded": {
      const local = (s.messages[a.chat.id] ?? []).filter((m) => m.local && !a.messages.some((x) => x.from === "user" && x.text.trim() === m.text.trim()));
      return {
        ...s,
        chats: { ...s.chats, [a.chat.id]: a.chat },
        messages: { ...s.messages, [a.chat.id]: [...a.messages, ...local] },
      };
    }
    case "local": {
      const tab = s.tabs.find((t) => t.key === a.tabKey);
      const id = tab && tabChatId(tab);
      if (id) return { ...s, messages: { ...s.messages, [id]: addMessage(s.messages[id], a.message) } };
      return { ...s, pending: { ...s.pending, [a.tabKey]: addMessage(s.pending[a.tabKey], a.message) } };
    }
    case "busy": {
      const busy = { ...s.busy };
      if (a.on) busy[a.tabKey] = true;
      else delete busy[a.tabKey];
      return { ...s, busy };
    }
    case "open_tab": {
      const exists = s.tabs.some((t) => t.key === a.tab.key);
      const tabs = exists ? s.tabs : [...s.tabs, a.tab];
      const active = a.activate ? a.tab.key : s.active;
      return clearUnread({ ...s, tabs, active });
    }
    case "close_tab": {
      if (a.key === DARWIN_TAB) return s;
      const i = s.tabs.findIndex((t) => t.key === a.key);
      const tabs = s.tabs.filter((t) => t.key !== a.key);
      const active = s.active === a.key ? (tabs[Math.max(0, i - 1)]?.key ?? DARWIN_TAB) : s.active;
      return clearUnread({ ...s, tabs, active });
    }
    case "activate":
      return clearUnread({ ...s, active: s.tabs.some((t) => t.key === a.key) ? a.key : s.active });
    case "set_open":
      return clearUnread({ ...s, open: a.open });
    case "resolve_confirm": {
      const list = s.messages[a.chatId];
      if (!list) return s;
      return {
        ...s,
        messages: {
          ...s.messages,
          [a.chatId]: list.map((m) => (m.pendingConfirm?.id === a.confirmId ? { ...m, pendingConfirm: { ...m.pendingConfirm, resolved: a.resolved } } : m)),
        },
      };
    }
    case "settle": {
      if (Object.keys(s.busy).length) return s;
      const status = { ...s.status };
      for (const [id, l] of Object.entries(status) as [AgentId, AgentLive][]) {
        if (l.state === "working" || l.state === "thinking") status[id] = { ...l, state: "idle", since: a.now };
      }
      return { ...s, status, progress: {} };
    }
    case "event":
      return applyEvent(s, a.tabKey, a.event, a.now);
  }
}

function clearUnread(s: TeamUiState): TeamUiState {
  const id = visibleChat(s);
  if (!id || !s.unread[id]) return s;
  const unread = { ...s.unread };
  delete unread[id];
  return { ...s, unread };
}

function applyEvent(s: TeamUiState, tabKey: string, ev: TeamEvent, now: number): TeamUiState {
  switch (ev.type) {
    case "message": {
      const m = ev.message;
      let next = s.chats[m.chatId]?.kind === "group" ? s : bindTab(s, tabKey, m.chatId);
      next = { ...next, messages: { ...next.messages, [m.chatId]: addMessage(next.messages[m.chatId], m) } };
      if (m.from !== "user" && visibleChat(next) !== m.chatId) {
        next = { ...next, unread: { ...next.unread, [m.chatId]: (next.unread[m.chatId] ?? 0) + 1 } };
      }
      if (next.chats[m.chatId]) {
        next = { ...next, chats: { ...next.chats, [m.chatId]: { ...next.chats[m.chatId], updatedAt: m.at } } };
      }
      return next;
    }
    case "chat_created": {
      const chats = { ...s.chats, [ev.chat.id]: ev.chat };
      let next: TeamUiState = { ...s, chats };
      // Darwin started a group: show it as a tab so the merchant can watch the team work.
      if (ev.chat.kind === "group" && !s.tabs.some((t) => t.key === ev.chat.id)) {
        next = { ...next, tabs: [...next.tabs, { key: ev.chat.id, kind: "group", chatId: ev.chat.id }] };
      }
      return next;
    }
    case "chat_updated":
      return { ...s, chats: { ...s.chats, [ev.chat.id]: ev.chat } };
    case "agent_status": {
      const status = { ...s.status, [ev.agent]: { state: ev.state, chatId: ev.chatId, note: ev.note, since: now } };
      let progress = s.progress;
      if (ev.state !== "working" && ev.state !== "thinking" && ev.chatId && progress[ev.chatId]?.[ev.agent]) {
        const forChat = { ...progress[ev.chatId] };
        delete forChat[ev.agent];
        progress = { ...progress, [ev.chatId]: forChat };
      }
      let chats = s.chats;
      if (ev.chatId && chats[ev.chatId] && (ev.state === "working" || ev.state === "thinking") && chats[ev.chatId].status !== "working") {
        chats = { ...chats, [ev.chatId]: { ...chats[ev.chatId], status: "working" } };
      }
      return { ...s, status, progress, chats };
    }
    case "progress": {
      const forChat = { ...(s.progress[ev.chatId] ?? {}), [ev.agent]: { agent: ev.agent, step: ev.step, total: ev.total, label: ev.label } };
      return { ...s, progress: { ...s.progress, [ev.chatId]: forChat } };
    }
    case "done": {
      const next = bindTab(s, tabKey, ev.chatId);
      const chats = next.chats[ev.chatId]?.kind === "direct" ? { ...next.chats, [ev.chatId]: { ...next.chats[ev.chatId], status: "done" as const } } : next.chats;
      return { ...next, chats, suggestions: ev.suggestions?.length ? { ...next.suggestions, [tabKey]: ev.suggestions.slice(0, 4) } : next.suggestions };
    }
    default:
      return s;
  }
}

/* ------------------------------------------------------------------ display */

const SLEEP_AFTER_MS = 3 * 60_000;
const SETTLE_AFTER_MS = 6_000;

export type DisplayState = AgentState | "sleeping";

/** What an agent's mascot shows now: success/error settle back to idle; a long idle falls asleep. */
export function displayState(live: AgentLive | undefined, now: number, mountedAt: number): DisplayState {
  if (!live) return now - mountedAt > SLEEP_AFTER_MS ? "sleeping" : "idle";
  const age = now - live.since;
  if (live.state === "success" || live.state === "error") {
    if (age < SETTLE_AFTER_MS) return live.state;
    return age > SLEEP_AFTER_MS ? "sleeping" : "idle";
  }
  if (live.state === "idle") return age > SLEEP_AFTER_MS ? "sleeping" : "idle";
  return live.state;
}

/** Is anyone still at work in this chat? */
export function chatWorking(s: TeamUiState, chatId: string | undefined, tabKey?: string): boolean {
  if (tabKey && s.busy[tabKey]) return true;
  if (!chatId) return false;
  if (Object.values(s.status).some((l) => l && l.chatId === chatId && (l.state === "working" || l.state === "thinking"))) return true;
  return s.chats[chatId]?.kind === "group" && s.chats[chatId]?.status === "working";
}
