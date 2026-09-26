import { getGithubStatus } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET /api/github/status → GithubStatusResponse (+ mode, connection, framework, recent PRs)
 * `configured` is true when GITHUB_TOKEN is set; `dryRun` when no PRs will actually be opened.
 */
export function GET() {
  return Response.json(getGithubStatus());
}
