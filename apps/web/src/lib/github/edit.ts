/**
 * Repo editing for the agent team (Pixel edits files, Dash merges). OWNED BY: github. Exported from ./index.
 *
 *   listRepoFiles       browse the target repo (tree, filtered by prefix)
 *   readRepoFile        read one file (truncated for the model)
 *   commitFileChanges   create a darwin/* branch from base, commit files in one commit, optionally open a PR
 *   openPullRequest     open (or refresh) a PR from an existing branch
 *   mergePullRequest    merge a PR (squash by default)
 *   pullRequestStatus   state, mergeability and checks of a PR (default: the newest PR Darwin opened)
 *
 * Modes follow githubMode(): "live" writes; "dry-run" (DARWIN_GITHUB_DRY_RUN=1) and "offline" (no token) never
 * write and return previews of what would happen. Reads work in every mode with a token, and on public repos
 * without one. Writes only ever touch Darwin-owned `darwin/*` branches. Callers (the team) must get the merchant's
 * confirmation before calling any write here.
 */
import { kvGet, kvUpdate } from "@/lib/db/json-store";
import { GitHubClient, GitHubError, parseRepoUrl, type ChecksSummary, type FileChange } from "./client";
import { effectiveToken, markTokenRejected } from "./token";
import { listPullRequests, type GithubMode } from "./store";
import { GithubIntegrationError, getTargetRepo, githubMode, type RepoRef } from "./index";

export const MAX_EDIT_FILES = 10;
export const MAX_EDIT_BYTES = 200_000;
const READ_LIMIT_CHARS = 20_000;
const EDIT_PRS_KEY = "github-edit-prs";

/** "owner/repo" or a GitHub URL → RepoRef; empty → the connected / DARWIN_TARGET_REPO repo. */
export function resolveRepo(input?: string | RepoRef): RepoRef {
  if (input && typeof input === "object") return input;
  if (input?.trim()) {
    const parsed = parseRepoUrl(input.trim());
    if (!parsed) throw new GithubIntegrationError(`“${input}” isn't a GitHub repo (use owner/repo).`, 400);
    return parsed;
  }
  const target = getTargetRepo();
  if (!target) throw new GithubIntegrationError("No repository connected. Connect one in onboarding, or set DARWIN_TARGET_REPO.", 412);
  return target;
}

/** Why a path can't be written (undefined = fine). Blocks traversal, .git and CI workflows. */
export function invalidEditPath(path: string): string | undefined {
  const p = path.trim();
  if (!p || p.length > 300) return "path must be 1-300 characters";
  if (p.startsWith("/") || p.includes("\\")) return "use a repo-relative path like src/app/page.tsx";
  if (p.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return "path can't contain empty, . or .. segments";
  if (/^\.git(\/|$)/.test(p)) return "can't write inside .git";
  if (/^\.github\/workflows\//.test(p)) return "CI workflows are off limits";
  return undefined;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "edit";
}

/** Darwin only writes to its own branches. */
export function editBranchName(hint: string): string {
  const s = slug(hint.replace(/^darwin\//, ""));
  return `darwin/${s}`;
}

function reader(mode: GithubMode): GitHubClient {
  // Offline: try unauthenticated (public repos still read fine); dry-run/live: the token, read-only unless live.
  return new GitHubClient({ token: mode === "offline" ? undefined : effectiveToken(), readOnly: mode !== "live" });
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GitHubError && err.status === 401) markTokenRejected();
    throw err;
  }
}

/* ------------------------------------------------------------------ reads */

export interface RepoFileList {
  repo: string;
  ref: string;
  files: { path: string; size?: number }[];
  /** More files matched than returned (or GitHub truncated the tree). */
  truncated: boolean;
  mode: GithubMode;
}

export async function listRepoFiles(opts: { repo?: string | RepoRef; ref?: string; prefix?: string; limit?: number } = {}): Promise<RepoFileList> {
  const repo = resolveRepo(opts.repo);
  const mode = githubMode();
  const gh = reader(mode);
  return guard(async () => {
    const ref = opts.ref ?? repo.base ?? (await gh.getRepo(repo.owner, repo.repo)).defaultBranch;
    const tree = await gh.getTree(repo.owner, repo.repo, ref);
    const prefix = opts.prefix?.replace(/^\/+/, "") ?? "";
    const blobs = tree.entries.filter((e) => e.type === "blob" && e.path.startsWith(prefix) && !/(^|\/)(node_modules|\.git)\//.test(e.path));
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    return {
      repo: `${repo.owner}/${repo.repo}`,
      ref,
      files: blobs.slice(0, limit).map((e) => ({ path: e.path, ...(e.size !== undefined ? { size: e.size } : {}) })),
      truncated: tree.truncated || blobs.length > limit,
      mode,
    };
  });
}

export interface RepoFile {
  repo: string;
  path: string;
  ref: string;
  sha: string;
  content: string;
  /** Content was cut at READ_LIMIT_CHARS. */
  truncated: boolean;
  size: number;
}

export async function readRepoFile(opts: { repo?: string | RepoRef; path: string; ref?: string; maxChars?: number }): Promise<RepoFile> {
  const repo = resolveRepo(opts.repo);
  const gh = reader(githubMode());
  return guard(async () => {
    const ref = opts.ref ?? repo.base ?? (await gh.getRepo(repo.owner, repo.repo)).defaultBranch;
    const file = await gh.getFileContent(repo.owner, repo.repo, opts.path.replace(/^\/+/, ""), ref);
    if (!file) throw new GithubIntegrationError(`${opts.path} not found in ${repo.owner}/${repo.repo}@${ref}.`, 404);
    const max = opts.maxChars ?? READ_LIMIT_CHARS;
    return { repo: `${repo.owner}/${repo.repo}`, path: file.path, ref, sha: file.sha, content: file.content.slice(0, max), truncated: file.content.length > max, size: file.content.length };
  });
}

/* ------------------------------------------------------------------ writes (confirm first!) */

export interface FileEditResult {
  dryRun: boolean;
  mode: GithubMode;
  repo: string;
  branch: string;
  base?: string;
  commitSha?: string;
  files: { path: string; bytes: number; created: boolean; changed: boolean }[];
  pr?: { url?: string; number?: number; title: string; existing?: boolean };
  notes: string[];
}

export interface EditPrRecord {
  repo: string;
  branch: string;
  title: string;
  url?: string;
  number?: number;
  dryRun: boolean;
  at: string;
}

function recordEditPr(pr: EditPrRecord) {
  kvUpdate<EditPrRecord[]>(EDIT_PRS_KEY, () => [], (all) => [pr, ...all.filter((p) => !(p.repo === pr.repo && p.branch === pr.branch))].slice(0, 20));
}

/** PRs the team opened with commitFileChanges / openPullRequest (newest first). */
export function listEditPullRequests(): EditPrRecord[] {
  return kvGet<EditPrRecord[]>(EDIT_PRS_KEY, () => []);
}

function checkFiles(files: FileChange[]) {
  if (!files.length) throw new GithubIntegrationError("No files to commit.", 400);
  if (files.length > MAX_EDIT_FILES) throw new GithubIntegrationError(`At most ${MAX_EDIT_FILES} files per change.`, 400);
  for (const f of files) {
    const bad = invalidEditPath(f.path);
    if (bad) throw new GithubIntegrationError(`${f.path}: ${bad}.`, 400);
    if (Buffer.byteLength(f.content, "utf8") > MAX_EDIT_BYTES) throw new GithubIntegrationError(`${f.path} is over ${MAX_EDIT_BYTES / 1000} KB.`, 400);
  }
}

/**
 * Commit `files` to a darwin/* branch cut from base (one commit) and, unless `openPr === false`, open a PR.
 * Dry-run / offline: reads what it can and returns the preview; nothing is written.
 */
export async function commitFileChanges(opts: {
  repo?: string | RepoRef;
  files: FileChange[];
  message: string;
  branch?: string;
  title?: string;
  body?: string;
  openPr?: boolean;
}): Promise<FileEditResult> {
  const repo = resolveRepo(opts.repo);
  const files = opts.files.map((f) => ({ path: f.path.trim().replace(/^\/+/, ""), content: f.content }));
  checkFiles(files);
  const branch = editBranchName(opts.branch || opts.title || opts.message);
  const title = (opts.title || opts.message).slice(0, 120);
  const body = opts.body ?? `${opts.message}\n\n_Opened by Darwin's website editor (Pixel) after the merchant confirmed._`;
  const full = `${repo.owner}/${repo.repo}`;
  const mode = githubMode();
  const wantPr = opts.openPr !== false;

  if (mode !== "live") {
    const gh = reader(mode);
    const notes = [mode === "dry-run" ? "Dry run (DARWIN_GITHUB_DRY_RUN=1): nothing was written." : "Preview only: no GitHub token, so nothing was written."];
    const preview: FileEditResult["files"] = [];
    let base = repo.base;
    try {
      base ??= (await gh.getRepo(repo.owner, repo.repo)).defaultBranch;
      for (const f of files) {
        const current = await gh.getFileContent(repo.owner, repo.repo, f.path, base);
        preview.push({ path: f.path, bytes: Buffer.byteLength(f.content), created: !current, changed: current?.content !== f.content });
      }
    } catch {
      notes.push("Couldn't read the repo to compare files.");
      for (const f of files) preview.push({ path: f.path, bytes: Buffer.byteLength(f.content), created: false, changed: true });
    }
    const result: FileEditResult = { dryRun: true, mode, repo: full, branch, base, files: preview, notes, ...(wantPr ? { pr: { title } } : {}) };
    if (wantPr) recordEditPr({ repo: full, branch, title, dryRun: true, at: new Date().toISOString() });
    return result;
  }

  const gh = new GitHubClient({ token: effectiveToken() });
  return guard(async () => {
    const info = await gh.getRepo(repo.owner, repo.repo);
    const base = repo.base ?? info.defaultBranch;
    const baseSha = await gh.getBranchSha(repo.owner, repo.repo, base);
    if (!baseSha) throw new GithubIntegrationError(`Base branch "${base}" not found in ${full}.`, 404);
    const existingPr = await gh.findOpenPullRequest(repo.owner, repo.repo, branch);
    const onto = existingPr ? branch : base;
    const status: FileEditResult["files"] = [];
    const changed: FileChange[] = [];
    for (const f of files) {
      const current = await gh.getFileContent(repo.owner, repo.repo, f.path, onto);
      const differs = current?.content !== f.content;
      status.push({ path: f.path, bytes: Buffer.byteLength(f.content), created: !current, changed: differs });
      if (differs) changed.push(f);
    }
    if (!changed.length) return { dryRun: false, mode, repo: full, branch, base, files: status, notes: ["Files already match; nothing to commit."] };
    if (!existingPr) await gh.ensureBranch(repo.owner, repo.repo, branch, baseSha, { reset: true });
    const commitSha = await gh.commitFiles(repo.owner, repo.repo, { branch, message: opts.message.slice(0, 200), files: changed, ...(existingPr ? {} : { parentSha: baseSha }) });
    const result: FileEditResult = { dryRun: false, mode, repo: full, branch, base, commitSha, files: status, notes: [] };
    if (existingPr) {
      result.pr = { url: existingPr.url, number: existingPr.number, title: existingPr.title, existing: true };
    } else if (wantPr) {
      const pr = await gh.createPullRequest(repo.owner, repo.repo, { title, body, head: branch, base });
      await gh.addLabels(repo.owner, repo.repo, pr.number, ["darwin"]);
      result.pr = { url: pr.url, number: pr.number, title };
    }
    if (result.pr) recordEditPr({ repo: full, branch, title: result.pr.title, url: result.pr.url, number: result.pr.number, dryRun: false, at: new Date().toISOString() });
    return result;
  });
}

/** Open (or find) a PR from an existing branch. */
export async function openPullRequest(opts: { repo?: string | RepoRef; branch: string; title: string; body?: string; base?: string }): Promise<FileEditResult> {
  const repo = resolveRepo(opts.repo);
  const full = `${repo.owner}/${repo.repo}`;
  const mode = githubMode();
  if (!opts.branch.startsWith("darwin/")) throw new GithubIntegrationError("Darwin only opens PRs from its own darwin/* branches.", 400);
  if (mode !== "live") {
    recordEditPr({ repo: full, branch: opts.branch, title: opts.title, dryRun: true, at: new Date().toISOString() });
    return { dryRun: true, mode, repo: full, branch: opts.branch, base: opts.base ?? repo.base, files: [], pr: { title: opts.title }, notes: ["Preview only: no PR was opened."] };
  }
  const gh = new GitHubClient({ token: effectiveToken() });
  return guard(async () => {
    const base = opts.base ?? repo.base ?? (await gh.getRepo(repo.owner, repo.repo)).defaultBranch;
    const open = await gh.findOpenPullRequest(repo.owner, repo.repo, opts.branch);
    const pr = open ?? (await gh.createPullRequest(repo.owner, repo.repo, { title: opts.title, body: opts.body ?? opts.title, head: opts.branch, base }));
    recordEditPr({ repo: full, branch: opts.branch, title: pr.title, url: pr.url, number: pr.number, dryRun: false, at: new Date().toISOString() });
    return { dryRun: false, mode, repo: full, branch: opts.branch, base, files: [], pr: { url: pr.url, number: pr.number, title: pr.title, existing: !!open }, notes: [] };
  });
}

export interface MergeResult {
  dryRun: boolean;
  mode: GithubMode;
  repo: string;
  number: number;
  merged: boolean;
  sha?: string;
  url?: string;
  message: string;
}

export async function mergePullRequest(opts: { repo?: string | RepoRef; number: number; method?: "merge" | "squash" | "rebase" }): Promise<MergeResult> {
  const repo = resolveRepo(opts.repo);
  const full = `${repo.owner}/${repo.repo}`;
  const mode = githubMode();
  if (mode !== "live") {
    return { dryRun: true, mode, repo: full, number: opts.number, merged: false, message: `Preview only: would ${opts.method ?? "squash"}-merge ${full}#${opts.number}. Nothing was merged.` };
  }
  const gh = new GitHubClient({ token: effectiveToken() });
  return guard(async () => {
    const pr = await gh.getPullRequest(repo.owner, repo.repo, opts.number);
    if (!pr) throw new GithubIntegrationError(`PR #${opts.number} not found in ${full}.`, 404);
    if (pr.merged) return { dryRun: false, mode, repo: full, number: opts.number, merged: true, url: pr.url, message: `#${opts.number} was already merged.` };
    if (pr.state !== "open") throw new GithubIntegrationError(`#${opts.number} is ${pr.state}, not open.`, 409);
    const r = await gh.mergePullRequest(repo.owner, repo.repo, opts.number, opts.method ?? "squash");
    return { dryRun: false, mode, repo: full, number: opts.number, merged: r.merged, sha: r.sha, url: pr.url, message: r.message };
  });
}

export interface PrStatus {
  repo: string;
  number?: number;
  title: string;
  url?: string;
  state: "open" | "closed" | "merged" | "preview";
  mergeable?: boolean | null;
  draft?: boolean;
  checks?: ChecksSummary;
  changedFiles?: number;
  /** The PR is a dry-run preview Darwin recorded (never opened on GitHub). */
  dryRun: boolean;
}

/** Status of PR `number`, or of the newest PR Darwin opened (ship or edit). */
export async function pullRequestStatus(opts: { repo?: string | RepoRef; number?: number } = {}): Promise<PrStatus> {
  let number = opts.number;
  let repoInput = opts.repo;
  if (!number) {
    const latest = [...listEditPullRequests(), ...listPullRequests()].sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!latest) throw new GithubIntegrationError("Darwin hasn't opened any pull requests yet.", 404);
    if (!latest.number) return { repo: latest.repo, title: latest.title, url: latest.url, state: "preview", dryRun: true };
    number = latest.number;
    repoInput ??= latest.repo;
  }
  const repo = resolveRepo(repoInput);
  const full = `${repo.owner}/${repo.repo}`;
  const gh = reader(githubMode());
  return guard(async () => {
    const pr = await gh.getPullRequest(repo.owner, repo.repo, number!);
    if (!pr) throw new GithubIntegrationError(`PR #${number} not found in ${full}.`, 404);
    const checks = await gh.getChecks(repo.owner, repo.repo, pr.headSha);
    return {
      repo: full,
      number,
      title: pr.title,
      url: pr.url,
      state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
      mergeable: pr.mergeable,
      draft: pr.draft,
      checks,
      changedFiles: pr.changedFiles,
      dryRun: false,
    };
  });
}
