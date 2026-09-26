/**
 * Team chats and messages, persisted in the shared KV (.data/team-chats.json, .data/team-messages.json).
 * Capped: MAX_CHATS chats (oldest non-direct dropped first), MAX_MESSAGES per chat.
 */
import type { AgentId, Chat, ChatMessage, ChatSummary, TeamPendingConfirm } from "@/lib/contracts/team";
import { kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import { id } from "@/lib/ids";

const CHATS_KEY = "team-chats";
const MESSAGES_KEY = "team-messages";
export const MAX_CHATS = 40;
export const MAX_MESSAGES = 150;
export const MAX_TEXT = 1200;

interface StoredChat extends Chat {
  /** When the user last posted in / opened the chat (for `unread`). */
  readAt?: string;
}

/** A confirm waiting for the merchant, with where it came from. */
export interface StoredConfirm extends TeamPendingConfirm {
  chatId: string;
  messageId: string;
}

const chats = () => kvGet<StoredChat[]>(CHATS_KEY, () => []);
const messages = () => kvGet<Record<string, ChatMessage[]>>(MESSAGES_KEY, () => ({}));

export const directChatId = (agent: AgentId) => `chat_direct_${agent}`;

function publicChat(c: StoredChat): Chat {
  return { id: c.id, kind: c.kind, title: c.title, members: c.members, createdBy: c.createdBy, createdAt: c.createdAt, status: c.status, ...(c.pinned ? { pinned: true } : {}) };
}

export function getChat(chatId: string): Chat | undefined {
  const c = chats().find((x) => x.id === chatId);
  return c ? publicChat(c) : undefined;
}

/** The user's 1:1 chat with an agent (created on first use). */
export function ensureDirectChat(agent: AgentId, title: string): Chat {
  const existing = getChat(directChatId(agent));
  if (existing) return existing;
  return saveChat({ id: directChatId(agent), kind: "direct", title, members: [agent], createdBy: "user", createdAt: new Date().toISOString(), status: "active" });
}

function saveChat(chat: StoredChat): Chat {
  kvUpdate<StoredChat[]>(CHATS_KEY, () => [], (all) => {
    const next = [chat, ...all.filter((c) => c.id !== chat.id)];
    // Over the cap: drop the oldest group chats (direct chats are few and stay).
    while (next.length > MAX_CHATS) {
      const idx = next.map((c) => c.kind).lastIndexOf("group");
      if (idx === -1) break;
      const [dropped] = next.splice(idx, 1);
      kvUpdate<Record<string, ChatMessage[]>>(MESSAGES_KEY, () => ({}), (m) => {
        const copy = { ...m };
        delete copy[dropped.id];
        return copy;
      });
    }
    return next;
  });
  return publicChat(chat);
}

export function createChat(input: { kind: Chat["kind"]; title: string; members: AgentId[]; createdBy: Chat["createdBy"] }): Chat {
  const members = [...new Set(input.members)];
  return saveChat({
    id: id("chat"),
    kind: input.kind,
    title: input.title.trim().slice(0, 80) || "Team chat",
    members,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    status: "active",
  });
}

export function setChatStatus(chatId: string, status: Chat["status"]) {
  kvUpdate<StoredChat[]>(CHATS_KEY, () => [], (all) => all.map((c) => (c.id === chatId ? { ...c, status } : c)));
}

export function markRead(chatId: string) {
  const at = new Date().toISOString();
  kvUpdate<StoredChat[]>(CHATS_KEY, () => [], (all) => all.map((c) => (c.id === chatId ? { ...c, readAt: at } : c)));
}

export function listMessages(chatId: string): ChatMessage[] {
  return messages()[chatId] ?? [];
}

export function addMessage(input: Omit<ChatMessage, "id" | "at"> & { at?: string }): ChatMessage {
  const message: ChatMessage = { ...input, id: id("msg"), text: input.text.slice(0, MAX_TEXT), at: input.at ?? new Date().toISOString() };
  kvUpdate<Record<string, ChatMessage[]>>(MESSAGES_KEY, () => ({}), (all) => ({ ...all, [message.chatId]: [...(all[message.chatId] ?? []), message].slice(-MAX_MESSAGES) }));
  return message;
}

/** Every chat, newest activity first, with its last message and unread count. */
export function listChatSummaries(): ChatSummary[] {
  const all = messages();
  return chats()
    .map((c) => {
      const msgs = all[c.id] ?? [];
      const unread = msgs.filter((m) => m.from !== "user" && (!c.readAt || m.at > c.readAt)).length;
      return { ...publicChat(c), lastMessage: msgs.at(-1), messageCount: msgs.length, unread };
    })
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastMessage?.at ?? b.createdAt).localeCompare(a.lastMessage?.at ?? a.createdAt));
}

/** Darwin's Inbox: the pinned direct chat proactive messages land in. */
export const INBOX_CHAT_ID = "chat_inbox";

export function ensureInboxChat(): Chat {
  const existing = chats().find((c) => c.id === INBOX_CHAT_ID);
  if (existing) {
    if (!existing.pinned) kvUpdate<StoredChat[]>(CHATS_KEY, () => [], (all) => all.map((c) => (c.id === INBOX_CHAT_ID ? { ...c, pinned: true } : c)));
    return publicChat({ ...existing, pinned: true });
  }
  return saveChat({
    id: INBOX_CHAT_ID,
    kind: "direct",
    title: "Inbox",
    members: ["darwin"],
    createdBy: "darwin",
    createdAt: new Date().toISOString(),
    status: "active",
    pinned: true,
  });
}

/* ------------------------------------------------------------------ pending confirms (kept on their message) */

export function findPendingConfirm(confirmId: string): StoredConfirm | undefined {
  for (const [chatId, msgs] of Object.entries(messages())) {
    const m = msgs.find((x) => x.pendingConfirm?.id === confirmId);
    if (m?.pendingConfirm) return { ...m.pendingConfirm, chatId, messageId: m.id };
  }
  return undefined;
}

/** Answered: clear it from its message so it can't run twice. */
export function clearPendingConfirm(confirmId: string): boolean {
  let cleared = false;
  kvUpdate<Record<string, ChatMessage[]>>(MESSAGES_KEY, () => ({}), (all) => {
    const next: Record<string, ChatMessage[]> = {};
    for (const [chatId, msgs] of Object.entries(all)) {
      next[chatId] = msgs.map((m) => {
        if (m.pendingConfirm?.id !== confirmId) return m;
        cleared = true;
        const rest = { ...m };
        delete rest.pendingConfirm;
        return rest;
      });
    }
    return next;
  });
  return cleared;
}

export function resetTeamStore() {
  kvSet(CHATS_KEY, []);
  kvSet(MESSAGES_KEY, {});
}
