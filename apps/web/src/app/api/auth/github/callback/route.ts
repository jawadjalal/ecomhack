import { NextResponse } from "next/server";
import { exchangeGithubCode, githubSessionCookie, safeReturnPath, SESSION_COOKIE, sessionCookieOptions, STATE_COOKIE } from "@/lib/auth/oauth";
import { requestOrigin } from "@/lib/github";

/** GET /api/auth/github/callback?code&state — GitHub sends the merchant back here after they approve. */
export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];
  const [expected, ...rest] = decodeURIComponent(cookie ?? "").split(":");
  const back = safeReturnPath(rest.join(":"));
  const fail = (why: string) => {
    const res = NextResponse.redirect(`${origin}${back}${back.includes("?") ? "&" : "?"}github_error=${encodeURIComponent(why)}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "GitHub sign-in was cancelled.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return fail("Sign-in expired or didn't match. Try again.");
  try {
    const { token, identity } = await exchangeGithubCode(code, origin);
    const res = NextResponse.redirect(`${origin}${back}${back.includes("?") ? "&" : "?"}github=connected`);
    res.cookies.set(SESSION_COOKIE, githubSessionCookie(identity, token), sessionCookieOptions(origin.startsWith("https:")));
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    return fail((err as Error).message);
  }
}
