import { describe, expect, it } from "vitest";
import type { Chat, ChatMessage } from "@/lib/contracts";
import { DARWIN_TAB, directChatId, displayState, initialState, splitNdjson, tabMessages, teamReducer, type TeamUiState } from "./team-state";

const chat = (over: Partial<Chat>): Chat => ({ id: "chat_1", kind: "direct", title: "Darwin", members: ["darwin"], createdBy: "user", createdAt: "2026-01-01T00:00:00Z", status: "active", ...over });
const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: "msg_1", chatId: "chat_1", from: "darwin", text: "Hi", kind: "text", at: "2026-01-01T00:00:01Z", ...over });

describe("splitNdjson", () => {
  it("keeps the unfinished tail and skips bad lines", () => {
    const { events, rest } = splitNdjson('{"type":"done","chatId":"c","model":"x"}\nnot json\n{"type":"err');
    expect(events).toHaveLength(1);
    expect(rest).toBe('{"type":"err');
  });
});

describe("directChatId", () => {
  it("finds the merchant's own one-to-one chat", () => {
    const chats = [chat({ id: "g", kind: "group", members: ["darwin", "iris"] }), chat({ id: "d" }), chat({ id: "i", members: ["iris"], title: "Iris" })];
    expect(directChatId(chats, "darwin")).toBe("d");
    expect(directChatId(chats, "iris")).toBe("i");
    expect(directChatId(chats, "fizz")).toBeUndefined();
  });
});

describe("teamReducer", () => {
  it("binds a new direct tab to its chat and drops the optimistic echo", () => {
    let s: TeamUiState = initialState();
    s = teamReducer(s, { type: "local", tabKey: DARWIN_TAB, message: { ...msg({ id: "local_1", from: "user", text: "How are we doing?", chatId: "" }), local: true } });
    s = teamReducer(s, { type: "event", tabKey: DARWIN_TAB, now: 1, event: { type: "message", message: msg({ id: "m_u", from: "user", text: "How are we doing?" }) } });
    s = teamReducer(s, { type: "event", tabKey: DARWIN_TAB, now: 1, event: { type: "message", message: msg({ id: "m_a", text: "Great." }) } });
    const tab = s.tabs[0];
    expect(tab.chatId).toBe("chat_1");
    expect(tabMessages(s, tab).map((m) => m.id)).toEqual(["m_u", "m_a"]);
  });

  it("opens a tab for a group Darwin starts and counts unread messages", () => {
    let s = initialState();
    const group = chat({ id: "g1", kind: "group", title: "Fix checkout", members: ["darwin", "iris", "pixel"], createdBy: "darwin", status: "working" });
    s = teamReducer(s, { type: "event", tabKey: DARWIN_TAB, now: 1, event: { type: "chat_created", chat: group } });
    s = teamReducer(s, { type: "event", tabKey: DARWIN_TAB, now: 1, event: { type: "message", message: msg({ id: "g_m", chatId: "g1", from: "iris" }) } });
    expect(s.tabs.map((t) => t.key)).toEqual([DARWIN_TAB, "g1"]);
    expect(s.tabs[0].chatId).toBeUndefined();
    expect(s.unread.g1).toBe(1);
    s = teamReducer(s, { type: "set_open", open: true });
    s = teamReducer(s, { type: "activate", key: "g1" });
    expect(s.unread.g1).toBeUndefined();
  });
});

describe("displayState", () => {
  it("lets success settle and falls asleep after a long idle", () => {
    expect(displayState({ state: "success", since: 0 }, 1000, 0)).toBe("success");
    expect(displayState({ state: "success", since: 0 }, 10_000, 0)).toBe("idle");
    expect(displayState(undefined, 5 * 60_000, 0)).toBe("sleeping");
    expect(displayState({ state: "working", since: 0 }, 10 * 60_000, 0)).toBe("working");
  });
});
