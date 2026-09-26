import { z } from "zod";
import { githubTokenFor } from "@/lib/auth/oauth";
import { connectRepository, githubErrorStatus, publicOrigin } from "@/lib/github";
import { getPlan, trackingDoc, trackingSummary } from "@/lib/tracking";

/**
 * POST /api/onboarding/install { site } → PullRequestResult
 * Opens (or, without a token, previews) the install PR for the plan's repo: darwin.js plus the tracking
 * plan as DARWIN_TRACKING.md.
 */
export async function POST(req: Request) {
  const parsed = z.object({ site: z.string().regex(/^[\w.-]{1,64}$/) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be { site }" }, { status: 400 });
  const plan = getPlan(parsed.data.site);
  if (!plan?.repo) return Response.json({ error: "Make a plan first (POST /api/onboarding/plan)" }, { status: 404 });
  try {
    // The signed-in merchant's token (GitHub OAuth) when there is one, else the server's GITHUB_TOKEN.
    const pr = await connectRepository(plan.repo, { host: publicOrigin(req), tracking: { doc: trackingDoc(plan), summary: trackingSummary(plan) }, token: githubTokenFor(req) });
    return Response.json(pr);
  } catch (err) {
    const { status, error } = githubErrorStatus(err);
    return Response.json({ error }, { status });
  }
}
