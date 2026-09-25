import { z } from "zod";
import type { AgentShopResponse } from "@/lib/contracts";
import { parseGoalBrief, runBuyerAgent } from "@/lib/agent-commerce";
import { json, preflight } from "@/lib/agent-commerce/http";
import { id } from "@/lib/ids";
import { llmAvailable, llmModel } from "@/lib/llm/client";

const Body = z.object({
  brief: z.string().min(1).max(300).optional(),
  goal: z
    .object({
      brief: z.string().min(1).max(300),
      category: z.string().optional(),
      maxBudget: z.number().int().positive().optional(),
      size: z.string().optional(),
      deadlineDays: z.number().int().positive().optional(),
      requiresFreeReturns: z.boolean().optional(),
      negotiates: z.boolean().optional(),
    })
    .optional(),
  useLlm: z.boolean().optional(),
  agentName: z.string().min(1).max(64).optional(),
});

const DEFAULT_BRIEF = "Trail shoes, UK 10, under £140, delivered by Friday";

/**
 * POST /api/agent/shop { brief? | goal?, useLlm?, agentName? } → AgentShopResponse.
 * Sends one in-process buyer agent shopping (console "send a shopper" button). Marked synthetic.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { brief, goal: explicit, useLlm = false, agentName } = parsed.data;
  const goal = explicit ?? parseGoalBrief(brief ?? DEFAULT_BRIEF);
  const usingLlm = useLlm && llmAvailable();

  const session = await runBuyerAgent(
    goal,
    {
      agentId: id("agt"),
      agentName: agentName ?? (usingLlm ? `${llmModel()}-shopper` : "scripted-shopper"),
      sessionId: id("ses"),
      synthetic: true,
      persona: "console",
      channel: "in-process",
    },
    { useLlm: usingLlm },
  );
  const body: AgentShopResponse = { session };
  return json(body);
}

export const OPTIONS = preflight;
