/**
 * Agent commerce surface — public API. OWNED BY: agent-commerce PR. Keep these signatures stable.
 *
 * One tool dispatcher shared by REST routes, the MCP endpoint, and in-process simulated shoppers,
 * so every path is tracked identically.
 */
export type AgentToolName =
  | "search_products"
  | "get_product"
  | "check_availability"
  | "add_to_cart"
  | "negotiate"
  | "checkout";

export interface AgentContext {
  /** Stable id for the agent (distinct_id). */
  agentId: string;
  agentName: string;
  sessionId: string;
  synthetic?: boolean;
  persona?: string;
}

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Fields the agent asked for that the current agentSurface does not expose. */
  missing?: string[];
}

export async function callAgentTool(
  _tool: AgentToolName,
  _args: Record<string, unknown>,
  _ctx: AgentContext,
): Promise<AgentToolResult> {
  // Placeholder until the agent-commerce PR lands.
  return { ok: false, error: "not implemented" };
}

import type { AgentSessionSummary, ShoppingGoal } from "@/lib/contracts";

/** KV keys owned by this module (the optimizer's reset clears them). */
export const AGENT_KV_KEYS = { sessions: "agent-sessions", carts: "agent-carts" } as const;

/**
 * Run one buyer agent end-to-end against the store via `callAgentTool` (in-process).
 * Used by the simulator for agent traffic and by the console's "send a shopper" button.
 * `useLlm` lets Grok/Claude pick actions; otherwise a scripted policy is used.
 */
export async function runBuyerAgent(
  goal: ShoppingGoal,
  ctx: AgentContext,
  _opts: { useLlm?: boolean } = {},
): Promise<AgentSessionSummary> {
  // Placeholder until the agent-commerce PR lands.
  return {
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    goal,
    startedAt: new Date().toISOString(),
    outcome: "abandoned",
    reason: "not implemented",
    toolCalls: [],
    synthetic: ctx.synthetic ?? false,
  };
}

/** Recent agent sessions, newest first. */
export function listAgentSessions(_limit = 20): AgentSessionSummary[] {
  return [];
}
