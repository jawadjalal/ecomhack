/**
 * Admin gate for mission control and the endpoints that change state or spend the server's credentials
 * (the loop, GitHub PRs, the simulator, LLM shoppers, raw analytics).
 *
 * - Optional. Set DARWIN_ADMIN_TOKEN to lock mission control. Sign in once with /console?key=<token> (sets an
 *   httpOnly cookie), or send `Authorization: Bearer <token>` from scripts.
 * - Without a token the gate is open everywhere, Vercel included (the demo deploy is public on purpose).
 *   DARWIN_REQUIRE_ADMIN=1 locks it instead: protected routes answer 503 until a token is configured.
 *
 * Web-standard APIs only: this runs in the proxy as well as in server components.
 */

export const ADMIN_COOKIE = "darwin_admin";

/** Paths only mission control may use. Everything else (store, agent tools, MCP, A2A, ingest) stays public. */
export const PROTECTED_PREFIXES = [
  "/console",
  "/api/loop",
  "/api/github",
  "/api/whop",
  "/api/traffic",
  "/api/simulate",
  "/api/agent/shop",
  "/api/agent/sessions",
  "/api/experiments",
  "/api/analytics",
  "/api/web",
  "/api/onboarding",
  "/api/dashboards",
  "/api/store-agent/stats",
  "/api/store-agent/buyer",
  "/api/assistant",
  "/api/research",
] as const;

/** Public paths under a protected prefix: merchant runtimes + inbound Whop webhooks. */
export const PUBLIC_EXCEPTIONS = ["/api/web/runtime.js", "/api/whop/webhook"] as const;

export function isProtectedPath(pathname: string): boolean {
  if ((PUBLIC_EXCEPTIONS as readonly string[]).includes(pathname)) return false;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function adminToken(): string | undefined {
  return process.env.DARWIN_ADMIN_TOKEN?.trim() || undefined;
}

/** True when no token is configured and nobody asked for a locked deploy. */
export function gateOpenWithoutToken(): boolean {
  return process.env.DARWIN_REQUIRE_ADMIN !== "1";
}

/** Constant-time string comparison (no early exit on the first differing character). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Does this credential (cookie value or bearer token) grant admin? */
export function isAdminCredential(value: string | undefined | null): boolean {
  const token = adminToken();
  if (!token) return gateOpenWithoutToken();
  return typeof value === "string" && value.length > 0 && safeEqual(value, token);
}

export function bearer(authorization: string | null): string | undefined {
  const m = authorization?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}
