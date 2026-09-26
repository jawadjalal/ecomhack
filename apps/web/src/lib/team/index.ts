/**
 * The Darwin agent team — public API. OWNED BY: team.
 *
 *   runTeamTurn(request, emit)   one merchant turn, streamed as TeamEvents (orchestrator.ts)
 *   teamState()                  GET /api/team: agents (with tools) + chats (last message, unread) + model
 *   chatView(id)                 GET /api/team/chats/[id]: chat + messages (marks it read)
 *   createUserChat(input)        POST /api/team/chats: the merchant opens a direct/group chat
 *   TEAM, getAgent, SPECIALISTS  the roster (roster.ts, client-safe)
 */
import type { AgentId, Chat, CreateChatRequest, TeamChatResponse, TeamStateResponse } from "@/lib/contracts/team";
import { routeLabel } from "@/lib/llm/team";
import { TEAM, TEAM_BY_ID } from "./roster";
import { createChat, ensureDirectChat, getChat, listChatSummaries, listMessages, markRead, resetTeamStore } from "./store";

export { runTeamTurn, teamIntro, TeamError, MAX_PARALLEL, type Emit, type TeamTurnInput } from "./orchestrator";
export { TEAM, TEAM_BY_ID, getAgent, SPECIALISTS, DEFAULT_MODEL_LABEL, EDITOR_MODEL_LABEL } from "./roster";
export { TEAM_TOOLS, toolsFor, safeHref, PAGES } from "./tools";

export function teamState(): TeamStateResponse {
  return { agents: TEAM, chats: listChatSummaries(), model: routeLabel() };
}

export function chatView(chatId: string): TeamChatResponse | undefined {
  const chat = getChat(chatId);
  if (!chat) return undefined;
  markRead(chatId);
  return { chat, messages: listMessages(chatId) };
}

/** One member → the direct chat with that agent (reused); several → a new group chat (Darwin always joins). */
export function createUserChat(input: CreateChatRequest): Chat {
  const members = [...new Set(input.members)].filter((m): m is AgentId => m in TEAM_BY_ID);
  if (!members.length) throw new Error("Pick at least one agent.");
  if (members.length === 1 && !input.title) return ensureDirectChat(members[0], TEAM_BY_ID[members[0]].name);
  const all: AgentId[] = members.includes("darwin") ? members : ["darwin", ...members];
  return createChat({ kind: "group", title: input.title?.trim() || all.map((m) => TEAM_BY_ID[m].name).join(", "), members: all, createdBy: "user" });
}

export function resetTeam() {
  resetTeamStore();
}
