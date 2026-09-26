import { NextResponse, type NextRequest } from "next/server";

/** Cookie holding the visitor's stable distinct_id (shared with posthog-style analytics). */
const VISITOR_COOKIE = "darwin_id";

/**
 * Give every storefront visitor a stable id before rendering, so server components can
 * resolve their experiment variant on the very first request.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.get(VISITOR_COOKIE)) return NextResponse.next();

  const id = `v_${crypto.randomUUID()}`;
  const headers = new Headers(request.headers);
  const cookie = headers.get("cookie");
  headers.set("cookie", `${cookie ? `${cookie}; ` : ""}${VISITOR_COOKIE}=${id}`);

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(VISITOR_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

export const config = {
  matcher: ["/store/:path*", "/store"],
};
