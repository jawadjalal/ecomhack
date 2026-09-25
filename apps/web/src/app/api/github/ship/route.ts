import { z } from "zod";
import type { ChangeProposal, Insight, LoopState } from "@/lib/contracts";
import { getExperiment } from "@/lib/experiments/store";
import { githubErrorStatus, latestShippableExperiment, shipWinningSpec } from "@/lib/github";
import { getLoopState } from "@/lib/optimizer";

const Body = z.object({
  experimentId: z.string().min(1).max(100).optional(),
  /** Optional plain-language summary for the PR. Default: generated from the experiment. */
  summary: z.string().max(4000).optional(),
});

function isProposal(v: unknown): v is ChangeProposal {
  return !!v && typeof v === "object" && "id" in v && "hypothesis" in v && "patch" in v;
}

/** Proposal, insights and generation for an experiment, from the optimizer's public loop state. */
async function loopContext(experimentId?: string, proposalId?: string) {
  try {
    const loop: LoopState = await Promise.resolve(getLoopState());
    const proposal = [loop.proposal, ...loop.log.map((l) => l.data)].find(
      (p): p is ChangeProposal => isProposal(p) && p.id === proposalId,
    );
    const insights: Insight[] = proposal ? loop.insights.filter((i) => proposal.insightIds.includes(i.id)) : [];
    const generation = loop.history.find((h) => h.experimentId === experimentId)?.generation;
    return { proposal, insights, generation };
  } catch {
    return {};
  }
}

/**
 * POST /api/github/ship { experimentId? } → PullRequestResult
 * Opens the "ship the winner" PR editing storefront.config.json for the given experiment
 * (default: the latest completed one) against the connected repo / DARWIN_TARGET_REPO.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let input: unknown = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: "Body must be JSON: { experimentId? }" }, { status: 400 });
  }
  const parsed = Body.safeParse(input);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  try {
    const { experimentId, summary } = parsed.data;
    const experiment = experimentId ? getExperiment(experimentId) : latestShippableExperiment();
    const ctx = experiment ? await loopContext(experiment.id, experiment.proposalId) : {};
    const result = await shipWinningSpec({ experimentId: experiment?.id ?? experimentId, summary, ...ctx });
    return Response.json(result);
  } catch (err) {
    const { status, error } = githubErrorStatus(err);
    return Response.json({ error }, { status });
  }
}
