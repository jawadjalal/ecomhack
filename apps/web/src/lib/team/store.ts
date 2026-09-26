/**
 * Team chats, messages and pending confirmations in the shared KV (json-store). Sizes are capped.
 */
import type { AgentId, Chat, ChatMessage, ChatSummary, TeamPendingConfirm } from "@/lib/contracts";
import { kvDelete, kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import { id } from "@/lib/ids";
import { ROSTER } from "./roster";

const CHATS = "team-chats";
const MESSAGES = "team-messages";
const PENDING = "team-pending";
export const MAX_CHATS = 40;
export const MAX_MESSAGES_PER_CHAT = 150;
export const MAX_TEXT = 1500;
const MAX_PENDING = 30;

/** A pending confirmation plus where it was asked. */
export interface PendingRecord extends TeamPendingConfirm {
  /** Chat the confirm message was posted in (the merchant's chat). */
  chatId: string;
  messageId: string;
  /** Pixel's changeset the tool acts on, if any. */
  changesetId?: string;
  createdAt: string;
}

type MessageMap = Record<string, ChatMessage[]>;

const chats = () => kvGet<Chat[]>(CHATS, () => []);
const messages = () => kvGet<MessageMap>(MESSAGES, () => ({}));

export function listChats(): Chat[] {
  return [...chats()].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

export function getChat(chatId: string): Chat | undefined {
  return chats().find((c) => c.id === chatId);
}

export function createChat(input: { kind: Chat["kind"]; title: string; members: AgentId[]; createdBy: Chat["createdBy"] }): Chat {
  const now = new Date().toISOString();
  const chat: Chat = {
    id: id("chat"),
    kind: input.kind,
    title: input.title.trim().slice(0, 80) || "Team chat",
    members: [...new Set(input.members)],
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    status: "active",
  };
  const all = [chat, ...listChats()];
  const dropped = all.slice(MAX_CHATS).map((c) => c.id);
  kvSet(CHATS, all.slice(0, MAX_CHATS));
  if (dropped.length)
    kvUpdate<MessageMap>(MESSAGES, () => ({}), (m) => {
      const next = { ...m };
      for (const d of dropped) delete next[d];
      return next;
    });
  return chat;
}

export function updateChat(chatId: string, patch: Partial<Pick<Chat, "title" | "members" | "status">>): Chat | undefined {
  let out: Chat | undefined;
  kvUpdate<Chat[]>(CHATS, () => [], (all) =>
    all.map((c) => {
      if (c.id !== chatId) return c;
      out = {
        ...c,
        ...patch,
        ...(patch.members ? { members: [...new Set(patch.members)] } : {}),
        updatedAt: new Date().toISOString(),
      };
      return out;
    }),
  );
  return out;
}

/** The merchant's 1:1 chat with an agent (created on first use). */
export function directChat(agent: AgentId): { chat: Chat; created: boolean } {
  const found = chats().find((c) => c.kind === "direct" && c.members.length === 1 && c.members[0] === agent);
  if (found) return { chat: found, created: false };
  return { chat: createChat({ kind: "direct", title: ROSTER[agent].name, members: [agent], createdBy: "user" }), created: true };
}

export function addMessage(m: Omit<ChatMessage, "id" | "at"> & { at?: string }): ChatMessage {
  const msg: ChatMessage = { ...m, id: id("msg"), at: m.at ?? new Date().toISOString(), text: m.text.slice(0, MAX_TEXT) };
  kvUpdate<MessageMap>(MESSAGES, () => ({}), (all) => ({
    ...all,
    [msg.chatId]: [...(all[msg.chatId] ?? []), msg].slice(-MAX_MESSAGES_PER_CHAT),
  }));
  kvUpdate<Chat[]>(CHATS, () => [], (all) => all.map((c) => (c.id === msg.chatId ? { ...c, updatedAt: msg.at } : c)));
  return msg;
}

export function listMessages(chatId: string, limit = MAX_MESSAGES_PER_CHAT): ChatMessage[] {
  return (messages()[chatId] ?? []).slice(-limit);
}

export function updateMessage(chatId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | undefined {
  let out: ChatMessage | undefined;
  kvUpdate<MessageMap>(MESSAGES, () => ({}), (all) => ({
    ...all,
    [chatId]: (all[chatId] ?? []).map((m) => (m.id === messageId ? (out = { ...m, ...patch }) : m)),
  }));
  return out;
}

export function chatSummaries(): ChatSummary[] {
  const all = messages();
  return listChats().map((c) => ({ ...c, lastMessage: all[c.id]?.at(-1), messageCount: all[c.id]?.length ?? 0 }));
}

/* ------------------------------------------------------------------ pending confirmations */

export function savePending(p: PendingRecord): PendingRecord {
  kvUpdate<PendingRecord[]>(PENDING, () => [], (all) => [p, ...all.filter((x) => x.id !== p.id)].slice(0, MAX_PENDING));
  return p;
}

export function getPending(pendingId: string): PendingRecord | undefined {
  return kvGet<PendingRecord[]>(PENDING, () => []).find((p) => p.id === pendingId);
}

export function takePending(pendingId: string): PendingRecord | undefined {
  const p = getPending(pendingId);
  if (p) kvUpdate<PendingRecord[]>(PENDING, () => [], (all) => all.filter((x) => x.id !== pendingId));
  return p;
}

/** Tests and demo resets. */
export function resetTeam() {
  kvDelete(CHATS);
  kvDelete(MESSAGES);
  kvDelete(PENDING);
}
