/**
 * GitHub integration — public API. OWNED BY: github PR. Keep these signatures stable.
 *
 *   openAnalyticsInstallPR  onboarding: PR that adds darwin.js to the merchant's storefront
 *   openSpecPR              ship: PR that makes a winning PageSpec the committed baseline
 *   connectRepository       parse a repo URL, open the install PR, remember the connection
 *   shipWinningSpec         pick the experiment + spec to ship, then openSpecPR
 *   getGithubStatus         what the console shows (mode, repo, framework, recent PRs)
 *
 * Modes (see githubMode()):
 *   offline  — no GITHUB_TOKEN: no network at all; returns the would-be PR (files + body).
 *   dry-run  — GITHUB_TOKEN + DARWIN_GITHUB_DRY_RUN=1: reads the repo, never writes.
 *   live     — GITHUB_TOKEN: creates the branch, commits via the Git Data API, opens the PR.
 * Every call is idempotent: an open PR for the same branch is updated, never duplicated.
 */
import { ZodError } from "zod";
import {
  PageSpecSchema,
  type ChangeProposal,
  type Experiment,
  type Insight,
  type PageSpec,
} from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { getExperiment, listExperiments } from "@/lib/experiments/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { describeDiff } from "@/lib/spec/patch";
import { getLiveSpec, getSpecVersion } from "@/lib/spec/store";
import { GitHubClient, GitHubError, parseRepoUrl, type FileChange, type RepoCoordinates } from "./client";
import {
  INSTALL_BRANCH,
  INSTALL_TITLE,
  REPRESENTATIVE_LAYOUT,
  assumedDetection,
  buildInstallPrBody,
  detectFramework,
  manualDocPath,
  planInstall,
  type FrameworkDetection,
} from "./install";
import {
  DEFAULT_CONFIG_PATH,
  buildSpecPrBody,
  changeDescription,
  defaultShipSummary,
  specBranchName,
  specGeneration,
  specPrTitle,
  type TrafficMix,
} from "./spec-pr";
import {
  getConnection,
  listPullRequests,
  recordPullRequest,
  saveConnection,
  type GithubConnection,
  type GithubMode,
  type PullRequestRecord,
} from "./store";

export { GitHubClient, GitHubError, parseRepoUrl } from "./client";
export { detectFramework, planInstall, type Framework, type FrameworkDetection } from "./install";
export type { TrafficMix } from "./spec-pr";
export type { GithubConnection, GithubMode, PullRequestRecord } from "./store";

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

/** Optional extras beyond `{ experiment, summary }` make the PR body richer. */
export interface SpecPRContext {
  experiment?: Experiment;
  /** Plain-language summary for the top of the PR. Empty → generated from the experiment. */
  summary: string;
  /** The proposal the experiment tested (hypothesis, source). */
  proposal?: ChangeProposal;
  /** Insights that motivated the proposal. */
  insights?: Insight[];
  /** Loop generation number, if different from the spec version. */
  generation?: number;
  /** Spec the control arm served. Default: spec store version `experiment.controlVersion`. */
  previousSpec?: PageSpec;
  /** Override the synthetic/real event mix (default: counted from the event store). */
  traffic?: TrafficMix;
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

/* ------------------------------------------------------------------ config */

export function githubMode(): GithubMode {
  if (!process.env.GITHUB_TOKEN?.trim()) return "offline";
  return /^(1|true|yes|on)$/i.test(process.env.DARWIN_GITHUB_DRY_RUN?.trim() ?? "") ? "dry-run" : "live";
}

export function targetConfigPath(): string {
  return process.env.DARWIN_TARGET_CONFIG_PATH?.trim() || DEFAULT_CONFIG_PATH;
}

/** Stable, readable site id per repo: "acme-storefront". */
export function siteIdFor(repo: RepoCoordinates): string {
  return `${repo.owner}-${repo.repo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** "darwin.example.com/" → "https://darwin.example.com". */
export function normalizeHost(host: string): string {
  const h = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
}

/** Darwin's public origin for the script tag: DARWIN_PUBLIC_URL, else the request's (forwarded) origin. */
export function publicOrigin(req: Request): string {
  const configured = process.env.DARWIN_PUBLIC_URL?.trim();
  if (configured) return normalizeHost(configured);
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** Repo PRs go to: the connected repo, else DARWIN_TARGET_REPO. */
export function getTargetRepo(): RepoRef | undefined {
  const conn = getConnection();
  if (conn) return { owner: conn.owner, repo: conn.name, base: conn.base };
  const env = process.env.DARWIN_TARGET_REPO?.trim();
  const parsed = env ? parseRepoUrl(env) : null;
  return parsed ?? undefined;
}

function githubClient(mode: GithubMode): GitHubClient {
  return new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim(), readOnly: mode !== "live" });
}

/* ------------------------------------------------------------------ shared PR plumbing */

async function resolveBase(gh: GitHubClient, repo: RepoRef) {
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
async function publish(
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

function record(kind: PullRequestRecord["kind"], result: PullRequestResult, extra: Partial<PullRequestRecord> = {}) {
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

/* ------------------------------------------------------------------ install PR */

/** Onboarding: open a PR that installs Darwin analytics into the connected storefront repo. */
export async function openAnalyticsInstallPR(repo: RepoRef, opts: { host: string; siteId?: string }): Promise<PullRequestResult> {
  const mode = githubMode();
  const fullName = `${repo.owner}/${repo.repo}`;
  const snippet = { src: `${normalizeHost(opts.host)}/darwin.js`, siteId: opts.siteId ?? siteIdFor(repo) };
  const commitMessage = `Install Darwin analytics\n\nLoads darwin.js (site id "${snippet.siteId}") to measure how human shoppers and AI shopping agents use the store.`;

  if (mode === "offline") {
    const detection = assumedDetection();
    const plan = planInstall(detection, { [detection.targets[0]]: REPRESENTATIVE_LAYOUT }, snippet);
    return record("install", {
      dryRun: true,
      branch: INSTALL_BRANCH,
      title: INSTALL_TITLE,
      body: buildInstallPrBody({ repo: fullName, detection, plan, snippet, mode }),
      files: plan.files,
      repo: fullName,
      base: repo.base,
      detection,
      notes: [
        "Dry run: GITHUB_TOKEN is not set, so the repository was not read and no PR was opened.",
        `Assumed ${detection.label} with ${detection.targets[0]} (representative layout).`,
      ],
    });
  }

  const gh = githubClient(mode);
  const { base, baseSha, fullName: canonical } = await resolveBase(gh, repo);
  const tree = await gh.getTree(repo.owner, repo.repo, baseSha);
  const detection = detectFramework(tree.entries.filter((e) => e.type === "blob").map((e) => e.path));

  const sources: Record<string, string | undefined> = {};
  for (const path of detection.targets) {
    sources[path] = (await gh.getFileContent(repo.owner, repo.repo, path, baseSha))?.content;
  }
  let plan = planInstall(detection, sources, snippet);
  const docPath = manualDocPath(detection);
  if (plan.manual && !(docPath in sources)) {
    sources[docPath] = (await gh.getFileContent(repo.owner, repo.repo, docPath, baseSha))?.content;
    plan = planInstall(detection, sources, snippet);
  }

  const notes: string[] = [`Detected ${detection.label}${detection.root ? ` in ${detection.root}/` : ""}.`];
  if (tree.truncated) notes.push("GitHub truncated the repository tree; detection used a partial file list.");
  if (plan.manual) notes.push("Could not inject automatically; the PR adds DARWIN.md with manual instructions.");

  const result: PullRequestResult = {
    dryRun: mode !== "live",
    branch: INSTALL_BRANCH,
    title: INSTALL_TITLE,
    body: buildInstallPrBody({ repo: canonical, detection, plan, snippet, mode }),
    files: plan.files,
    repo: canonical,
    base,
    detection,
    notes,
  };

  if (!plan.files.length) {
    notes.push(`darwin.js is already loaded (${plan.alreadyInstalled.join(", ")}); no PR needed.`);
    return record("install", { ...result, upToDate: true });
  }
  if (mode === "dry-run") {
    notes.push("Dry run (DARWIN_GITHUB_DRY_RUN=1): the repository was read but no branch or PR was created.");
    return record("install", result);
  }

  const pr = await publish(gh, repo, { base, baseSha }, {
    branch: INSTALL_BRANCH,
    title: INSTALL_TITLE,
    body: result.body,
    files: plan.files,
    commitMessage,
    labels: ["darwin", "analytics"],
  });
  if (pr.existing) notes.push(`Updated the existing open PR #${pr.number} instead of opening a duplicate.`);
  return record("install", { ...result, url: pr.url, number: pr.number, existing: pr.existing });
}

/* ------------------------------------------------------------------ spec PR */

/** Count events attributed to an experiment and how many were simulated. */
export function experimentTraffic(experimentId: string): TrafficMix {
  let events = 0;
  let synthetic = 0;
  for (const e of eventStore().all()) {
    if (e.properties.experiment_id !== experimentId) continue;
    events++;
    if (e.properties.synthetic === true) synthetic++;
  }
  return { events, synthetic };
}

function parseSpec(content: string): PageSpec | null {
  try {
    const r = PageSpecSchema.safeParse(JSON.parse(content));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Ship: open a PR that makes the winning spec the new storefront config. */
export async function openSpecPR(repo: RepoRef, spec: PageSpec, ctx: SpecPRContext): Promise<PullRequestResult> {
  const mode = githubMode();
  const configPath = targetConfigPath();
  const fullName = `${repo.owner}/${repo.repo}`;
  const next = PageSpecSchema.parse(spec); // never commit an invalid config
  const content = `${JSON.stringify(next, null, 2)}\n`;
  const { experiment, proposal } = ctx;
  const naming = { experiment, proposal, generation: ctx.generation };
  const previous =
    ctx.previousSpec ??
    (experiment ? getSpecVersion(experiment.controlVersion) : undefined) ??
    getSpecVersion(next.version - 1) ??
    DEFAULT_SPEC;
  const traffic = ctx.traffic ?? (experiment ? experimentTraffic(experiment.id) : undefined);
  const summary = ctx.summary?.trim() || defaultShipSummary(experiment, next);
  const branch = specBranchName(next, naming);
  const title = specPrTitle(next, naming);
  const bodyFor = (current: PageSpec | null | undefined, m: GithubMode) =>
    buildSpecPrBody({
      repo: fullName,
      spec: next,
      previous,
      current,
      experiment,
      proposal,
      insights: ctx.insights,
      summary,
      traffic,
      configPath,
      generation: ctx.generation,
      mode: m,
    });
  const r = experiment?.result;
  const commitMessage = [
    `Darwin Gen ${specGeneration(next, ctx.generation)}: ${changeDescription(next, experiment, proposal)}`,
    "",
    experiment
      ? `Experiment ${experiment.id}${r ? `: ${r.lift >= 0 ? "+" : ""}${(r.lift * 100).toFixed(1)}% conversion, P(better) = ${r.probabilityToBeat.toFixed(2)}` : ""}.`
      : `Promotes storefront spec v${next.version}.`,
  ].join("\n");
  const recordExtra = { experimentId: experiment?.id, specVersion: next.version };
  const files = [{ path: configPath, content }];

  if (mode === "offline") {
    return record(
      "spec",
      {
        dryRun: true,
        branch,
        title,
        body: bodyFor(undefined, mode),
        files,
        repo: fullName,
        base: repo.base,
        notes: ["Dry run: GITHUB_TOKEN is not set, so no branch or PR was created."],
      },
      recordExtra,
    );
  }

  const gh = githubClient(mode);
  const { base, baseSha, fullName: canonical } = await resolveBase(gh, repo);
  const file = await gh.getFileContent(repo.owner, repo.repo, configPath, baseSha);
  const current = file ? parseSpec(file.content) : null;
  const notes: string[] = [];
  if (!file) notes.push(`${configPath} does not exist on ${base}; this PR creates it.`);
  else if (!current) notes.push(`${configPath} on ${base} is not a valid PageSpec; this PR replaces it.`);

  const result: PullRequestResult = {
    dryRun: mode !== "live",
    branch,
    title,
    body: bodyFor(current, mode),
    files,
    repo: canonical,
    base,
    notes,
  };

  const sameSpec = current !== null && describeDiff(current, next).length === 0 && current.version === next.version;
  if (file?.content === content || sameSpec) {
    notes.push(`${configPath} on ${base} already contains spec v${next.version}; no PR needed.`);
    return record("spec", { ...result, upToDate: true }, recordExtra);
  }
  if (mode === "dry-run") {
    notes.push("Dry run (DARWIN_GITHUB_DRY_RUN=1): the repository was read but no branch or PR was created.");
    return record("spec", result, recordExtra);
  }

  const pr = await publish(gh, repo, { base, baseSha }, {
    branch,
    title,
    body: result.body,
    files,
    commitMessage,
    labels: ["darwin", "experiment-winner"],
  });
  if (pr.existing) notes.push(`Updated the existing open PR #${pr.number} instead of opening a duplicate.`);
  return record("spec", { ...result, url: pr.url, number: pr.number, existing: pr.existing }, recordExtra);
}

/* ------------------------------------------------------------------ higher-level helpers for routes / optimizer */

/** Parse a repo URL, open the install PR, and remember the repo as connected. */
export async function connectRepository(repoUrl: string, opts: { host: string; base?: string }): Promise<PullRequestResult> {
  const coords = parseRepoUrl(repoUrl);
  if (!coords) {
    throw new GithubIntegrationError(`"${repoUrl}" is not a GitHub repository. Use https://github.com/owner/repo or owner/repo.`, 400);
  }
  const repo: RepoRef = { ...coords, base: opts.base };
  const siteId = siteIdFor(coords);
  const host = normalizeHost(opts.host);
  const result = await openAnalyticsInstallPR(repo, { host, siteId });
  const detection = result.detection ?? assumedDetection();
  const [owner, name] = (result.repo ?? `${coords.owner}/${coords.repo}`).split("/");
  saveConnection({
    repo: `${owner}/${name}`,
    owner,
    name,
    base: result.base ?? opts.base,
    host,
    siteId,
    framework: detection.framework,
    frameworkLabel: detection.label,
    root: detection.root,
    targets: detection.targets,
    assumed: detection.assumed,
    mode: githubMode(),
    connectedAt: new Date().toISOString(),
    installPr: listPullRequests().find((p) => p.kind === "install" && p.repo === result.repo),
  });
  return result;
}

/** Latest completed experiment, preferring ones the optimizer decided to ship. */
export function latestShippableExperiment(): Experiment | undefined {
  const done = listExperiments()
    .filter((e) => e.status === "completed")
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  return done.find((e) => e.result?.decision === "ship") ?? done[0];
}

/** The spec an experiment produced: the live spec if it's the promoted treatment, else the treatment itself. */
export function specForExperiment(experiment: Experiment): PageSpec {
  const same = (s: PageSpec | undefined) => !!s && describeDiff(s, experiment.treatmentSpec).length === 0;
  const live = getLiveSpec();
  if (live.version > experiment.controlVersion && same(live)) return live;
  const promoted = getSpecVersion(experiment.controlVersion + 1);
  if (same(promoted)) return promoted!;
  return { ...experiment.treatmentSpec, version: Math.max(experiment.treatmentSpec.version, experiment.controlVersion + 1) };
}

/**
 * Open the "ship the winner" PR for an experiment (default: the latest completed one)
 * against the connected repo (or DARWIN_TARGET_REPO).
 */
export async function shipWinningSpec(
  opts: { experimentId?: string; repo?: RepoRef } & Partial<Omit<SpecPRContext, "experiment">> = {},
): Promise<PullRequestResult> {
  const repo = opts.repo ?? getTargetRepo();
  if (!repo) {
    throw new GithubIntegrationError("No repository connected. POST /api/github/connect first, or set DARWIN_TARGET_REPO.", 412);
  }
  const experiment = opts.experimentId ? getExperiment(opts.experimentId) : latestShippableExperiment();
  if (opts.experimentId && !experiment) throw new GithubIntegrationError(`Experiment ${opts.experimentId} not found.`, 404);
  if (experiment && experiment.status === "running") {
    throw new GithubIntegrationError(`Experiment ${experiment.id} is still running; wait for a decision before shipping.`, 409);
  }

  const spec = experiment ? specForExperiment(experiment) : getLiveSpec();
  if (!experiment && spec.version === 0) {
    throw new GithubIntegrationError("Nothing to ship yet: no completed experiment and the live spec is still the baseline.", 409);
  }
  return openSpecPR(repo, spec, {
    experiment,
    summary: opts.summary ?? "",
    proposal: opts.proposal,
    insights: opts.insights,
    generation: opts.generation,
    previousSpec: opts.previousSpec,
    traffic: opts.traffic,
  });
}

export interface GithubStatus {
  /** GITHUB_TOKEN is set. */
  configured: boolean;
  /** Connected repo, else DARWIN_TARGET_REPO ("owner/repo"). */
  repo?: string;
  mode: GithubMode;
  dryRun: boolean;
  targetConfigPath: string;
  connection?: GithubConnection;
  framework?: string;
  recentPullRequests: PullRequestRecord[];
}

export function getGithubStatus(): GithubStatus {
  const mode = githubMode();
  const connection = getConnection();
  const target = getTargetRepo();
  return {
    configured: mode !== "offline",
    repo: connection?.repo ?? (target ? `${target.owner}/${target.repo}` : undefined),
    mode,
    dryRun: mode !== "live",
    targetConfigPath: targetConfigPath(),
    connection,
    framework: connection?.frameworkLabel,
    recentPullRequests: listPullRequests(),
  };
}

/** Map any error from this module to an HTTP status + message. */
export function githubErrorStatus(err: unknown): { status: number; error: string } {
  if (err instanceof GithubIntegrationError) return { status: err.status, error: err.message };
  if (err instanceof GitHubError) {
    const status = err.rateLimited ? 429 : err.status === 404 ? 404 : err.status === 401 || err.status === 403 ? 403 : err.status === 422 ? 422 : 502;
    return { status, error: err.message };
  }
  if (err instanceof ZodError) {
    return { status: 422, error: `Invalid spec: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { status: 500, error: err instanceof Error ? err.message : String(err) };
}
