/**
 * A scripted buyer agent that shops by talking to the merchant agent over A2A (in process).
 * Used by the console's "send a shopper → Chat (A2A)" button. Like the tool-calling buyer, it walks
 * away when the merchant can't confirm what its brief needs (delivery by a date, free returns),
 * so its outcome depends on the live agent surface.
 */
import type { AgentSessionSummary, ShoppingGoal } from "@/lib/contracts";
import { a2aSend, type A2aCaller } from "./a2a";
import { getAgentSession } from "./state";

interface Offered {
  id: string;
  name: string;
  price: { amount: number };
  deliveryEtaDays?: number;
  returnPolicy?: { free: boolean };
}

export async function runA2aBuyer(goal: ShoppingGoal, caller: A2aCaller): Promise<AgentSessionSummary> {
  let reply = await a2aSend(goal.brief, caller);
  const contextId = reply.contextId;
  const say = async (text: string) => (reply = await a2aSend(text, caller, contextId));
  const done = () => getAgentSession(`a2a_${contextId}`)!;

  const options = (reply.data.products as Offered[] | undefined) ?? [];
  const pick = options[0];
  if (!pick) {
    await say("No thanks, nothing there fits my brief.");
    return done();
  }
  if (goal.deadlineDays !== undefined && pick.deliveryEtaDays === undefined) {
    await say(`No thanks: I need it within ${goal.deadlineDays} days and you can't confirm delivery times.`);
    return done();
  }
  if (goal.deadlineDays !== undefined && pick.deliveryEtaDays !== undefined && pick.deliveryEtaDays > goal.deadlineDays) {
    await say(`No thanks: ${pick.deliveryEtaDays} days is too slow, I need it within ${goal.deadlineDays}.`);
    return done();
  }
  if (goal.requiresFreeReturns && !pick.returnPolicy?.free) {
    await say("No thanks: I only buy with free returns and you can't confirm them.");
    return done();
  }

  if (goal.negotiates && /make me an offer/.test(reply.text)) {
    let offer = Math.floor((pick.price.amount * 0.85) / 100);
    for (let round = 0; round < 3; round++) {
      await say(`Would you take £${offer} for the ${pick.name}?`);
      const deal = reply.data.negotiation as { status?: string; counterOffer?: number } | undefined;
      if (!deal || deal.status !== "counter" || !deal.counterOffer) break;
      offer = Math.round((offer * 100 + deal.counterOffer) / 2 / 100);
    }
  }

  await say(`Great, I'll take the ${pick.name}${goal.size ? ` in UK ${goal.size}` : ""}. Please place the order.`);
  if (/Which size/.test(reply.text)) await say(`UK ${goal.size ?? "10"} please, go ahead.`);
  return done();
}
