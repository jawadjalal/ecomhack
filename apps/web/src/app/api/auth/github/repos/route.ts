import { githubTokenFor, listGithubRepos } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

/** GET /api/auth/github/repos → { repos } the signed-in merchant can install Darwin on. */
export async function GET(req: Request) {
  const token = githubTokenFor(req);
  if (!token) return Response.json({ error: "Sign in with GitHub first." }, { status: 401 });
  try {
    return Response.json({ repos: await listGithubRepos(token) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
