/**
 * Is Darwin's GitHub token actually accepted? A token being set says nothing: it may be revoked, expired
 * or mistyped. We ask GitHub (GET /user, 5 s timeout) and remember the answer per token (by hash, never
 * the token itself) for 5 minutes. A token GitHub answered 401 for is "known rejected": githubMode()
 * treats it as offline, so Darwin says "preview" up front instead of pretending it will open a PR.
 */
import { createHash } from "node:crypto";
import { GITHUB_API } from "./client";

export interface GithubTokenCheck {
  /** GitHub accepted the token. */
  valid: boolean;
  /** GitHub answered 401: revoked, expired or mistyped. Stays rejected until the token changes. */
  rejected: boolean;
  /** The account the token belongs to (GET /user). */
  login?: string;
  /** Why it isn't valid, in words ("GitHub rejected the token (401)"). */
  error?: string;
  /** When GitHub was asked (ms). */
  at: number;
}

export const TOKEN_CHECK_TTL_MS = 5 * 60_000;
/** An unanswered check (network, 5xx) is retried sooner. */
const UNKNOWN_TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;
export const REJECTED_ERROR = "GitHub rejected the token (401)";

const g = globalThis as unknown as { __darwinGithubTokenChecks?: Map<string, GithubTokenCheck> };
const checks = () => (g.__darwinGithubTokenChecks ??= new Map());
const keyOf = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

/** The token GitHub work uses: the signed-in merchant's, else GITHUB_TOKEN. */
export function effectiveToken(token?: string): string | undefined {
  return token?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;
}

/** What GitHub said about this token last time, whatever its age. */
export function lastTokenCheck(token?: string): GithubTokenCheck | undefined {
  const t = effectiveToken(token);
  return t ? checks().get(keyOf(t)) : undefined;
}

/** GitHub rejected this token (a 401 from the check or from any API call). */
export function isKnownRejected(token?: string): boolean {
  return lastTokenCheck(token)?.rejected === true;
}

/** Remember a 401 GitHub gave this token anywhere (e.g. while opening a PR). */
export function markTokenRejected(token?: string, now = Date.now()) {
  const t = effectiveToken(token);
  if (t) checks().set(keyOf(t), { valid: false, rejected: true, error: REJECTED_ERROR, at: now });
}

/** Ask GitHub whether the token works (GET /user), cached for 5 minutes per token. Undefined without a token. */
export async function verifyGithubToken(token?: string, opts: { force?: boolean; now?: number } = {}): Promise<GithubTokenCheck | undefined> {
  const t = effectiveToken(token);
  if (!t) return undefined;
  const now = opts.now ?? Date.now();
  const key = keyOf(t);
  const cached = checks().get(key);
  const ttl = cached && (cached.valid || cached.rejected) ? TOKEN_CHECK_TTL_MS : UNKNOWN_TTL_MS;
  if (cached && !opts.force && now - cached.at >= 0 && now - cached.at < ttl) return cached;

  let check: GithubTokenCheck;
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: { authorization: `Bearer ${t}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "darwin-storefront" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { login?: unknown };
      check = { valid: true, rejected: false, ...(typeof body.login === "string" ? { login: body.login } : {}), at: now };
    } else if (res.status === 401) {
      check = { valid: false, rejected: true, error: REJECTED_ERROR, at: now };
    } else if (res.status === 403 || res.status === 429) {
      // Not "bad credentials": GitHub knows the token but won't show the account (rate limit, or an app token).
      check = { valid: true, rejected: false, at: now };
    } else {
      check = { valid: false, rejected: false, error: `GitHub answered ${res.status} when checking the token`, at: now };
    }
  } catch (err) {
    const e = err as Error;
    const why = e?.name === "TimeoutError" || e?.name === "AbortError" ? "timed out" : e?.message || "network error";
    check = { valid: false, rejected: false, error: `Couldn't reach GitHub to check the token (${why.slice(0, 80)})`, at: now };
  }
  checks().set(key, check);
  if (checks().size > 100) checks().delete(checks().keys().next().value!);
  return check;
}

/** Tests. */
export function resetTokenChecks() {
  checks().clear();
}
