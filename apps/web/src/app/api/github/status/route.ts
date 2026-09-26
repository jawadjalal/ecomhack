import { checkGithubStatus } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET /api/github/status → GithubStatusResponse (+ mode, connection, framework, recent PRs)
 * `configured`: GITHUB_TOKEN is set. `valid`: GitHub accepted it (GET /user, cached 5 min), with `login`;
 * otherwise `error` says why ("GitHub rejected the token (401)"). `dryRun` when no PRs will actually be opened.
 */
export async function GET() {
  return Response.json(await checkGithubStatus());
}
