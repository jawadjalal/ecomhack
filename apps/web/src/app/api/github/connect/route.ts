import { z } from "zod";
import { connectRepository, githubErrorStatus, publicOrigin } from "@/lib/github";

const Body = z.object({
  repoUrl: z.string().min(1).max(300),
  /** Base branch for the PR. Default: the repo's default branch. */
  base: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/github/connect { repoUrl } → PullRequestResult
 * Detects the storefront framework and opens (or, without a token, previews) the analytics install PR.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Body must be { "repoUrl": "https://github.com/owner/repo" }' }, { status: 400 });
  }
  try {
    // The script host is never taken from the request body: DARWIN_PUBLIC_URL, else this request's origin.
    const { repoUrl, base } = parsed.data;
    return Response.json(await connectRepository(repoUrl, { host: publicOrigin(req), base }));
  } catch (err) {
    const { status, error } = githubErrorStatus(err);
    return Response.json({ error }, { status });
  }
}
