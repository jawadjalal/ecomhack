import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { githubAuthorizeUrl, githubOAuth, safeReturnPath, STATE_COOKIE } from "@/lib/auth/oauth";
import { publicOrigin } from "@/lib/github";

/** GET /api/auth/github/start?return=/onboarding → GitHub's sign-in page (state kept in an httpOnly cookie). */
export function GET(req: Request) {
  if (!githubOAuth()) return NextResponse.json({ error: "GitHub sign-in isn't configured on this server." }, { status: 503 });
  const origin = publicOrigin(req);
  const state = randomBytes(18).toString("base64url");
  const back = safeReturnPath(new URL(req.url).searchParams.get("return"));
  const res = NextResponse.redirect(githubAuthorizeUrl(origin, state));
  res.cookies.set(STATE_COOKIE, `${state}:${back}`, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/auth/github", maxAge: 600 });
  return res;
}
