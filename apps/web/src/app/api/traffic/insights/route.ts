import { z } from "zod";
import { eventStore } from "@/lib/analytics/store";
import { heuristicInsights, llmInsights, sharedTrafficReport } from "@/lib/traffic";

const Body = z.object({
  site: z.string().max(100).default("all"),
  synthetic: z.boolean().default(true),
  /** Ask the LLM (Grok / Claude). false = built-in rules only (free, instant). */
  llm: z.boolean().default(false),
});

/**
 * POST /api/traffic/insights { site?, synthetic?, llm? } → InsightsResponse
 * SEO, conversion and AI-agent suggestions from the traffic report. Admin only.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { site, synthetic, llm } = parsed.data;
  const report = await sharedTrafficReport(eventStore().all(), { site, includeSynthetic: synthetic });
  if (llm) return Response.json(await llmInsights(report));
  return Response.json({ insights: heuristicInsights(report), source: "heuristic", author: "heuristic", generatedAt: new Date().toISOString() });
}
