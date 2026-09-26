"use client";

/**
 * The team chat's data layer: loads the team (GET /api/team), streams replies (POST /api/team/chat, NDJSON),
 * opens chats (POST /api/team/chats), keeps open tabs in sessionStorage and follows navigate events.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import type { AgentId, ChatMessage, CreateTeamChatResponse, TeamChatRequest, TeamChatResponse, TeamEvent, TeamStateResponse } from "@/lib/contracts";
import { DARWIN_TAB, directChatId, directKey, initialState, splitNdjson, tabChatId, teamReducer, type TabRef, type TeamUiState, type UiMessage } from "./team-state";

const TABS_KEY = "darwin.team.tabs";
const POLL_MS = 4000;

export interface TeamApi {
  state: TeamUiState;
  /** ms clock that ticks every few seconds (mascot moods settle and fall asleep over time). */
  now: number;
  mountedAt: number;
  loaded: boolean;
  send: (tabKey: string, text: string) => void;
  answerConfirm: (tabKey: string, chatId: string, confirmId: string, approved: boolean) => void;
  openDirect: (agent: AgentId) => void;
  openGroup: (members: AgentId[]) => Promise<string | null>;
  closeTab: (key: string) => void;
  activate: (key: string) => void;
  setOpen: (open: boolean) => void;
}

export interface UseTeamOptions {
  /** Called with each new agent reply (for reading replies aloud). */
  onReply?: (m: ChatMessage) => void;
}

/** Friendly wording for anything that went wrong. Never shows raw server errors. */
export function friendlyError(status?: number): string {
  if (status === 401 || status === 403) return "You're signed out of mission control. Reload the page and sign in again.";
  if (status === 429) return "We're a bit busy right now. Give it a few seconds and try again.";
  if (status === 404) return "The team isn't available on this store yet. Try again in a moment.";
  return "Something went wrong on our side. Try again in a moment.";
}

/** "Iris, Pixel & Fizz" */
function groupTitle(s: TeamUiState, members: AgentId[]): string {
  const names = members.map((m) => s.agents.find((a) => a.id === m)?.name ?? m[0].toUpperCase() + m.slice(1));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : (names[0] ?? "Team chat");
}

function pagePath(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.pathname.slice(0, 200);
}

function localMessage(from: UiMessage["from"], text: string, extra?: Partial<UiMessage>): UiMessage {
  return { id: `local_${Math.random().toString(36).slice(2, 10)}`, chatId: "", from, text, kind: "text", at: new Date().toISOString(), local: true, ...extra };
}

export function useTeam(options: UseTeamOptions = {}): TeamApi {
  const [state, dispatch] = useReducer(teamReducer, undefined, initialState);
  const [loaded, setLoaded] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const stateRef = useRef(state);
  const onReply = useRef(options.onReply);
  const restored = useRef(false);
  const inflight = useRef(0);
  const loadedChats = useRef(new Set<string>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    onReply.current = options.onReply;
  }, [options.onReply]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  /* ---------------------------------------------------------------- load */

  const loadChat = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`/api/team/chats/${encodeURIComponent(chatId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as TeamChatResponse;
      if (body?.chat && Array.isArray(body.messages)) dispatch({ type: "chat_loaded", chat: body.chat, messages: body.messages });
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  const refreshTeam = useCallback(async () => {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as TeamStateResponse;
      if (!body || !Array.isArray(body.agents)) return null;
      const before = stateRef.current;
      dispatch({ type: "hydrate", agents: body.agents, chats: body.chats ?? [] });
      // Pull new messages for open tabs whose chat moved on while we weren't streaming.
      for (const c of body.chats ?? []) {
        const open = before.tabs.some((t) => tabChatId(t) === c.id || (t.kind === "direct" && !t.chatId && directChatId([c], t.agent) === c.id));
        const have = before.messages[c.id]?.filter((m) => !m.local).length ?? 0;
        if (open && (c.messageCount > have || !loadedChats.current.has(c.id))) {
          loadedChats.current.add(c.id);
          void loadChat(c.id);
        }
      }
      return body;
    } catch {
      return null;
    }
  }, [loadChat]);

  // First load: restore tabs, then fetch the team and every open chat.
  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      try {
        const raw = sessionStorage.getItem(TABS_KEY);
        const saved = raw ? (JSON.parse(raw) as { tabs?: TabRef[]; active?: string }) : null;
        if (saved && Array.isArray(saved.tabs)) dispatch({ type: "restore", tabs: saved.tabs.slice(0, 12), active: saved.active ?? DARWIN_TAB });
      } catch {
        /* storage blocked: start fresh */
      }
    }
    let alive = true;
    void refreshTeam().finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [refreshTeam]);

  // Remember open tabs for this browser tab.
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs: state.tabs, active: state.active }));
    } catch {
      /* storage blocked */
    }
  }, [state.tabs, state.active, loaded]);

  // Load a tab's history the first time it's shown.
  const activeTab = state.tabs.find((t) => t.key === state.active);
  const activeChat = activeTab && tabChatId(activeTab);
  useEffect(() => {
    if (activeChat && !loadedChats.current.has(activeChat)) {
      loadedChats.current.add(activeChat);
      void loadChat(activeChat);
    }
  }, [activeChat, loadChat]);

  // While the team works in the background (no stream open), check in every few seconds.
  const anyWorking = Object.values(state.chats).some((c) => c.status === "working");
  useEffect(() => {
    if (!anyWorking || Object.keys(state.busy).length) return;
    const t = setInterval(() => void refreshTeam(), POLL_MS);
    return () => clearInterval(t);
  }, [anyWorking, state.busy, refreshTeam]);

  /* ---------------------------------------------------------------- stream */

  const stream = useCallback(
    async (tabKey: string, body: TeamChatRequest) => {
      inflight.current += 1;
      dispatch({ type: "busy", tabKey, on: true });
      let toolRan = false;
      const fail = (status?: number) => {
        const tab = stateRef.current.tabs.find((t) => t.key === tabKey);
        const from: AgentId = tab?.kind === "direct" ? tab.agent : "darwin";
        dispatch({ type: "local", tabKey, message: localMessage(from, friendlyError(status), { error: true }) });
      };
      const handle = (event: TeamEvent) => {
        dispatch({ type: "event", tabKey, event, now: Date.now() });
        if (event.type === "navigate" && event.href.startsWith("/") && !event.href.startsWith("//")) router.push(event.href);
        if (event.type === "error") fail();
        if (event.type === "message") {
          const m = event.message;
          if (m.kind === "tool" && m.ok) toolRan = true;
          if (m.from !== "user" && (m.kind === "text" || m.kind === "report")) onReply.current?.(m);
        }
      };
      try {
        const res = await fetch("/api/team/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, context: { path: pagePath() } }),
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          fail(res.status);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const { events, rest } = splitNdjson(done ? `${buffer}\n` : buffer);
          buffer = rest;
          events.forEach(handle);
          if (done) break;
        }
      } catch {
        fail();
      } finally {
        dispatch({ type: "busy", tabKey, on: false });
        inflight.current -= 1;
        if (inflight.current === 0) dispatch({ type: "settle", now: Date.now() });
        if (toolRan) void mutate(() => true);
        void refreshTeam();
      }
    },
    [router, mutate, refreshTeam],
  );

  const send = useCallback(
    (tabKey: string, text: string) => {
      const t = text.trim().slice(0, 2000);
      const tab = stateRef.current.tabs.find((x) => x.key === tabKey);
      if (!t || !tab || stateRef.current.busy[tabKey]) return;
      dispatch({ type: "local", tabKey, message: localMessage("user", t, { chatId: tabChatId(tab) ?? "" }) });
      const chatId = tabChatId(tab);
      void stream(tabKey, chatId ? { chatId, text: t } : { agentId: tab.kind === "direct" ? tab.agent : "darwin", text: t });
    },
    [stream],
  );

  const answerConfirm = useCallback(
    (tabKey: string, chatId: string, confirmId: string, approved: boolean) => {
      if (stateRef.current.busy[tabKey]) return;
      dispatch({ type: "resolve_confirm", chatId, confirmId, resolved: approved ? "approved" : "cancelled" });
      void stream(tabKey, { chatId, text: "", confirm: { id: confirmId, approved } });
    },
    [stream],
  );

  const openDirect = useCallback((agent: AgentId) => {
    const key = directKey(agent);
    const chatId = directChatId(Object.values(stateRef.current.chats), agent);
    dispatch({ type: "open_tab", tab: { key, kind: "direct", agent, chatId }, activate: true });
  }, []);

  const openGroup = useCallback(async (members: AgentId[]) => {
    try {
      const res = await fetch("/api/team/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ members, title: groupTitle(stateRef.current, members) }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as CreateTeamChatResponse | null;
      if (!res.ok || !body?.chat) return friendlyError(res.status);
      dispatch({ type: "event", tabKey: DARWIN_TAB, event: { type: "chat_created", chat: body.chat }, now: Date.now() });
      dispatch({ type: "open_tab", tab: { key: body.chat.id, kind: "group", chatId: body.chat.id }, activate: true });
      loadedChats.current.add(body.chat.id);
      return null;
    } catch {
      return friendlyError();
    }
  }, []);

  const closeTab = useCallback((key: string) => dispatch({ type: "close_tab", key }), []);
  const activate = useCallback((key: string) => dispatch({ type: "activate", key }), []);
  const setOpen = useCallback((open: boolean) => dispatch({ type: "set_open", open }), []);

  return { state, now, mountedAt, loaded, send, answerConfirm, openDirect, openGroup, closeTab, activate, setOpen };
}
