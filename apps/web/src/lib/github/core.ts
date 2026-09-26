/**
 * Shared GitHub plumbing for the PR flows (index.ts) and repo editing (edit.ts): modes, target repo,
 * client, base resolution, publish (create/update a PR idempotently) and the PR log.
 */
import { GitHubClient, parseRepoUrl, type FileChange } from "./client";
import type { FrameworkDetection } from "./install";
import { getConnection, recordPullRequest, type GithubMode, type PullRequestRecord } from "./store";


export interface RepoRef {
  owner: string;
  repo: string;
  /** Base branch. Default: repo default branch. */
  base?: string;
}

export interface PullRequestResult {
  dryRun: boolean;
  url?: string;
  number?: number;
  branch: string;
  title: string;
  body: string;
  files: { path: string; content: string }[];
  /** "owner/repo". */
  repo?: string;
  /** Base branch the PR targets (unknown in offline dry runs). */
  base?: string;
  /** Install PRs: what Darwin detected in the repo. */
  detection?: FrameworkDetection;
  /** An open PR for this branch already existed and was updated instead of duplicated. */
  existing?: boolean;
  /** Nothing to change (already installed / spec already committed): no PR was opened. */
  upToDate?: boolean;
  /** Short human-readable notes: dry-run reason, assumptions, warnings. */
  notes?: string[];
}

/** An error with an HTTP status, for the API routes. */
export class GithubIntegrationError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubIntegrationError";
    this.status = status;
  }
}

/** "live" with a token (the signed-in merchant's, else GITHUB_TOKEN); "offline" without one. */
export function githubMode(token?: string): GithubMode {
  if (!token && !process.env.GITHUB_TOKEN?.trim()) return "offline";
  return /^(1|true|yes|on)$/i.test(process.env.DARWIN_GITHUB_DRY_RUN?.trim() ?? "") ? "dry-run" : "live";
}

/** Repo PRs go to: the connected repo, else DARWIN_TARGET_REPO. */
export function getTargetRepo(): RepoRef | undefined {
  const conn = getConnection();
  if (conn) return { owner: conn.owner, repo: conn.name, base: conn.base };
  const env = process.env.DARWIN_TARGET_REPO?.trim();
  const parsed = env ? parseRepoUrl(env) : null;
  return parsed ?? undefined;
}

export function githubClient(mode: GithubMode, token?: string): GitHubClient {
  return new GitHubClient({ token: token ?? process.env.GITHUB_TOKEN?.trim(), readOnly: mode !== "live" });
}

/* ------------------------------------------------------------------ shared PR plumbing */

export async function resolveBase(gh: GitHubClient, repo: RepoRef) {
  const info = await gh.getRepo(repo.owner, repo.repo);
  const base = repo.base ?? info.defaultBranch;
  const baseSha = await gh.getBranchSha(repo.owner, repo.repo, base);
  if (!baseSha) throw new GithubIntegrationError(`Base branch "${base}" not found in ${info.fullName}.`, 404);
  return { base, baseSha, fullName: info.fullName };
}

/**
 * Create or update the PR for `branch`. If an open PR exists, commit only files that differ
 * on the branch and refresh title/body; otherwise (re)start the Darwin-owned branch from base.
 */
export async function publish(
  gh: GitHubClient,
  repo: RepoRef,
  target: { base: string; baseSha: string },
  pr: { branch: string; title: string; body: string; files: FileChange[]; commitMessage: string; labels: string[] },
): Promise<{ url: string; number: number; existing: boolean }> {
  const { owner, repo: name } = repo;
  const open = await gh.findOpenPullRequest(owner, name, pr.branch);
  if (open) {
    const changed: FileChange[] = [];
    for (const f of pr.files) {
      const current = await gh.getFileContent(owner, name, f.path, pr.branch);
      if (current?.content !== f.content) changed.push(f);
    }
    if (changed.length) await gh.commitFiles(owner, name, { branch: pr.branch, message: pr.commitMessage, files: changed });
    const updated = await gh.updatePullRequest(owner, name, open.number, { title: pr.title, body: pr.body });
    return { url: updated.url, number: updated.number, existing: true };
  }
  await gh.ensureBranch(owner, name, pr.branch, target.baseSha, { reset: true });
  await gh.commitFiles(owner, name, { branch: pr.branch, message: pr.commitMessage, files: pr.files, parentSha: target.baseSha });
  const created = await gh.createPullRequest(owner, name, { title: pr.title, body: pr.body, head: pr.branch, base: target.base });
  await gh.addLabels(owner, name, created.number, pr.labels);
  return { url: created.url, number: created.number, existing: false };
}

export function record(kind: PullRequestRecord["kind"], result: PullRequestResult, extra: Partial<PullRequestRecord> = {}) {
  recordPullRequest({
    kind,
    repo: result.repo ?? "",
    title: result.title,
    branch: result.branch,
    url: result.url,
    number: result.number,
    dryRun: result.dryRun,
    existing: result.existing,
    upToDate: result.upToDate,
    at: new Date().toISOString(),
    ...extra,
  });
  return result;
}
