/**
 * A buyer agent that shops by talking to the merchant agent over A2A (in process, same path as
 * POST /api/a2a). Used by the console's "send a shopper → Chat (A2A)" button.
 *
 * The first message is always the principal's brief. After that, an LLM (Grok / Claude / OpenRouter)
 * writes each reply when one is configured, so two AI agents negotiate in plain English. Without one,
 * or if the model fails mid-conversation, a scripted policy takes over. Either way the buyer walks
 * away when the merchant can't confirm what the brief needs (delivery by a date, free returns), so
 * the outcome depends on what Darwin has shipped to the agent surface.
 */
import { z } from "zod";
import type { AgentSessionSummary, ShoppingGoal } from "@/lib/contracts";
import { generateJson } from "@/lib/llm/client";
import { a2aSend, type A2aCaller } from "./a2a";
import { goalText } from "./buyer-llm";
import { getAgentSession } from "./state";

export const MAX_CHAT_TURNS = 8;
const TURN_TIMEOUT_MS = 20_000;

interface Offered {
  id: string;
  name: string;
  price: { amount: number };
  deliveryEtaDays?: number;
  returnPolicy?: { free: boolean };
}

export interface ChatLine {
  from: "buyer" | "merchant";
  text: string;
}

/** What the buyer knows after the merchant's last reply. */
export interface ChatState {
  goal: ShoppingGoal;
  transcript: ChatLine[];
  last: { text: string; data: Record<string, unknown> };
  pick?: Offered;
  offers: number;
  /** Times we asked to buy; a second ask means the first one failed. */
  buys: number;
}

/* ------------------------------------------------------------------ scripted policy */

function buyLine(state: ChatState, pick: Offered) {
  // Already asked once and the merchant couldn't complete it (over budget, sold out…): leave, citing why.
  if (state.buys++ > 0) return `No thanks: ${state.last.text.split(/(?<=[.!?])\s/)[0]}`;
  return `Great, I'll take the ${pick.name}${state.goal.size ? ` in UK ${state.goal.size}` : ""}. Please place the order.`;
}

export function scriptedTurn(state: ChatState): string {
  const { goal, last } = state;
  if (/Which size/.test(last.text)) return `UK ${goal.size ?? "10"} please, go ahead.`;

  const deal = last.data.negotiation as { status?: string; counterOffer?: number } | undefined;
  if (deal && state.pick) {
    if (deal.status === "counter" && deal.counterOffer && state.offers < 3) {
      const mine = Math.floor((state.pick.price.amount * 0.85) / 100) * 100;
      state.offers++;
      return `How about £${Math.round((mine + deal.counterOffer) / 2 / 100)}?`;
    }
    return buyLine(state, state.pick);
  }

  if (!state.pick) {
    const pick = ((last.data.products as Offered[] | undefined) ?? [])[0];
    if (!pick) return "No thanks, nothing there fits my brief.";
    state.pick = pick;
    if (goal.deadlineDays !== undefined && pick.deliveryEtaDays === undefined) {
      return `No thanks: I need it within ${goal.deadlineDays} days and you can't confirm delivery times.`;
    }
    if (goal.deadlineDays !== undefined && pick.deliveryEtaDays !== undefined && pick.deliveryEtaDays > goal.deadlineDays) {
      return `No thanks: ${pick.deliveryEtaDays} days is too slow, I need it within ${goal.deadlineDays}.`;
    }
    if (goal.requiresFreeReturns && !pick.returnPolicy?.free) return "No thanks: I only buy with free returns and you can't confirm them.";
    if (goal.negotiates && /make me an offer/.test(last.text)) {
      state.offers++;
      return `Would you take £${Math.floor((pick.price.amount * 0.85) / 100)} for the ${pick.name}?`;
    }
  }
  return state.pick ? buyLine(state, state.pick) : "No thanks.";
}

/* ------------------------------------------------------------------ LLM policy */

export const ChatTurnSchema = z.object({
  thought: z.string().max(400).optional(),
  message: z.string().min(1).max(400),
});

const CHAT_SYSTEM = `You are a buyer agent shopping for a human principal. You are talking to the merchant agent of PACE, an online running store, in short plain-English messages (A2A).

- The merchant replies with shortlists, product details, counter-offers or an order confirmation.
- You can ask about a product ("when would the second one arrive?"), make an offer ("would you take £120?") but only if the merchant invited offers, order ("buy the first one in UK 10"), or leave ("No thanks: <specific reason>").
- Hard requirements from the brief (deadline, free returns, budget including delivery) must be confirmed by the merchant before you buy. If the merchant says it can't share something you need, leave and say exactly why.
- Never agree to pay more than the budget. Keep each message under 25 words.

Respond with JSON: {"thought": "<one sentence>", "message": "<what you say to the merchant>"}`;

export async function llmTurn(state: ChatState, turnsLeft: number): Promise<string> {
  const transcript = state.transcript.map((l) => `${l.from === "buyer" ? "YOU" : "MERCHANT"}: ${l.text}`).join("\n");
  const prompt = `GOAL\n${goalText(state.goal)}\n\nCONVERSATION\n${transcript}\n\nYou have ${turnsLeft} message(s) left. Write your next message.`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const turn = await Promise.race([
      generateJson({ system: CHAT_SYSTEM, prompt, schema: ChatTurnSchema, maxTokens: 300 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LLM turn timed out after ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS);
      }),
    ]);
    return turn.message.trim();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ the conversation */

export async function runA2aBuyer(
  goal: ShoppingGoal,
  caller: A2aCaller,
  opts: { useLlm?: boolean; nextTurn?: (state: ChatState, turnsLeft: number) => Promise<string> } = {},
): Promise<AgentSessionSummary> {
  let reply = await a2aSend(goal.brief, caller);
  const contextId = reply.contextId;
  const session = () => getAgentSession(`a2a_${contextId}`)!;
  const state: ChatState = { goal, transcript: [{ from: "buyer", text: goal.brief }, { from: "merchant", text: reply.text }], last: reply, offers: 0, buys: 0 };
  let llm = opts.nextTurn ?? (opts.useLlm ? llmTurn : undefined);

  for (let turn = 1; turn < MAX_CHAT_TURNS && session().outcome === "in_progress"; turn++) {
    let message: string;
    try {
      message = llm ? await llm(state, MAX_CHAT_TURNS - turn) : scriptedTurn(state);
    } catch (err) {
      console.warn("[a2a-buyer] LLM turn failed, continuing with the scripted policy:", String((err as Error).message ?? err).slice(0, 200));
      llm = undefined;
      message = scriptedTurn(state);
    }
    reply = await a2aSend(message, caller, contextId);
    state.last = reply;
    state.transcript.push({ from: "buyer", text: message }, { from: "merchant", text: reply.text });
  }
  if (session().outcome === "in_progress") await a2aSend("No thanks, I'll leave it there.", caller, contextId);
  return session();
}
