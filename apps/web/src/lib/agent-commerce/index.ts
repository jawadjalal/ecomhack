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
