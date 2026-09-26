/**
 * "Sign in with GitHub" for merchants (OAuth web flow), so onboarding reads *their* repos and opens the
 * install PR with *their* token, not the server's GITHUB_TOKEN.
 *
 *   /api/auth/github/start → github.com/login/oauth/authorize (state in an httpOnly cookie)
 *   /api/auth/github/callback → code exchanged for a token → sealed into the darwin_session cookie
 *
 * The session lives in the cookie itself, encrypted (AES-256-GCM) and httpOnly, so it works on any server
 * instance (Vercel runs several) and the browser can't read the token. The key comes from
 * DARWIN_SESSION_SECRET, else DARWIN_ADMIN_TOKEN, else GITHUB_OAUTH_CLIENT_SECRET (always set when sign-in is on).
 * Configure with GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET (a GitHub OAuth App whose callback
 * URL is <origin>/api/auth/github/callback).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
export const SESSION_COOKIE = "darwin_session";
export const STATE_COOKIE = "darwin_oauth_state";
const SESSION_DAYS = 30;

export interface GithubIdentity {
  login: string;
  name?: string;
  avatarUrl?: string;
}

interface StoredSession {
  createdAt: string;
  github?: GithubIdentity & { token: string };
}

export function githubOAuth(): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/* ------------------------------------------------------------------ encryption */

const g = globalThis as unknown as { __darwinSessionKey?: Buffer };
function key(): Buffer {
  const secret = process.env.DARWIN_SESSION_SECRET?.trim() || process.env.DARWIN_ADMIN_TOKEN?.trim() || process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (secret) return createHash("sha256").update(`darwin-session:${secret}`).digest();
  return (g.__darwinSessionKey ??= randomBytes(32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string): string | undefined {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ sessions (sealed in the cookie) */

function cookie(req: Request, name: string): string | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function load(req: Request): StoredSession | undefined {
  const sealed = cookie(req, SESSION_COOKIE);
  const plain = sealed && sealed.length < 4000 ? unseal(sealed) : undefined;
  if (!plain) return undefined;
  try {
    const s = JSON.parse(plain) as StoredSession;
    if (!s.createdAt || Date.now() - Date.parse(s.createdAt) > SESSION_DAYS * 86_400_000) return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Who's signed in (no tokens). */
export function sessionInfo(req: Request): { github?: GithubIdentity } {
  const s = load(req);
  return s?.github ? { github: { login: s.github.login, name: s.github.name, avatarUrl: s.github.avatarUrl } } : {};
}

/** The signed-in merchant's GitHub token, for GitHub API calls made on their behalf. */
export function githubTokenFor(req: Request): string | undefined {
  return load(req)?.github?.token;
}

/** The darwin_session cookie value for a GitHub sign-in: the identity and token, encrypted. */
export function githubSessionCookie(identity: GithubIdentity, token: string): string {
  const session: StoredSession = { createdAt: new Date().toISOString(), github: { login: identity.login, name: identity.name, avatarUrl: identity.avatarUrl, token } };
  return seal(JSON.stringify(session));
}

export const sessionCookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_DAYS * 86_400 });

/* ------------------------------------------------------------------ the GitHub OAuth web flow */

/** Only same-site paths ("/onboarding"), never "//evil.example" or absolute URLs. */
export function safeReturnPath(p: string | null | undefined): string {
  return p && /^\/(?!\/)[\w\-./?=&%]*$/.test(p) ? p : "/onboarding";
}

export function githubAuthorizeUrl(origin: string, state: string): string {
  const cfg = githubOAuth();
  if (!cfg) throw new Error("GitHub sign-in isn't configured: set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.");
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", `${origin}/api/auth/github/callback`);
  // repo: read the repository and open the install PR (private repos included).
  u.searchParams.set("scope", "repo read:user");
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

/** Code → token → who they are. Throws with a readable message on failure. */
export async function exchangeGithubCode(code: string, origin: string): Promise<{ token: string; identity: GithubIdentity }> {
  const cfg = githubOAuth();
  if (!cfg) throw new Error("GitHub sign-in isn't configured.");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: `${origin}/api/auth/github/callback` }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) throw new Error(json.error_description ?? json.error ?? `GitHub answered ${res.status}`);
  const me = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${json.access_token}`, accept: "application/vnd.github+json", "user-agent": "darwin" },
    signal: AbortSignal.timeout(10_000),
  });
  const user = (await me.json().catch(() => ({}))) as { login?: string; name?: string; avatar_url?: string };
  if (!user.login) throw new Error("GitHub didn't say who you are.");
  return { token: json.access_token, identity: { login: user.login, name: user.name ?? undefined, avatarUrl: user.avatar_url } };
}

export interface RepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  description?: string;
}

/** The signed-in merchant's repositories, most recently updated first. */
export async function listGithubRepos(token: string): Promise<RepoSummary[]> {
  const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=60&affiliation=owner,collaborator,organization_member", {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "darwin" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Your GitHub sign-in expired: sign in again." : `GitHub answered ${res.status}`);
  const repos = (await res.json()) as { full_name: string; private: boolean; default_branch: string; updated_at: string; description?: string | null }[];
  return repos.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, updatedAt: r.updated_at, description: r.description ?? undefined }));
}
