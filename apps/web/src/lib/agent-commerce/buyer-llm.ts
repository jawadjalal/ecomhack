/**
 * LLM-driven buyer agent: the model picks the next tool call each step (JSON via generateJson + zod).
 * Shared by runBuyerAgent (in-process) and scripts/grok-shopper.ts (over MCP HTTP).
 * Throws on any LLM failure so callers can fall back to the scripted policy.
 */
import { z } from "zod";
import type { ShoppingGoal } from "@/lib/contracts";
import { generateJson } from "@/lib/llm/client";
import { formatGBP } from "@/lib/money";
import { deadlineLabel, sizeLabel, type BuyerHooks, type BuyerRunResult, type BuyerStep } from "./buyer";
import { toolInputSchema, TOOL_META } from "./tools";
import { AGENT_TOOL_NAMES, type AgentOrder, type AgentToolName, type ToolCaller } from "./types";

export const MAX_LLM_STEPS = 8;
/** Per-decision timeout; on expiry the caller falls back to the scripted policy. */
const DECISION_TIMEOUT_MS = 25_000;

export const BuyerActionSchema = z.object({
  thought: z.string().max(600).optional(),
  tool: z.enum(AGENT_TOOL_NAMES as [AgentToolName, ...AgentToolName[]]),
  args: z.record(z.string(), z.unknown()).optional(),
});
export type BuyerAction = z.infer<typeof BuyerActionSchema>;

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Tool descriptors for in-process runs (MCP clients get the same from tools/list). */
export function localToolDescriptors(): ToolDescriptor[] {
  return AGENT_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_META[name].description,
    inputSchema: toolInputSchema(name),
  }));
}

/** Default system prompt (the PACE demo store). Pass `system` to runLlmBuyer for other stores. */
export const DEFAULT_BUYER_SYSTEM = buyerSystemPrompt("PACE, an online running store");

/** The buyer system prompt for any store ("Acme, an online homeware store"). */
export function buyerSystemPrompt(store: string): string {
  return `You are a buyer agent shopping on behalf of a human principal at ${store}.
You act only through the store's tools. Each turn, choose exactly one tool call.

Rules:
- All money is integer pence (14000 = £140.00).
- Always pass "want" to search_products/get_product with the fields your goal needs:
  sizes (if a size is required), deliveryEtaDays (if there is a deadline), returnPolicy (if free returns are required), landedPrice (if there is a budget).
- Tool results may list "missing" fields the store refuses to expose. Decide whether you can still buy responsibly.
  If a hard requirement (deadline, free returns, budget) cannot be verified, it is acceptable to abandon.
- Never exceed the budget. When calling checkout, pass maxTotal = the budget.
- If negotiate is available and the goal allows it, you may negotiate (at most 3 offers).
- Finish by calling checkout (success) or abandon with a short, specific reason
  (e.g. "no delivery ETA exposed — can't guarantee delivery by Friday").

Respond with JSON: {"thought": "<one sentence>", "tool": "<tool name>", "args": { ... }}`;
}

export function goalText(goal: ShoppingGoal): string {
  const lines = [`Brief: ${goal.brief}`];
  if (goal.category) lines.push(`Category: ${goal.category}`);
  if (goal.size) lines.push(`Size: ${sizeLabel(goal.size)} (pass size "${goal.size}")`);
  if (goal.maxBudget !== undefined) lines.push(`Budget: ${goal.maxBudget} pence (${formatGBP(goal.maxBudget)}) incl. shipping`);
  if (goal.deadlineDays !== undefined) lines.push(`Deadline: delivered ${deadlineLabel(goal)} (≤ ${goal.deadlineDays} days)`);
  if (goal.requiresFreeReturns) lines.push("Requires free returns.");
  if (goal.negotiates) lines.push("Principal is happy for you to negotiate.");
  return lines.join("\n");
}

function compact(value: unknown, max = 2400): string {
  const text = JSON.stringify(value, (k, v) => (k === "url" || k === "attributes" ? undefined : v));
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text;
}

export function buyerPrompt(goal: ShoppingGoal, tools: ToolDescriptor[], history: BuyerStep[], stepsLeft: number): string {
  const toolText = tools
    .map((t) => `- ${t.name}: ${t.description ?? ""}\n  args schema: ${JSON.stringify(t.inputSchema ?? {})}`)
    .join("\n");
  const historyText = history.length
    ? history.map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.args)}) → ${compact(s.result)}`).join("\n")
    : "(nothing yet)";
  return `GOAL\n${goalText(goal)}\n\nTOOLS\n${toolText}\n\nHISTORY\n${historyText}\n\nYou have ${stepsLeft} step(s) left. Choose the next tool call.`;
}

/** Ask the LLM for the next action. Throws when no provider is configured or output never validates. */
export async function decideNextAction(
  goal: ShoppingGoal,
  tools: ToolDescriptor[],
  history: BuyerStep[],
  stepsLeft: number,
  system: string = DEFAULT_BUYER_SYSTEM,
): Promise<BuyerAction> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      generateJson({ system, prompt: buyerPrompt(goal, tools, history, stepsLeft), schema: BuyerActionSchema, maxTokens: 800 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LLM decision timed out after ${DECISION_TIMEOUT_MS / 1000}s`)), DECISION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LLM policy loop, capped at `maxSteps` tool calls (plus a closing abandon if it runs out).
 * Guard rails: checkout always carries maxTotal = budget.
 */
export async function runLlmBuyer(
  goal: ShoppingGoal,
  call: ToolCaller,
  opts: {
    tools?: ToolDescriptor[];
    maxSteps?: number;
    decide?: typeof decideNextAction;
    /** System prompt override (default: DEFAULT_BUYER_SYSTEM, the PACE store). See buyerSystemPrompt(). */
    system?: string;
  } & BuyerHooks = {},
): Promise<BuyerRunResult> {
  const tools = opts.tools ?? localToolDescriptors();
  const maxSteps = opts.maxSteps ?? MAX_LLM_STEPS;
  const decide = opts.decide ?? decideNextAction;
  const steps: BuyerStep[] = [];
  const invoke = async (tool: AgentToolName, args: Record<string, unknown>) => {
    const result = await call(tool, args);
    const step = { tool, args, result };
    steps.push(step);
    opts.onStep?.(step);
    return result;
  };

  for (let i = 0; i < maxSteps; i++) {
    const action = await decide(goal, tools, steps, maxSteps - i, opts.system ?? DEFAULT_BUYER_SYSTEM);
    if (action.thought) opts.onThought?.(action.thought);
    const args: Record<string, unknown> = { ...(action.args ?? {}) };
    if (action.tool === "checkout" && goal.maxBudget !== undefined && args.maxTotal === undefined) args.maxTotal = goal.maxBudget;
    if (action.tool === "abandon" && typeof args.reason !== "string") args.reason = action.thought ?? "no reason given";
    const result = await invoke(action.tool, args);
    if (action.tool === "checkout" && result.ok) {
      return { outcome: "purchased", order: result.data as AgentOrder, steps, policy: "llm" };
    }
    if (action.tool === "abandon" && result.ok) {
      return { outcome: "abandoned", reason: String(args.reason), steps, policy: "llm" };
    }
  }
  const reason = `gave up after ${maxSteps} steps without a suitable product`;
  opts.onThought?.(reason);
  await invoke("abandon", { reason });
  return { outcome: "abandoned", reason, steps, policy: "llm" };
}
