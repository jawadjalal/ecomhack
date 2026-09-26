/**
 * Agent commerce surface — public API. OWNED BY: agent-commerce PR. Keep these signatures stable.
 *
 * One tool dispatcher shared by REST routes, the MCP endpoint, and in-process simulated shoppers,
 * so every path is tracked identically.
 */
import type { AgentSessionSummary, ShoppingGoal } from "@/lib/contracts";
import { llmAvailable } from "@/lib/llm/client";
import { resolveSpecForVisitor } from "@/lib/spec/resolve";
import { runScriptedBuyer, type BuyerHooks, type BuyerRunResult } from "./buyer";
import { runLlmBuyer } from "./buyer-llm";
import { dispatchAgentTool, newSessionSummary } from "./dispatcher";
import { resetA2aConversations } from "./a2a";
export { a2aSend, type A2aCaller } from "./a2a";
export { runA2aBuyer } from "./a2a-buyer";
import { resetMcpSessions } from "./mcp";
import {
  AGENT_KV_KEYS,
  getAgentSession,
  emptyCommerceState,
  getCommerceState,
  listAgentSessions,
  resetAgentState,
  saveCommerceState,
  upsertAgentSession,
} from "./state";
import type { AgentContext, AgentToolName, AgentToolResult, ToolCaller } from "./types";

export type {
  AgentChannel,
  AgentContext,
  AgentOrder,
  AgentProductDetail,
  AgentToolErrorCode,
  AgentToolName,
  AgentToolResult,
  AvailabilityView,
  CartLine,
  CartView,
  MissingField,
  NegotiationOutcome,
  ToolCaller,
  WantableField,
} from "./types";
export { AGENT_TOOL_NAMES, MISSING_FIELD_SURFACE, WANTABLE_FIELDS } from "./types";
export { AGENT_KV_KEYS, getAgentSession, listAgentSessions };
export {
  parseGoalBrief,
  sampleShoppingGoal,
  wantFromGoal,
  deadlineLabel,
  BUYER_PERSONAS,
  PROCEED_ANYWAY,
  BUNDLE_TAKE_RATE,
} from "./buyer";
export type { BuyerPersona, BuyerRunResult, BuyerStep } from "./buyer";
export { merchantFloor } from "./negotiation";
export { TOOL_META, toolInputSchema } from "./tools";
export { connectMcp, normaliseToolResult, type McpConnection, type McpConnectOptions, type McpTool } from "./mcp-client";
export { buyerSystemPrompt, DEFAULT_BUYER_SYSTEM } from "./buyer-llm";

/**
 * Call one agent tool. Resolves the (experiment-aware) spec for `ctx.agentId`, shapes the response
 * by `spec.agentSurface`, tracks `agent_request` + funnel events and updates the session summary.
 */
export async function callAgentTool(
  tool: AgentToolName,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<AgentToolResult> {
  return dispatchAgentTool(tool, args, ctx);
}

/**
 * Run one buyer agent end-to-end against the store via `callAgentTool` (in-process).
 * Used by the simulator for agent traffic and by the console's "send a shopper" button.
 * `useLlm` lets the LLM (OpenRouter / Grok / Claude) pick actions (≤ 8 steps); otherwise, or on any LLM error,
 * the fast scripted policy is used.
 */
export async function runBuyerAgent(
  goal: ShoppingGoal,
  ctx: AgentContext,
  opts: { useLlm?: boolean } & BuyerHooks = {},
): Promise<AgentSessionSummary> {
  const now = ctx.now?.() ?? new Date().toISOString();
  // A buyer run is a new shopping trip: never inherit a previous run's cart, deals or history,
  // even if a caller reuses a session id (e.g. the simulator replaying a seed).
  saveCommerceState(ctx.sessionId, emptyCommerceState());
  const fresh = () => newSessionSummary(ctx, resolveSpecForVisitor(ctx.agentId), now);
  upsertAgentSession(ctx.sessionId, fresh, (s) => {
    for (const key of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[key];
    Object.assign(s, fresh(), { goal });
  });
  const call: ToolCaller = (tool, args) => dispatchAgentTool(tool, args, ctx);
  const hooks: BuyerHooks = { onStep: opts.onStep, onThought: opts.onThought };

  let result: BuyerRunResult | undefined;
  if (opts.useLlm && llmAvailable()) {
    try {
      result = await runLlmBuyer(goal, call, hooks);
    } catch (err) {
      console.warn("[agent-commerce] LLM buyer failed, falling back to scripted policy:", String(err).slice(0, 200));
      // Start the scripted run from a clean cart (deals/orders are kept).
      saveCommerceState(ctx.sessionId, { ...getCommerceState(ctx.sessionId), cart: [] });
    }
  }
  result ??= await runScriptedBuyer(goal, call, { seed: ctx.sessionId, ...hooks });

  const summary = getAgentSession(ctx.sessionId);
  if (summary) return structuredClone(summary);
  // Session list was trimmed concurrently; synthesise from the run.
  return {
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    goal,
    startedAt: now,
    outcome: result.outcome,
    reason: result.reason,
    orderTotal: result.order?.total,
    toolCalls: result.steps.map((s) => ({ tool: s.tool, ok: s.result.ok, missing: s.result.missing, at: now })),
    synthetic: ctx.synthetic ?? false,
  };
}

/** Forget all agent sessions, carts and MCP sessions (demo reset). */
export function resetAgentCommerce() {
  resetAgentState();
  resetMcpSessions();
  resetA2aConversations();
}
