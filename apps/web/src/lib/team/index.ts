/**
 * Darwin's agent team — public API. OWNED BY: team.
 *
 *   runTeamTurn(input, emit)  one merchant turn (message or confirm answer), streamed as TeamEvents
 *   getTeamState()            roster + chats (GET /api/team)
 *   getChatView(id)           one chat's messages (GET /api/team/chats/[id])
 *   createUserChat(input)     a chat the merchant opens (POST /api/team/chats)
 *   TEAM_AGENTS               the roster (names/roles live in roster.ts)
 */
import type { AgentId, Chat, TeamAgent, TeamChatResponse, TeamStateResponse } from "@/lib/contracts";
import { llmLabel } from "@/lib/llm/client";
import { ROSTER, agentName, isAgentId } from "./roster";
import { chatSummaries, createChat, directChat, getChat, listMessages } from "./store";
import { AGENT_TOOLS } from "./tools";

export { runTeamTurn, planHeuristic, splitAsk, limiter, TEAM_HELP, MAX_CONCURRENT, type Emit, type TeamTurnInput } from "./orchestrator";
export { ROSTER, SPECIALISTS, agentName, findAgent, isAgentId } from "./roster";
export { AGENT_TOOLS, TEAM_TOOLS, safeHref, ownerOf } from "./tools";
export { resetTeam } from "./store";

const ORCHESTRATION: Partial<Record<AgentId, string[]>> = { darwin: ["delegate", "start_group_chat", "post", "report"] };

export function teamAgents(): TeamAgent[] {
  return Object.values(ROSTER).map((a) => ({ ...a, tools: [...AGENT_TOOLS[a.id], ...(ORCHESTRATION[a.id] ?? ["post", "ask", "start_group_chat"])] }));
}

export function getTeamState(): TeamStateResponse {
  return { agents: teamAgents(), chats: chatSummaries(), model: llmLabel() };
}

export function getChatView(chatId: string): TeamChatResponse | undefined {
  const chat = getChat(chatId);
  return chat ? { chat, messages: listMessages(chatId) } : undefined;
}

/**
 * A chat the merchant opens. One member → that agent's direct chat (reused). Several → a group chat;
 * Darwin always joins group chats (he coordinates).
 */
export function createUserChat(input: { title?: string; members: AgentId[] }): Chat {
  const members = [...new Set(input.members.filter(isAgentId))];
  if (!members.length) throw new Error("Pick at least one agent.");
  if (members.length === 1 && !input.title?.trim()) return directChat(members[0]).chat;
  const all: AgentId[] = members.includes("darwin") ? members : ["darwin", ...members];
  return createChat({ kind: "group", title: input.title?.trim() || all.map(agentName).join(", "), members: all, createdBy: "user" });
}
