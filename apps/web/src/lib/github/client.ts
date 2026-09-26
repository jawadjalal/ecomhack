/**
 * Minimal typed GitHub REST client over `fetch` (no Octokit).
 *
 * Covers exactly what Darwin needs to open PRs against a merchant repo:
 * repo metadata, recursive trees, file contents, branches, multi-file commits via the
 * Git Data API (blobs → tree → commit → ref), pull requests and labels.
 */

export const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

/* ------------------------------------------------------------------ repo URLs */

export interface RepoCoordinates {
  owner: string;
  repo: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parse the ways people paste a GitHub repo:
 * `https://github.com/o/r`, `github.com/o/r/tree/main`, `o/r`, `git@github.com:o/r.git`,
 * `ssh://git@github.com/o/r.git`. Returns null for anything else.
 */
export function parseRepoUrl(input: string): RepoCoordinates | null {
  const s = input.trim();
  if (!s) return null;

  let segments: string[];
  let strict = false; // bare "owner/repo" must be exactly two segments
  const scp = s.match(/^(?:[\w.-]+@)?github\.com:(.+)$/i);
  if (scp) {
    segments = scp[1].split("/");
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    segments = url.pathname.split("/");
  } else if (/^(www\.)?github\.com\//i.test(s)) {
    segments = s.replace(/^(www\.)?github\.com\//i, "").split(/[?#]/)[0].split("/");
  } else {
    segments = s.split(/[?#]/)[0].split("/");
    strict = true;
  }

  segments = segments.filter(Boolean);
  if (segments.length < 2 || (strict && segments.length !== 2)) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

/* ------------------------------------------------------------------ errors */

export class GitHubError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly rateLimited: boolean;
  /** When the rate limit resets (ISO), if GitHub told us. */
  readonly resetAt?: string;
  readonly documentationUrl?: string;

  constructor(
    message: string,
    init: { status: number; method: string; path: string; rateLimited?: boolean; resetAt?: string; documentationUrl?: string },
  ) {
    super(message);
    this.name = "GitHubError";
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.rateLimited = init.rateLimited ?? false;
    this.resetAt = init.resetAt;
    this.documentationUrl = init.documentationUrl;
  }
}

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
  errors?: ({ message?: string; code?: string; field?: string } | string)[];
}

async function toGitHubError(res: Response, method: string, path: string): Promise<GitHubError> {
  let data: GitHubErrorBody = {};
  try {
    data = (await res.json()) as GitHubErrorBody;
  } catch {
    /* non-JSON error body */
  }
  const where = `${method} ${path}`;
  const detail = data.message ?? res.statusText ?? "unknown error";
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const retryAfter = res.headers.get("retry-after");
  const rateLimited =
    (res.status === 403 || res.status === 429) && (remaining === "0" || retryAfter !== null || /rate limit/i.test(detail));
  const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : undefined;

  let message: string;
  if (rateLimited) {
    const when = retryAfter
      ? `retry after ${retryAfter}s`
      : resetAt
        ? `resets at ${resetAt.slice(11, 19)} UTC`
        : "try again shortly";
    message = `GitHub API rate limit exceeded on ${where} (${when}).`;
  } else if (res.status === 401) {
    message = `GitHub rejected the token on ${where} (401 ${detail}). Check GITHUB_TOKEN.`;
  } else if (res.status === 403) {
    message = `GitHub denied ${where} (403: ${detail}). The token needs "Contents" and "Pull requests" read/write access to this repo.`;
  } else if (res.status === 404) {
    message = `GitHub returned 404 for ${where}. The repository or ref may not exist, or GITHUB_TOKEN cannot access it.`;
  } else if (res.status === 422) {
    const errs = (data.errors ?? [])
      .map((e) => (typeof e === "string" ? e : (e.message ?? [e.field, e.code].filter(Boolean).join(" "))))
      .filter(Boolean);
    message = `GitHub rejected ${where} (422: ${detail}${errs.length ? ` — ${errs.join("; ")}` : ""}).`;
  } else {
    message = `GitHub API error ${res.status} on ${where}: ${detail}`;
  }
  return new GitHubError(message, {
    status: res.status,
    method,
    path,
    rateLimited,
    resetAt,
    documentationUrl: data.documentation_url,
  });
}

/* ------------------------------------------------------------------ response shapes */

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface RepoTree {
  sha: string;
  truncated: boolean;
  entries: TreeEntry[];
}

export interface FileContent {
  path: string;
  sha: string;
  content: string;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  head: string;
  base: string;
  state: string;
}

export interface FileChange {
  path: string;
  content: string;
}

interface RawPull {
  number: number;
  html_url: string;
  title: string;
  state: string;
  head: { ref: string };
  base: { ref: string };
}

interface RawPullDetail {
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  draft?: boolean;
  head: { ref: string; sha?: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
}

export interface PullRequestDetail extends PullRequestInfo {
  merged: boolean;
  /** null while GitHub is still computing it. */
  mergeable: boolean | null;
  mergeableState?: string;
  draft: boolean;
  headSha?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

const toPull = (p: RawPull): PullRequestInfo => ({
  number: p.number,
  url: p.html_url,
  title: p.title,
  head: p.head.ref,
  base: p.base.ref,
  state: p.state,
});

/* ------------------------------------------------------------------ client */

export interface GitHubClientOptions {
  token?: string;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Refuse every non-GET call. Used for DARWIN_GITHUB_DRY_RUN=1 so dry runs can never write. */
  readOnly?: boolean;
}

/** Encode a path for use in a URL, keeping `/` separators. */
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export class GitHubClient {
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  readonly readOnly: boolean;

  constructor(opts: GitHubClientOptions = {}) {
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = (opts.baseUrl ?? GITHUB_API).replace(/\/+$/, "");
    this.readOnly = opts.readOnly ?? false;
  }

  /** Low-level request. Throws GitHubError on non-2xx (except 404 when `allow404`, which returns null). */
  async request<T>(method: string, path: string, body?: unknown, opts: { allow404?: boolean } = {}): Promise<T> {
    if (this.readOnly && method !== "GET") {
      throw new GitHubError(`Dry run: refusing to ${method} ${path}.`, { status: 0, method, path });
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "darwin-storefront",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (err) {
      throw new GitHubError(`Could not reach GitHub for ${method} ${path}: ${(err as Error).message}`, {
        status: 0,
        method,
        path,
      });
    }
    if (res.status === 404 && opts.allow404) return null as T;
    if (!res.ok) throw await toGitHubError(res, method, path);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private repoPath(owner: string, repo: string) {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const r = await this.request<{ full_name: string; default_branch: string; html_url: string; private: boolean }>(
      "GET",
      this.repoPath(owner, repo),
    );
    return { fullName: r.full_name, defaultBranch: r.default_branch, htmlUrl: r.html_url, private: r.private };
  }

  /** Commit sha a branch points at, or null if the branch does not exist. */
  async getBranchSha(owner: string, repo: string, branch: string): Promise<string | null> {
    const ref = await this.request<{ object: { sha: string } } | null>(
      "GET",
      `${this.repoPath(owner, repo)}/git/ref/heads/${encodePath(branch)}`,
      undefined,
      { allow404: true },
    );
    return ref?.object.sha ?? null;
  }

  /** Full file listing at a commit/tree sha or branch name. */
  async getTree(owner: string, repo: string, treeish: string, opts: { recursive?: boolean } = { recursive: true }): Promise<RepoTree> {
    const q = opts.recursive === false ? "" : "?recursive=1";
    const t = await this.request<{ sha: string; truncated: boolean; tree: TreeEntry[] }>(
      "GET",
      `${this.repoPath(owner, repo)}/git/trees/${encodePath(treeish)}${q}`,
    );
    return { sha: t.sha, truncated: t.truncated, entries: t.tree };
  }

  /** Decoded UTF-8 file content at a ref, or null if the file does not exist. */
  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<FileContent | null> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const f = await this.request<{ type: string; path: string; sha: string; content?: string; encoding?: string } | null>(
      "GET",
      `${this.repoPath(owner, repo)}/contents/${encodePath(path)}${q}`,
      undefined,
      { allow404: true },
    );
    if (!f || Array.isArray(f) || f.type !== "file") return null;
    if (f.encoding === "base64" && typeof f.content === "string") {
      return { path: f.path, sha: f.sha, content: Buffer.from(f.content, "base64").toString("utf8") };
    }
    // Files > 1 MB come back without inline content: fetch the blob.
    const blob = await this.request<{ content: string; encoding: string }>("GET", `${this.repoPath(owner, repo)}/git/blobs/${f.sha}`);
    const content = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
    return { path: f.path, sha: f.sha, content };
  }

  async createBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request("POST", `${this.repoPath(owner, repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  async updateBranch(owner: string, repo: string, branch: string, sha: string, force = false): Promise<void> {
    await this.request("PATCH", `${this.repoPath(owner, repo)}/git/refs/heads/${encodePath(branch)}`, { sha, force });
  }

  /**
   * Make `branch` exist. With `resetTo`, an existing branch is force-moved to that sha
   * (only used for Darwin-owned `darwin/*` branches with no open PR).
   */
  async ensureBranch(owner: string, repo: string, branch: string, baseSha: string, opts: { reset?: boolean } = {}) {
    const current = await this.getBranchSha(owner, repo, branch);
    if (!current) {
      await this.createBranch(owner, repo, branch, baseSha);
      return { created: true, sha: baseSha };
    }
    if (opts.reset && current !== baseSha) {
      await this.updateBranch(owner, repo, branch, baseSha, true);
      return { created: false, sha: baseSha };
    }
    return { created: false, sha: current };
  }

  /**
   * Commit several files to a branch in one commit via the Git Data API:
   * blobs → tree (on top of the parent's tree) → commit → fast-forward the ref.
   * Returns the new commit sha.
   */
  async commitFiles(
    owner: string,
    repo: string,
    opts: { branch: string; message: string; files: FileChange[]; parentSha?: string },
  ): Promise<string> {
    const base = this.repoPath(owner, repo);
    const parent = opts.parentSha ?? (await this.getBranchSha(owner, repo, opts.branch));
    if (!parent) throw new GitHubError(`Branch ${opts.branch} does not exist.`, { status: 404, method: "GET", path: opts.branch });
    const parentCommit = await this.request<{ tree: { sha: string } }>("GET", `${base}/git/commits/${parent}`);

    const blobShas: string[] = [];
    for (const file of opts.files) {
      const blob = await this.request<{ sha: string }>("POST", `${base}/git/blobs`, { content: file.content, encoding: "utf-8" });
      blobShas.push(blob.sha);
    }
    const tree = await this.request<{ sha: string }>("POST", `${base}/git/trees`, {
      base_tree: parentCommit.tree.sha,
      tree: opts.files.map((f, i) => ({ path: f.path, mode: "100644", type: "blob", sha: blobShas[i] })),
    });
    const commit = await this.request<{ sha: string }>("POST", `${base}/git/commits`, {
      message: opts.message,
      tree: tree.sha,
      parents: [parent],
    });
    await this.updateBranch(owner, repo, opts.branch, commit.sha, false);
    return commit.sha;
  }

  /** The open PR from `branch` (same repo), if any. Used to stay idempotent. */
  async findOpenPullRequest(owner: string, repo: string, branch: string): Promise<PullRequestInfo | null> {
    const q = `?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=5`;
    const pulls = await this.request<RawPull[]>("GET", `${this.repoPath(owner, repo)}/pulls${q}`);
    const hit = pulls.find((p) => p.head.ref === branch) ?? pulls[0];
    return hit ? toPull(hit) : null;
  }

  async createPullRequest(
    owner: string,
    repo: string,
    pr: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<PullRequestInfo> {
    const p = await this.request<RawPull>("POST", `${this.repoPath(owner, repo)}/pulls`, {
      ...pr,
      maintainer_can_modify: true,
    });
    return toPull(p);
  }

  async updatePullRequest(owner: string, repo: string, number: number, patch: { title?: string; body?: string }): Promise<PullRequestInfo> {
    const p = await this.request<RawPull>("PATCH", `${this.repoPath(owner, repo)}/pulls/${number}`, patch);
    return toPull(p);
  }

  /** One pull request with merge state, or null if it doesn't exist. */
  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestDetail | null> {
    const p = await this.request<(RawPull & RawPullDetail) | null>("GET", `${this.repoPath(owner, repo)}/pulls/${number}`, undefined, {
      allow404: true,
    });
    if (!p) return null;
    return {
      ...toPull(p),
      merged: Boolean(p.merged),
      mergeable: p.mergeable ?? null,
      mergeableState: p.mergeable_state,
      draft: Boolean(p.draft),
      headSha: p.head.sha,
      additions: p.additions,
      deletions: p.deletions,
      changedFiles: p.changed_files,
    };
  }

  /** Combined commit status + check runs summary for a ref ("success" | "failure" | "pending" | "none"). */
  async getChecksState(owner: string, repo: string, ref: string): Promise<{ state: string; total: number; failing: string[] }> {
    const base = this.repoPath(owner, repo);
    const status = await this.request<{ state: string; statuses: { context: string; state: string }[] } | null>(
      "GET",
      `${base}/commits/${encodeURIComponent(ref)}/status`,
      undefined,
      { allow404: true },
    );
    const runs = await this.request<{ check_runs: { name: string; status: string; conclusion: string | null }[] } | null>(
      "GET",
      `${base}/commits/${encodeURIComponent(ref)}/check-runs?per_page=50`,
      undefined,
      { allow404: true },
    ).catch(() => null);
    const failing = [
      ...(status?.statuses ?? []).filter((s) => s.state === "failure" || s.state === "error").map((s) => s.context),
      ...(runs?.check_runs ?? [])
        .filter((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion))
        .map((r) => r.name),
    ];
    const pending = (runs?.check_runs ?? []).some((r) => r.status !== "completed") || status?.state === "pending";
    const total = (status?.statuses.length ?? 0) + (runs?.check_runs.length ?? 0);
    const state = !total ? "none" : failing.length ? "failure" : pending ? "pending" : "success";
    return { state, total, failing };
  }

  /** Merge a PR. `sha` guards against merging a head that moved since it was reviewed. */
  async mergePullRequest(
    owner: string,
    repo: string,
    number: number,
    opts: { method?: "merge" | "squash" | "rebase"; sha?: string; title?: string } = {},
  ): Promise<{ merged: boolean; sha: string; message: string }> {
    const r = await this.request<{ merged: boolean; sha: string; message: string }>(
      "PUT",
      `${this.repoPath(owner, repo)}/pulls/${number}/merge`,
      { merge_method: opts.method ?? "squash", ...(opts.sha ? { sha: opts.sha } : {}), ...(opts.title ? { commit_title: opts.title } : {}) },
    );
    return { merged: r.merged, sha: r.sha, message: r.message };
  }

  /** Best-effort: labels are nice-to-have, never fail the PR because of them. */
  async addLabels(owner: string, repo: string, number: number, labels: string[]): Promise<boolean> {
    if (!labels.length) return true;
    try {
      await this.request("POST", `${this.repoPath(owner, repo)}/issues/${number}/labels`, { labels });
      return true;
    } catch {
      return false;
    }
  }
}
