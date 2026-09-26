import { githubOAuth, sessionInfo } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

/** GET /api/auth/session → { providers: { github }, github?: { login, name, avatarUrl } } (never tokens). */
export function GET(req: Request) {
  return Response.json({ providers: { github: !!githubOAuth() }, ...sessionInfo(req) }, { headers: { "Cache-Control": "no-store" } });
}
