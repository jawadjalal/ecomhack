/**
 * Darwin agent team contract. Darwin (manager) plans and delegates to specialists
 * (Iris, Pixel, Fizz, Dash); they work concurrently in chats and report back.
 * Owner: team (lib/team/**, /api/team/**). UI: components/console/assistant-*, components/team/**.
 */

/** Stable agent ids. Display names/roles live in lib/team/roster.ts (easy to change). */
export type AgentId = "darwin" | "iris" | "pixel" | "fizz" | "dash";

export const AGENT_IDS: AgentId[] = ["darwin", "iris", "pixel", "fizz", "dash"];

export type MascotKind = "analyst" | "observer" | "designer" | "experimenter" | "shipper";

export interface TeamAgent {
  id: AgentId;
  name: string;
  role: string;
  /** One sentence: what this agent does. */
  blurb: string;
  mascot: MascotKind;
  /** CSS colour (hex) for avatars, bubbles, chips. */
  color: string;
  /** Tool names this agent may call (informational for the UI). */
  tools?: string[];
}

export type ChatStatus = "active" | "working" | "done";

export interface Chat {
  id: string;
  kind: "direct" | "group";
  title: string;
  members: AgentId[];
  createdBy: "user" | AgentId;
  createdAt: string;
  status: ChatStatus;
  /** Last activity (ISO). */
  updatedAt?: string;
}

export type ChatMessageKind = "text" | "progress" | "tool" | "report" | "confirm" | "navigate";

export interface TeamPendingConfirm {
  /** Id to echo back in POST /api/team/chat { confirm: { id, approved } }. */
  id: string;
  agent: AgentId;
  tool: string;
  args: Record<string, unknown>;
  /** The question to show with Confirm / Cancel. */
  prompt: string;
  /** Set once the user answered. */
  resolved?: "approved" | "cancelled";
  /** Code changes awaiting approval (Pixel's changeset): per-file line counts + a short unified diff. */
  diff?: { path: string; created?: boolean; added: number; removed: number; preview: string }[];
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
  ok?: boolean;
  link?: { label: string; href: string };
  /** The result involves simulated (synthetic) traffic or buyers. */
  synthetic?: boolean;
  pendingConfirm?: TeamPendingConfirm;
  at: string;
}

export type AgentState = "idle" | "thinking" | "working" | "success" | "error";

/**
 * One NDJSON line streamed by POST /api/team/chat. `message` events upsert by message id (answering a confirm
 * re-sends the confirm message with `pendingConfirm.resolved`). The stream always ends with `done`.
 */
export type TeamEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "chat_created"; chat: Chat }
  /** Members, status or title changed (e.g. an agent joined, work finished). */
  | { type: "chat_updated"; chat: Chat }
  | { type: "agent_status"; agent: AgentId; state: AgentState; chatId?: string; note?: string }
  | { type: "progress"; chatId: string; agent: AgentId; step: number; total?: number; label: string }
  | { type: "navigate"; href: string; agent?: AgentId }
  | { type: "done"; chatId: string; model: string; suggestions?: string[] }
  | { type: "error"; error: string };

/* ---- API shapes ---- */

// POST /api/team/chat  TeamChatRequest → NDJSON stream of TeamEvent (application/x-ndjson), ends with "done".
//      No chatId → the user's direct chat with `agentId` (default "darwin").
//      confirm → resolves a pending confirm (runs or cancels the tool); text may be empty.
export interface TeamChatRequest {
  chatId?: string;
  agentId?: AgentId;
  text: string;
  confirm?: { id: string; approved: boolean };
  /** Where the merchant is asking from (console path). */
  context?: { path?: string };
}

export interface ChatSummary extends Chat {
  lastMessage?: ChatMessage;
  messageCount: number;
}

// GET /api/team → TeamStateResponse
export interface TeamStateResponse {
  agents: TeamAgent[];
  chats: ChatSummary[];
  /** llmLabel() of the default model, or "heuristic". */
  model: string;
}

// GET /api/team/chats/[id] → TeamChatResponse (404 { error } when unknown)
export interface TeamChatResponse {
  chat: Chat;
  messages: ChatMessage[];
}

// POST /api/team/chats { title?, members } → { chat }   (user-created chat)
export interface CreateTeamChatRequest {
  title?: string;
  members: AgentId[];
}
export interface CreateTeamChatResponse {
  chat: Chat;
}
