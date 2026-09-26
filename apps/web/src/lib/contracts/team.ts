/**
 * The Darwin agent team: a manager (Darwin) and specialists, each with its own tool set, talking to the merchant
 * and to each other in direct and group chats. Streamed to the bottom chat panel as NDJSON `TeamEvent`s.
 *
 * API (all admin):
 *   GET  /api/team               → TeamStateResponse  { agents, chats (with last message + unread) }
 *   GET  /api/team/chats/[id]    → TeamChatResponse   { chat, messages }                         (404 { error })
 *   POST /api/team/chats         { title?, members } → Chat (a group/direct chat the user creates)
 *   POST /api/team/chat          TeamChatRequest → application/x-ndjson stream of TeamEvent, one per line,
 *                                always ending with { type: "done" }.
 */

import type { ProactiveAction } from "./watch";

export type AgentId = "darwin" | "iris" | "pixel" | "fizz" | "dash";

export const AGENT_IDS: AgentId[] = ["darwin", "iris", "pixel", "fizz", "dash"];

/** Mascot art in public/mascots/{kind}-{state}.svg. "leader" is Darwin's red crowned squircle (also the logo). */
export type MascotKind = "leader" | "analyst" | "observer" | "designer" | "experimenter" | "shipper";

/** Mascot animation states (one SVG each). "tapped" is a one-shot reaction; the rest loop. */
export type MascotState = "idle" | "working" | "thinking" | "success" | "error" | "sleeping" | "tapped";

/** One capability an agent has, shown in the onboarding team intro and the team panel. */
export interface TeamAgentTool {
  /** Tool name as the model sees it (e.g. "merge_pr"). */
  name: string;
  /** Short human label ("Merge a pull request"). */
  label: string;
  /** Side-effecting: runs only after the merchant confirms. */
  confirm?: boolean;
}

export interface TeamAgent {
  id: AgentId;
  name: string;
  /** Short role title: "Manager", "Observer", … */
  role: string;
  /** One sentence on what this agent does. */
  blurb: string;
  mascot: MascotKind;
  /** CSS colour (hex) for the avatar ring / bubbles. */
  color: string;
  /** Human label of the model this agent runs on (e.g. "DeepSeek V4 Flash"). */
  model?: string;
  /** What this agent can do: its dedicated tools. */
  tools?: TeamAgentTool[];
}

export type ChatKind = "direct" | "group";
export type ChatStatus = "active" | "working" | "done";

export interface Chat {
  id: string;
  kind: ChatKind;
  title: string;
  /** Agents in the chat (the user is always implicitly a member). */
  members: AgentId[];
  createdBy: "user" | AgentId;
  createdAt: string;
  status: ChatStatus;
  /** Stays at the top of the list (the Inbox Darwin writes into). */
  pinned?: boolean;
}

export type ChatMessageKind = "text" | "progress" | "tool" | "report" | "confirm" | "navigate";

export interface TeamPendingConfirm {
  /** Id to send back in `confirm.id`. */
  id: string;
  agent: AgentId;
  tool: string;
  args: Record<string, unknown>;
  /** The question to show with Confirm / Cancel. */
  prompt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  from: "user" | AgentId;
  /** Short text (progress ≤ 140 chars; reports a few sentences). */
  text: string;
  kind: ChatMessageKind;
  /** Tool name for kind "tool" / "confirm". */
  tool?: string;
  /** Tool succeeded (kind "tool"). */
  ok?: boolean;
  link?: { label: string; href: string };
  /** The result involves simulated (synthetic) traffic or buyers. */
  synthetic?: boolean;
  /** Kind "confirm": the side-effecting action waiting for the user. Cleared once answered. */
  pendingConfirm?: TeamPendingConfirm;
  /** Proactive message (Darwin's watch): one-tap actions, each a single-use token (see contracts/watch.ts). */
  actions?: ProactiveAction[];
  /** The watch signal this message came from. */
  signalId?: string;
  at: string;
}

export type AgentState = "idle" | "thinking" | "working" | "success" | "error";

export type TeamEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "chat_created"; chat: Chat }
  | { type: "agent_status"; agent: AgentId; state: AgentState; chatId?: string; label?: string }
  | { type: "progress"; chatId: string; agent: AgentId; step: number; total?: number; label: string }
  | { type: "navigate"; href: string }
  | { type: "done"; chatId: string; model: string; error?: string };

export interface ChatSummary extends Chat {
  lastMessage?: ChatMessage;
  messageCount: number;
  /** Messages from agents since the user last posted in / opened this chat. */
  unread: number;
}

/** GET /api/team */
export interface TeamStateResponse {
  agents: TeamAgent[];
  chats: ChatSummary[];
  /** llmLabel() of the default model, or "heuristic". */
  model: string;
}

/** GET /api/team/chats/[id] */
export interface TeamChatResponse {
  chat: Chat;
  messages: ChatMessage[];
}

/** POST /api/team/chats */
export interface CreateChatRequest {
  title?: string;
  members: AgentId[];
}

/** POST /api/team/chat */
export interface TeamChatRequest {
  /** Existing chat. Omitted → the user's direct chat with `agentId` (default Darwin). */
  chatId?: string;
  /** Who the user is talking to (default: Darwin, or the chat's first member). */
  agentId?: AgentId;
  text: string;
  /** Answer a pending confirm. `text` may be empty. */
  confirm?: { id: string; approved: boolean };
  /** Where the merchant is asking from (console path). */
  context?: { path?: string };
}
