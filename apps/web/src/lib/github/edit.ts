/**
 * Repo editing for the agent team (Pixel / Dash): read files, stage a changeset, commit it, open a PR,
 * check a PR, merge it. Same modes as the PR flows: offline (no token) never touches the network and returns
 * previews; dry-run reads but never writes; live writes. The team's confirm gate gets the merchant's approval
 * before anything is written or merged.
 */
import { parseRepoUrl, type FileChange } from "./client";
import {
  GithubIntegrationError,
  getTargetRepo,
  githubClient,
  githubMode,
  publish,
  record,
  resolveBase,
  type PullRequestResult,
  type RepoRef,
} from "./core";
import { kvGet, kvUpdate } from "@/lib/db/json-store";
import { listPullRequests, type GithubMode, type PullRequestRecord } from "./store";

//
// Read files, propose file edits as a PR, check a PR, merge it. Same modes as above: offline (no token) never
// touches the network and returns previews; dry-run reads but never writes; live writes. Callers (the team's
// confirm gate) must get the merchant's approval before proposeFileEdits / mergePullRequest in live mode.

export const MAX_EDIT_FILES = 10;
export const MAX_EDIT_BYTES = 200_000;

/** Why Darwin refuses to write `path` (undefined = allowed). No traversal, no git internals, no CI workflows, no secrets. */
export function repoPathError(path: string): string | undefined {
  const p = path.trim();
  if (!p || p.length > 300) return "Path must be 1–300 characters.";
  if (p.startsWith("/") || p.includes("\\")) return `"${p}" must be a relative path with / separators.`;
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === "..")) return `"${p}" has an empty, "." or ".." segment.`;
  if (parts[0] === ".git" || p.startsWith(".github/workflows/")) return `Darwin doesn't edit ${parts[0] === ".git" ? "git internals" : "CI workflows"}.`;
  if (/(^|\/)\.env(\.|$)/.test(p)) return "Darwin doesn't edit .env files.";
  return undefined;
}

/** "owner/repo" (or a URL) → RepoRef; default: the connected / DARWIN_TARGET_REPO repo. */
export function resolveRepo(repo?: string): RepoRef | undefined {
  if (repo?.trim()) {
    const c = parseRepoUrl(repo);
    return c ?? undefined;
  }
  return getTargetRepo();
}

const NO_REPO = "No repository connected yet. Connect your store's GitHub repo in onboarding (or set DARWIN_TARGET_REPO).";

export interface RepoFilesResult {
  ok: boolean;
  mode: GithubMode;
  repo?: string;
  ref?: string;
  files: string[];
  /** More files matched than were returned (or GitHub truncated the tree). */
  truncated?: boolean;
  note?: string;
}

/** List files (blobs) in the repo, optionally under `path`. Offline mode returns a note, never fakes a listing. */
export async function listRepoFiles(opts: { repo?: string; path?: string; ref?: string; limit?: number } = {}): Promise<RepoFilesResult> {
  const repo = resolveRepo(opts.repo);
  const mode = githubMode();
  if (!repo) return { ok: false, mode, files: [], note: NO_REPO };
  const name = `${repo.owner}/${repo.repo}`;
  if (mode === "offline") return { ok: false, mode, repo: name, files: [], note: "No GITHUB_TOKEN, so Darwin can't read the repository yet." };
  const gh = githubClient(mode);
  const target = opts.ref ? { base: opts.ref, baseSha: opts.ref, fullName: name } : await resolveBase(gh, repo);
  const tree = await gh.getTree(repo.owner, repo.repo, target.baseSha);
  const prefix = opts.path?.trim().replace(/^\/+|\/+$/g, "");
  const all = tree.entries.filter((e) => e.type === "blob" && (!prefix || e.path === prefix || e.path.startsWith(`${prefix}/`))).map((e) => e.path);
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  return { ok: true, mode, repo: target.fullName, ref: target.base, files: all.slice(0, limit), truncated: tree.truncated || all.length > limit };
}

export interface RepoFileResult {
  ok: boolean;
  mode: GithubMode;
  repo?: string;
  path: string;
  ref?: string;
  content?: string;
  /** Content was cut to `maxChars`. */
  truncated?: boolean;
  sha?: string;
  note?: string;
}

/** Read one file (UTF-8). */
export async function readRepoFile(opts: { repo?: string; path: string; ref?: string; maxChars?: number }): Promise<RepoFileResult> {
  const repo = resolveRepo(opts.repo);
  const mode = githubMode();
  const path = opts.path.trim().replace(/^\/+/, "");
  if (!repo) return { ok: false, mode, path, note: NO_REPO };
  const name = `${repo.owner}/${repo.repo}`;
  if (mode === "offline") return { ok: false, mode, repo: name, path, note: "No GITHUB_TOKEN, so Darwin can't read the repository yet." };
  const gh = githubClient(mode);
  const file = await gh.getFileContent(repo.owner, repo.repo, path, opts.ref ?? repo.base);
  if (!file) return { ok: false, mode, repo: name, path, ref: opts.ref, note: `${path} doesn't exist${opts.ref ? ` on ${opts.ref}` : ""}.` };
  const max = Math.min(Math.max(opts.maxChars ?? 20_000, 200), MAX_EDIT_BYTES);
  return {
    ok: true,
    mode,
    repo: name,
    path: file.path,
    ref: opts.ref ?? repo.base,
    sha: file.sha,
    content: file.content.slice(0, max),
    truncated: file.content.length > max,
  };
}

/** "+12 −3" style line counts between two versions (multiset of lines; cheap and good enough for a preview). */
export function lineDelta(before: string | undefined, after: string): { added: number; removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(before ?? "");
  const b = count(after);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  if (before === undefined) removed = 0;
  return { added, removed };
}

export interface FileEditPreview {
  path: string;
  /** The file is new on the base branch (unknown offline). */
  created?: boolean;
  added: number;
  removed: number;
}

export interface EditPullRequestResult extends PullRequestResult {
  preview: FileEditPreview[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "change";

/** Validate the requested edits (throws GithubIntegrationError 400). */
export function validateEdits(files: FileChange[]): FileChange[] {
  if (!files.length) throw new GithubIntegrationError("No files to change.", 400);
  if (files.length > MAX_EDIT_FILES) throw new GithubIntegrationError(`At most ${MAX_EDIT_FILES} files per pull request.`, 400);
  const seen = new Set<string>();
  return files.map((f) => {
    const path = f.path.trim();
    const err = repoPathError(path);
    if (err) throw new GithubIntegrationError(err, 400);
    if (seen.has(path)) throw new GithubIntegrationError(`${path} is listed twice.`, 400);
    seen.add(path);
    if (typeof f.content !== "string" || f.content.length > MAX_EDIT_BYTES) throw new GithubIntegrationError(`${path} is too large.`, 400);
    return { path, content: f.content };
  });
}

/**
 * Propose file edits as a pull request on a Darwin-owned `darwin/edit-*` branch (idempotent per branch).
 * Offline / dry-run: returns the preview (files, per-file line deltas) and opens nothing.
 */
export async function proposeFileEdits(opts: {
  repo?: string;
  files: FileChange[];
  title: string;
  body?: string;
  branch?: string;
}): Promise<EditPullRequestResult> {
  const repo = resolveRepo(opts.repo);
  if (!repo) throw new GithubIntegrationError(NO_REPO, 412);
  const files = validateEdits(opts.files);
  const title = opts.title.trim().slice(0, 120) || "Darwin: site edits";
  const branch = opts.branch?.startsWith("darwin/") ? opts.branch : `darwin/edit-${slug(opts.branch || title)}`;
  const body = [
    opts.body?.trim() || "Edits proposed by Darwin's website editor (Pixel).",
    "",
    "Files:",
    ...files.map((f) => `- \`${f.path}\``),
    "",
    "_Opened by Darwin after the merchant approved it in Ask Darwin._",
  ].join("\n");
  const fullName = `${repo.owner}/${repo.repo}`;
  const mode = githubMode();
  const extra = { dryRun: mode !== "live" };

  if (mode === "offline") {
    const result: EditPullRequestResult = {
      ...extra,
      branch,
      title,
      body,
      files,
      repo: fullName,
      base: repo.base,
      preview: files.map((f) => ({ path: f.path, ...lineDelta(undefined, f.content) })),
      notes: ["Dry run: GITHUB_TOKEN is not set, so no branch or PR was created."],
    };
    record("edit", result);
    return result;
  }

  const gh = githubClient(mode);
  const { base, baseSha, fullName: canonical } = await resolveBase(gh, repo);
  const preview: FileEditPreview[] = [];
  const changed: FileChange[] = [];
  for (const f of files) {
    const current = await gh.getFileContent(repo.owner, repo.repo, f.path, baseSha);
    if (current?.content === f.content) continue;
    changed.push(f);
    preview.push({ path: f.path, created: !current, ...lineDelta(current?.content, f.content) });
  }
  const result: EditPullRequestResult = { ...extra, branch, title, body, files: changed, repo: canonical, base, preview, notes: [] };
  if (!changed.length) {
    result.notes!.push(`Every file already has this content on ${base}; no PR needed.`);
    return record("edit", { ...result, upToDate: true }) as EditPullRequestResult;
  }
  if (mode === "dry-run") {
    result.notes!.push("Dry run (DARWIN_GITHUB_DRY_RUN=1): the repository was read but no branch or PR was created.");
    return record("edit", result) as EditPullRequestResult;
  }
  const pr = await publish(gh, repo, { base, baseSha }, {
    branch,
    title,
    body,
    files: changed,
    commitMessage: title,
    labels: ["darwin"],
  });
  if (pr.existing) result.notes!.push(`Updated the existing open PR #${pr.number}.`);
  return record("edit", { ...result, url: pr.url, number: pr.number, existing: pr.existing }) as EditPullRequestResult;
}

export interface PullRequestStatus {
  ok: boolean;
  mode: GithubMode;
  repo?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  merged?: boolean;
  mergeable?: boolean | null;
  draft?: boolean;
  checks?: { state: string; total: number; failing: string[] };
  changes?: { additions?: number; deletions?: number; files?: number };
  headSha?: string;
  /** From Darwin's own PR log (offline / dry runs). */
  recorded?: PullRequestRecord;
  note?: string;
}

/** Status of a PR (default: Darwin's most recent one with a number). Offline: what Darwin recorded. */
export async function pullRequestStatus(opts: { repo?: string; number?: number } = {}): Promise<PullRequestStatus> {
  const repo = resolveRepo(opts.repo);
  const mode = githubMode();
  const name = repo ? `${repo.owner}/${repo.repo}` : undefined;
  const log = listPullRequests().filter((p) => !name || p.repo.toLowerCase() === name.toLowerCase());
  const recorded = opts.number ? log.find((p) => p.number === opts.number) : (log.find((p) => p.number) ?? log[0]);
  const number = opts.number ?? recorded?.number;
  if (!repo) return { ok: false, mode, note: NO_REPO };
  if (mode === "offline" || !number) {
    return {
      ok: Boolean(recorded),
      mode,
      repo: name,
      number,
      recorded,
      title: recorded?.title,
      url: recorded?.url,
      note: recorded
        ? recorded.dryRun
          ? `“${recorded.title}” was a dry run (no PR exists on GitHub).`
          : undefined
        : "Darwin hasn't opened a pull request yet.",
    };
  }
  const gh = githubClient(mode);
  const pr = await gh.getPullRequest(repo.owner, repo.repo, number);
  if (!pr) return { ok: false, mode, repo: name, number, note: `PR #${number} doesn't exist on ${name}.` };
  const checks = pr.headSha ? await gh.getChecksState(repo.owner, repo.repo, pr.headSha).catch(() => undefined) : undefined;
  return {
    ok: true,
    mode,
    repo: name,
    number,
    title: pr.title,
    url: pr.url,
    state: pr.merged ? "merged" : pr.state,
    merged: pr.merged,
    mergeable: pr.mergeable,
    draft: pr.draft,
    checks,
    changes: { additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles },
    headSha: pr.headSha,
    recorded,
  };
}

export interface MergeResult {
  ok: boolean;
  dryRun: boolean;
  merged: boolean;
  repo?: string;
  number: number;
  url?: string;
  sha?: string;
  message: string;
}

/**
 * Merge a PR (squash by default). Refuses closed, draft, conflicting or failing-checks PRs.
 * Offline / dry-run: says what would happen and merges nothing. Needs the merchant's confirmation (team gate).
 */
export async function mergePullRequest(opts: { repo?: string; number: number; method?: "merge" | "squash" | "rebase" }): Promise<MergeResult> {
  const repo = resolveRepo(opts.repo);
  if (!repo) throw new GithubIntegrationError(NO_REPO, 412);
  const name = `${repo.owner}/${repo.repo}`;
  const mode = githubMode();
  const method = opts.method ?? "squash";
  if (mode === "offline")
    return { ok: true, dryRun: true, merged: false, repo: name, number: opts.number, message: `Dry run: no GITHUB_TOKEN, so PR #${opts.number} on ${name} was not merged (would ${method}-merge).` };
  const gh = githubClient(mode);
  const pr = await gh.getPullRequest(repo.owner, repo.repo, opts.number);
  if (!pr) throw new GithubIntegrationError(`PR #${opts.number} doesn't exist on ${name}.`, 404);
  if (pr.merged) return { ok: true, dryRun: false, merged: true, repo: name, number: pr.number, url: pr.url, message: `PR #${pr.number} is already merged.` };
  if (pr.state !== "open") throw new GithubIntegrationError(`PR #${pr.number} is ${pr.state}, not open.`, 409);
  if (pr.draft) throw new GithubIntegrationError(`PR #${pr.number} is a draft.`, 409);
  if (pr.mergeable === false) throw new GithubIntegrationError(`PR #${pr.number} has merge conflicts.`, 409);
  const checks = pr.headSha ? await gh.getChecksState(repo.owner, repo.repo, pr.headSha).catch(() => undefined) : undefined;
  if (checks?.state === "failure") throw new GithubIntegrationError(`PR #${pr.number} has failing checks: ${checks.failing.slice(0, 3).join(", ")}.`, 409);
  if (mode === "dry-run")
    return { ok: true, dryRun: true, merged: false, repo: name, number: pr.number, url: pr.url, message: `Dry run (DARWIN_GITHUB_DRY_RUN=1): PR #${pr.number} is mergeable but was not merged.` };
  const r = await gh.mergePullRequest(repo.owner, repo.repo, pr.number, { method, sha: pr.headSha });
  return { ok: r.merged, dryRun: false, merged: r.merged, repo: name, number: pr.number, url: pr.url, sha: r.sha, message: r.message };
}

/* ------------------------------------------------------------------ diffs */

export interface DiffLine {
  op: " " | "+" | "-";
  text: string;
}

/**
 * Compact unified diff (LCS over lines) with `context` lines around changes, cut to `maxLines`.
 * Files too large for an exact diff return just the counts.
 */
export function unifiedDiff(
  before: string | undefined | null,
  after: string,
  opts: { context?: number; maxLines?: number } = {},
): { added: number; removed: number; preview: string } {
  const a = before == null ? [] : before.split("\n");
  const b = after.split("\n");
  const context = opts.context ?? 2;
  const maxLines = opts.maxLines ?? 40;
  if (a.length * b.length > 4_000_000) {
    const d = lineDelta(before ?? undefined, after);
    return { ...d, preview: `(large file: +${d.added} −${d.removed})` };
  }
  // LCS table (suffix lengths), then walk it to produce the edit script.
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const script: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      script.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i * w + j + 1] > dp[(i + 1) * w + j])) {
      script.push({ op: "+", text: b[j++] });
    } else {
      script.push({ op: "-", text: a[i++] });
    }
  }
  const added = script.filter((l) => l.op === "+").length;
  const removed = script.filter((l) => l.op === "-").length;
  const keep = new Set<number>();
  script.forEach((l, k) => {
    if (l.op === " ") return;
    for (let c = Math.max(0, k - context); c <= Math.min(script.length - 1, k + context); c++) keep.add(c);
  });
  const out: string[] = [];
  let last = -1;
  for (const k of [...keep].sort((x, y) => x - y)) {
    if (last >= 0 && k > last + 1) out.push("…");
    const l = script[k];
    out.push(`${l.op}${l.text.length > 160 ? `${l.text.slice(0, 160)}…` : l.text}`);
    last = k;
    if (out.length >= maxLines) {
      out.push("… (diff truncated)");
      break;
    }
  }
  return { added, removed, preview: out.join("\n") };
}

/* ------------------------------------------------------------------ changesets (stage → review → commit / PR) */

export const MAX_CHANGESET_FILES = 20;
const CHANGESETS_KEY = "github-changesets";
const MAX_CHANGESETS = 20;

export interface ChangesetFile {
  path: string;
  /** Content on the base/work branch when staged: null = new file, undefined = unknown (offline). */
  before?: string | null;
  after: string;
  stagedAt: string;
}

export interface Changeset {
  id: string;
  /** "owner/repo". */
  repo: string;
  base?: string;
  /** Darwin-owned work branch (`darwin/*`). */
  branch: string;
  files: Record<string, ChangesetFile>;
  /** Files already committed to `branch` (and the commit). */
  commits: { sha?: string; message: string; files: string[]; dryRun: boolean; at: string }[];
  pr?: { number?: number; url?: string; title: string; dryRun: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface ChangesetSummary {
  id: string;
  repo: string;
  branch: string;
  files: { path: string; created?: boolean; added: number; removed: number; preview: string; committed: boolean }[];
  /** One line: "2 files (+14 −3): a.tsx (+10 −3), b.css (+4)". */
  text: string;
  pending: number;
}

function changesets(): Record<string, Changeset> {
  return kvGet<Record<string, Changeset>>(CHANGESETS_KEY, () => ({}));
}

function saveChangeset(cs: Changeset): Changeset {
  kvUpdate<Record<string, Changeset>>(CHANGESETS_KEY, () => ({}), (all) => {
    const next = { ...all, [cs.id]: { ...cs, updatedAt: new Date().toISOString() } };
    const ids = Object.keys(next).sort((x, y) => next[y].updatedAt.localeCompare(next[x].updatedAt));
    for (const drop of ids.slice(MAX_CHANGESETS)) delete next[drop];
    return next;
  });
  return changesets()[cs.id];
}

export function getChangeset(id: string): Changeset | undefined {
  return changesets()[id];
}

/** Drop staged (uncommitted) edits: one file, or the whole changeset. */
export function discardChangeset(id: string, path?: string): Changeset | undefined {
  const cs = getChangeset(id);
  if (!cs) return undefined;
  if (!path) {
    kvUpdate<Record<string, Changeset>>(CHANGESETS_KEY, () => ({}), (all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    return undefined;
  }
  const files = { ...cs.files };
  delete files[path];
  return saveChangeset({ ...cs, files });
}

const isCommitted = (cs: Changeset, f: ChangesetFile) =>
  cs.commits.some((c) => c.files.includes(f.path) && c.at >= f.stagedAt);

export function summarizeChangeset(cs: Changeset): ChangesetSummary {
  const files = Object.values(cs.files).map((f) => {
    const d = unifiedDiff(f.before, f.after);
    return { path: f.path, created: f.before === null ? true : undefined, ...d, committed: isCommitted(cs, f) };
  });
  const add = files.reduce((s, f) => s + f.added, 0);
  const rem = files.reduce((s, f) => s + f.removed, 0);
  const pending = files.filter((f) => !f.committed).length;
  const text = files.length
    ? `${files.length} file${files.length === 1 ? "" : "s"} (+${add} −${rem}): ${files
        .slice(0, 5)
        .map((f) => `${f.path}${f.created ? " (new)" : ""} (+${f.added}${f.removed ? ` −${f.removed}` : ""})`)
        .join(", ")}${files.length > 5 ? ", …" : ""}`
    : "No staged changes.";
  return { id: cs.id, repo: cs.repo, branch: cs.branch, files, text, pending };
}

function openChangeset(id: string, repoArg?: string): { cs: Changeset; repo: RepoRef } {
  const existing = getChangeset(id);
  const repo = resolveRepo(repoArg ?? existing?.repo);
  if (!repo) throw new GithubIntegrationError(NO_REPO, 412);
  const name = `${repo.owner}/${repo.repo}`;
  if (existing && existing.repo.toLowerCase() === name.toLowerCase()) return { cs: existing, repo };
  if (existing && Object.keys(existing.files).length)
    throw new GithubIntegrationError(`This changeset is for ${existing.repo}; commit or discard it before editing ${name}.`, 409);
  const now = new Date().toISOString();
  return {
    cs: { id, repo: name, base: repo.base, branch: `darwin/edit-${id.replace(/[^a-z0-9]+/gi, "-").slice(-12).toLowerCase()}`, files: {}, commits: [], createdAt: now, updatedAt: now },
    repo,
  };
}

/** Current content of `path` for staging: the staged version, else the work branch, else base. */
async function currentContent(cs: Changeset, repo: RepoRef, path: string): Promise<{ content: string | null; readable: boolean }> {
  const staged = cs.files[path];
  if (staged) return { content: staged.after, readable: true };
  const mode = githubMode();
  if (mode === "offline") return { content: null, readable: false };
  const gh = githubClient(mode);
  const onBranch = await gh.getBranchSha(repo.owner, repo.repo, cs.branch);
  const f = await gh.getFileContent(repo.owner, repo.repo, path, onBranch ? cs.branch : repo.base);
  return { content: f?.content ?? null, readable: true };
}

function checkPath(path: string): string {
  const p = path.trim().replace(/^\.\//, "");
  const err = repoPathError(p);
  if (err) throw new GithubIntegrationError(err, 400);
  return p;
}

/** Stage a whole-file write (new or replaced file). Nothing is written to GitHub. */
export async function stageFileWrite(id: string, opts: { repo?: string; path: string; content: string }): Promise<ChangesetSummary> {
  const { cs, repo } = openChangeset(id, opts.repo);
  const path = checkPath(opts.path);
  if (opts.content.length > MAX_EDIT_BYTES) throw new GithubIntegrationError(`${path} is too large (max ${MAX_EDIT_BYTES} characters).`, 400);
  if (!cs.files[path] && Object.keys(cs.files).length >= MAX_CHANGESET_FILES)
    throw new GithubIntegrationError(`A changeset holds at most ${MAX_CHANGESET_FILES} files.`, 400);
  const prior = cs.files[path];
  const before = prior ? prior.before : (await currentContent(cs, repo, path).then((c) => (c.readable ? c.content : undefined)));
  cs.files = { ...cs.files, [path]: { path, before, after: opts.content, stagedAt: new Date().toISOString() } };
  return summarizeChangeset(saveChangeset(cs));
}

export interface TextEdit {
  /** Exact text to find (must match once unless `all`). */
  find: string;
  replace: string;
  /** Replace every occurrence. */
  all?: boolean;
}

/** Stage exact-string edits to one file (applied in order on the latest staged/branch/base content). */
export async function stageFileEdits(id: string, opts: { repo?: string; path: string; edits: TextEdit[] }): Promise<ChangesetSummary> {
  const { cs, repo } = openChangeset(id, opts.repo);
  const path = checkPath(opts.path);
  if (!opts.edits.length) throw new GithubIntegrationError("No edits given.", 400);
  const current = await currentContent(cs, repo, path);
  if (!current.readable)
    throw new GithubIntegrationError("No GITHUB_TOKEN, so Darwin can't read the file to edit it. Use write_file with the full content (it will be a preview).", 412);
  if (current.content === null) throw new GithubIntegrationError(`${path} doesn't exist. Use write_file to create it.`, 404);
  let text = current.content;
  for (const [k, e] of opts.edits.entries()) {
    if (!e.find) throw new GithubIntegrationError(`Edit ${k + 1}: "find" is empty.`, 400);
    const count = text.split(e.find).length - 1;
    if (count === 0) throw new GithubIntegrationError(`Edit ${k + 1}: the text to find isn't in ${path} (it must match exactly, whitespace included).`, 422);
    if (count > 1 && !e.all)
      throw new GithubIntegrationError(`Edit ${k + 1}: the text appears ${count} times in ${path}; add surrounding lines to make it unique, or set all: true.`, 422);
    text = e.all ? text.split(e.find).join(e.replace) : text.replace(e.find, () => e.replace);
  }
  if (text.length > MAX_EDIT_BYTES) throw new GithubIntegrationError(`${path} would be too large.`, 400);
  const before = cs.files[path] ? cs.files[path].before : current.content;
  cs.files = { ...cs.files, [path]: { path, before, after: text, stagedAt: new Date().toISOString() } };
  return summarizeChangeset(saveChangeset(cs));
}

/** Pick the changeset's work branch (auto-prefixed `darwin/`); created on GitHub now in live mode (from base). */
export async function createWorkBranch(id: string, opts: { repo?: string; branch: string }): Promise<{ branch: string; created: boolean; dryRun: boolean; note?: string }> {
  const { cs, repo } = openChangeset(id, opts.repo);
  const raw = opts.branch.trim().replace(/^darwin\//, "");
  const branch = `darwin/${raw.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "edit"}`;
  if (cs.commits.length && branch !== cs.branch)
    throw new GithubIntegrationError(`Changes were already committed to ${cs.branch}; keep using it.`, 409);
  cs.branch = branch;
  saveChangeset(cs);
  const mode = githubMode();
  if (mode !== "live") return { branch, created: false, dryRun: true, note: mode === "offline" ? "Dry run: no GITHUB_TOKEN, the branch will exist only in the preview." : "Dry run: the branch was not created." };
  const gh = githubClient(mode);
  const { baseSha } = await resolveBase(gh, repo);
  const r = await gh.ensureBranch(repo.owner, repo.repo, branch, baseSha);
  return { branch, created: r.created, dryRun: false };
}

async function commitPending(cs: Changeset, repo: RepoRef, message: string) {
  const pending = Object.values(cs.files).filter((f) => !isCommitted(cs, f));
  if (!pending.length) return undefined;
  const mode = githubMode();
  const files = pending.map((f) => ({ path: f.path, content: f.after }));
  let sha: string | undefined;
  if (mode === "live") {
    const gh = githubClient(mode);
    const { baseSha } = await resolveBase(gh, repo);
    await gh.ensureBranch(repo.owner, repo.repo, cs.branch, baseSha);
    sha = await gh.commitFiles(repo.owner, repo.repo, { branch: cs.branch, message, files });
  }
  const commit = { sha, message, files: files.map((f) => f.path), dryRun: mode !== "live", at: new Date().toISOString() };
  cs.commits = [...cs.commits, commit];
  saveChangeset(cs);
  return commit;
}

/** Commit every staged, uncommitted file in ONE commit to the work branch. Dry runs record a preview commit. */
export async function commitChangeset(id: string, opts: { message: string; repo?: string }): Promise<{ summary: ChangesetSummary; commit?: Changeset["commits"][number]; note?: string }> {
  const { cs, repo } = openChangeset(id, opts.repo);
  const summary = summarizeChangeset(cs);
  const commit = await commitPending(cs, repo, opts.message.trim().slice(0, 200) || "Darwin: site edits");
  const mode = githubMode();
  return {
    summary: summarizeChangeset(getChangeset(id) ?? cs),
    commit,
    note: !commit
      ? "Nothing new to commit."
      : mode !== "live"
        ? `Dry run (${mode === "offline" ? "no GITHUB_TOKEN" : "DARWIN_GITHUB_DRY_RUN=1"}): ${summary.pending} file(s) would be committed to ${cs.branch}.`
        : undefined,
  };
}

/** Commit anything still staged, then open (or reuse) the PR from the work branch. */
export async function openChangesetPR(id: string, opts: { title: string; body?: string; repo?: string }): Promise<EditPullRequestResult> {
  const { cs, repo } = openChangeset(id, opts.repo);
  if (!Object.keys(cs.files).length) throw new GithubIntegrationError("No staged changes: write or edit files first.", 409);
  const title = opts.title.trim().slice(0, 120) || "Darwin: site edits";
  const summary = summarizeChangeset(cs);
  const body = [
    opts.body?.trim() || "Edits proposed by Darwin's website editor (Pixel).",
    "",
    `**Changes:** ${summary.text}`,
    "",
    "_Opened by Darwin after the merchant approved it in Ask Darwin._",
  ].join("\n");
  await commitPending(cs, repo, title);
  const mode = githubMode();
  const files = Object.values(cs.files).map((f) => ({ path: f.path, content: f.after }));
  const preview = summary.files.map((f) => ({ path: f.path, created: f.created, added: f.added, removed: f.removed }));
  const result: EditPullRequestResult = {
    dryRun: mode !== "live",
    branch: cs.branch,
    title,
    body,
    files,
    repo: cs.repo,
    base: repo.base,
    preview,
    notes: [],
  };
  if (mode !== "live") {
    result.notes!.push(mode === "offline" ? "Dry run: GITHUB_TOKEN is not set, so no branch or PR was created." : "Dry run (DARWIN_GITHUB_DRY_RUN=1): no branch or PR was created.");
    saveChangeset({ ...(getChangeset(id) ?? cs), pr: { title, dryRun: true } });
    return record("edit", result) as EditPullRequestResult;
  }
  const gh = githubClient(mode);
  const { base } = await resolveBase(gh, repo);
  const open = await gh.findOpenPullRequest(repo.owner, repo.repo, cs.branch);
  const pr = open
    ? await gh.updatePullRequest(repo.owner, repo.repo, open.number, { title, body })
    : await gh.createPullRequest(repo.owner, repo.repo, { title, body, head: cs.branch, base });
  if (!open) await gh.addLabels(repo.owner, repo.repo, pr.number, ["darwin"]);
  saveChangeset({ ...(getChangeset(id) ?? cs), pr: { number: pr.number, url: pr.url, title, dryRun: false } });
  return record("edit", { ...result, base, url: pr.url, number: pr.number, existing: Boolean(open) }) as EditPullRequestResult;
}

/* ------------------------------------------------------------------ code search */

const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|css|scss|html?|md|mdx|json|ya?ml|toml|liquid|vue|svelte|astro|txt|py|rb|go|php)$/i;

export interface CodeSearchResult {
  ok: boolean;
  mode: GithubMode;
  repo?: string;
  matches: { path: string; line?: number; text?: string }[];
  /** How the search ran: GitHub code search, or scanning files. */
  via?: "search-api" | "scan";
  truncated?: boolean;
  note?: string;
}

/**
 * Find text in the repo: GitHub code search (default branch), falling back to scanning up to 40 text files
 * (≤ 100 KB) whose paths look relevant. Case-insensitive; returns file, line number and the line.
 */
export async function searchRepoCode(opts: { repo?: string; query: string; path?: string; limit?: number }): Promise<CodeSearchResult> {
  const repo = resolveRepo(opts.repo);
  const mode = githubMode();
  if (!repo) return { ok: false, mode, matches: [], note: NO_REPO };
  const name = `${repo.owner}/${repo.repo}`;
  if (mode === "offline") return { ok: false, mode, repo: name, matches: [], note: "No GITHUB_TOKEN, so Darwin can't search the repository yet." };
  const query = opts.query.trim().slice(0, 120);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const gh = githubClient(mode);
  const prefix = opts.path?.trim().replace(/^\/+|\/+$/g, "");
  const target = await resolveBase(gh, repo);
  const tree = await gh.getTree(repo.owner, repo.repo, target.baseSha);
  const candidates = tree.entries
    .filter((e) => e.type === "blob" && TEXT_EXT.test(e.path) && (e.size ?? 0) <= 100_000 && (!prefix || e.path.startsWith(`${prefix}/`) || e.path === prefix))
    .filter((e) => !/(^|\/)(node_modules|dist|build|\.next|vendor)\//.test(e.path) && !/lock\.(json|yaml)$|\.lock$/.test(e.path));
  const needle = query.toLowerCase();
  const matches: CodeSearchResult["matches"] = candidates.filter((e) => e.path.toLowerCase().includes(needle)).map((e) => ({ path: e.path }));
  // Prefer GitHub's index for content matches; fall back to scanning likely files.
  let via: CodeSearchResult["via"] = "scan";
  try {
    const q = encodeURIComponent(`${query} repo:${target.fullName}${prefix ? ` path:${prefix}` : ""}`);
    const res = await gh.request<{ items: { path: string }[] }>("GET", `/search/code?q=${q}&per_page=${limit}`);
    const paths = res.items.map((i) => i.path).filter((p) => candidates.some((c) => c.path === p));
    for (const p of paths.slice(0, 10)) {
      const f = await gh.getFileContent(repo.owner, repo.repo, p, target.baseSha);
      f?.content.split("\n").forEach((l, k) => {
        if (matches.length < limit && l.toLowerCase().includes(needle)) matches.push({ path: p, line: k + 1, text: l.trim().slice(0, 200) });
      });
    }
    via = "search-api";
  } catch {
    const ranked = [...candidates].sort((a, b) => Number(/src|app|components|pages|theme|templates/.test(b.path)) - Number(/src|app|components|pages|theme|templates/.test(a.path))).slice(0, 40);
    for (const e of ranked) {
      if (matches.length >= limit) break;
      const f = await gh.getFileContent(repo.owner, repo.repo, e.path, target.baseSha).catch(() => null);
      f?.content.split("\n").forEach((l, k) => {
        if (matches.length < limit && l.toLowerCase().includes(needle)) matches.push({ path: e.path, line: k + 1, text: l.trim().slice(0, 200) });
      });
    }
  }
  return { ok: true, mode, repo: target.fullName, matches: matches.slice(0, limit), via, truncated: matches.length >= limit };
}
