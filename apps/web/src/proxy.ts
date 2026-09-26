import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, adminToken, bearer, isAdminCredential, isProtectedPath, safeEqual } from "@/lib/auth/admin";

/** Cookie holding the visitor's stable distinct_id (shared with posthog-style analytics). */
const VISITOR_COOKIE = "darwin_id";

const LOGIN_HTML = (error?: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Darwin · sign in</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090d;color:#fff;font:15px/1.5 system-ui,sans-serif}
form{display:flex;flex-direction:column;gap:12px;width:min(360px,90vw)}input{height:44px;border-radius:12px;border:1px solid #ffffff22;background:#0000004d;color:#fff;padding:0 14px;font-size:15px}
button{height:44px;border:0;border-radius:12px;background:#b6f05a;color:#0b1200;font-weight:600;font-size:15px;cursor:pointer}p{margin:0;color:#ffffff99}.e{color:#ff9b9b}</style></head>
<body><form method="get" action="/console"><h1 style="margin:0 0 4px;font-size:22px">Darwin mission control</h1><p>Enter the admin key (DARWIN_ADMIN_TOKEN).</p>
${error ? `<p class="e">${error}</p>` : ""}<input name="key" type="password" autocomplete="current-password" autofocus required placeholder="Admin key"><button type="submit">Sign in</button></form></body></html>`;

function adminGate(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  const isConsole = pathname === "/console" || pathname.startsWith("/console/");

  // /console?key=… signs in: set the cookie and drop the key from the URL.
  const key = isConsole ? searchParams.get("key") : null;
  const token = adminToken();
  if (key !== null && token) {
    if (!safeEqual(key, token)) {
      return new NextResponse(LOGIN_HTML("That key didn't work."), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("key");
    const res = NextResponse.redirect(clean);
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  const credential = request.cookies.get(ADMIN_COOKIE)?.value ?? bearer(request.headers.get("authorization"));
  if (isAdminCredential(credential)) return null;

  if (!token) {
    const msg = "Mission control is locked on this deployment: set DARWIN_ADMIN_TOKEN.";
    return isConsole
      ? new NextResponse(LOGIN_HTML(msg), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })
      : NextResponse.json({ error: msg }, { status: 503 });
  }
  return isConsole
    ? new NextResponse(LOGIN_HTML(), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } })
    : NextResponse.json({ error: "Unauthorized: sign in at /console or send Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401 });
}

/**
 * 1. Mission control and state-changing APIs require the admin key (see lib/auth/admin.ts).
 * 2. Every storefront visitor gets a stable id before rendering, so server components can resolve
 *    their experiment variant on the very first request.
 */
export function proxy(request: NextRequest) {
  if (isProtectedPath(request.nextUrl.pathname)) return adminGate(request) ?? NextResponse.next();

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
  matcher: [
    "/store/:path*",
    "/store",
    "/console",
    "/console/:path*",
    "/api/loop/:path*",
    "/api/loop",
    "/api/github/:path*",
    "/api/whop/:path*",
    "/api/traffic",
    "/api/traffic/:path*",
    "/api/simulate",
    "/api/agent/shop",
    "/api/agent/sessions",
    "/api/experiments/:path*",
    "/api/experiments",
    "/api/analytics/:path*",
    // Not /api/web/runtime.js: that's public and shouldn't set cookies on merchants' visitors.
    "/api/web/rules/:path*",
    "/api/web/rules",
    "/api/web/draft",
    "/api/web/suggest",
    "/api/web/simulate",
    "/api/web/autopilot/:path*",
    "/api/web/autopilot",
    "/api/web/heatmap",
    "/api/onboarding/:path*",
    "/api/dashboards",
    // Not /a2a/* or /api/store-agent/demo-pay: buyer agents and the demo checkout are public.
    "/api/store-agent/stats",
    "/api/store-agent/buyer",
    "/api/store-agent/tests",
    // The merchant briefing (read by the team's chat bot with a bearer token) and its ship / stop action.
    "/api/briefing",
    "/api/briefing/:path*",
    "/api/ask",
    // The ⌘K / WebMCP command planner (lib/commands).
    "/api/command",
    // The Darwin control MCP server (headless commands for agents and the CLI).
    "/api/darwin/:path*",
  ],
};
