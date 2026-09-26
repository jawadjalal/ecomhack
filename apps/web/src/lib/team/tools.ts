/**
 * Per-agent tool registries for the team. Every tool wraps another area's PUBLIC API (the assistant's TOOLS,
 * lib/github, lib/web, lib/store-agent) — no deep imports, no invented numbers.
 *
 * Tools marked `confirm` change the store, the live site or a repo: the orchestrator turns a call into a
 * `confirm` chat message and runs it only after the merchant approves.
 */
import { z } from "zod";
import type { AgentId, TeamPendingConfirm } from "@/lib/contracts";
import {
  confirmPromptFor,
  getTool,
  precheckFor,
  runTool,
  type ToolContext,
  type ToolName,
  type ToolOutcome,
} from "@/lib/assistant/tools";
import {
  commitChangeset,
  createWorkBranch,
  discardChangeset,
  getChangeset,
  getGithubStatus,
  githubErrorStatus,
  listRepoFiles,
  mergePullRequest,
  openChangesetPR,
  pullRequestStatus,
  readRepoFile,
  searchRepoCode,
  stageFileEdits,
  stageFileWrite,
  summarizeChangeset,
} from "@/lib/github";
import {
  DEMO_SITE,
  createRule,
  draftRule,
  getRule,
  listRules,
  siteUrl,
  updateRule,
  webState,
  WebRulePatchSchema,
} from "@/lib/web";
import { agentFunnel, agentTestsView, stepAgentTests } from "@/lib/store-agent";
import { eventStore } from "@/lib/analytics/store";

/* ------------------------------------------------------------------ types */

export interface TeamToolContext extends ToolContext {
  agent: AgentId;
  /** Pixel's staged code changes for this conversation (lib/github changeset id). */
  changesetId: string;
}

export interface TeamToolOutcome extends ToolOutcome {
  /** In-app page to open (the orchestrator emits a `navigate` event). */
  navigate?: string;
}

export interface TeamTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  args: S;
  /** Needs the merchant's OK before running (boolean, or decided per call). */
  confirm?: boolean | ((args: z.infer<S>, ctx: TeamToolContext) => boolean);
  confirmPrompt?: (args: z.infer<S>, ctx: TeamToolContext) => string;
  /** Code diff to show with the confirm (changeset tools). */
  confirmDiff?: (args: z.infer<S>, ctx: TeamToolContext) => TeamPendingConfirm["diff"];
  /** Why a confirm-required call can't run right now (checked before asking). */
  precheck?: (args: z.infer<S>, ctx: TeamToolContext) => string | undefined;
  run: (args: z.infer<S>, ctx: TeamToolContext) => Promise<TeamToolOutcome>;
}

function tool<S extends z.ZodType>(t: TeamTool<S>): TeamTool {
  return t as unknown as TeamTool;
}

const errText = (err: unknown) => {
  try {
    return githubErrorStatus(err).error;
  } catch {
    return err instanceof Error ? err.message : String(err);
  }
};

/* ------------------------------------------------------------------ wrappers over the assistant's tools */

/** One of the assistant's tools, as a team tool (same args, confirm flag, precheck and run). */
function wrap(name: ToolName, description?: string): TeamTool {
  const t = getTool(name)!;
  return {
    name,
    description: description ?? t.description,
    args: t.args,
    confirm: t.requiresConfirm,
    confirmPrompt: (args) => confirmPromptFor(name, args)?.prompt ?? `Run ${name}?`,
    precheck: (args) => precheckFor(name, args),
    run: async (args, ctx) => {
      const { args: _args, ...out } = await runTool(name, args, ctx);
      void _args;
      return out;
    },
  };
}

/* ------------------------------------------------------------------ navigation */

/** In-app pages an agent may open for the merchant. */
export const NAV_PAGES: Record<string, string> = {
  "/console": "Mission control",
  "/console/dashboards": "Dashboards",
  "/console/personalize": "Personalize",
  "/console/research": "Research",
  "/console/agents": "Store agent",
  "/console/traffic": "Traffic",
  "/onboarding": "Onboarding",
  "/readiness": "Agent readiness",
  "/store": "Storefront",
  "/demo/north-trail": "Demo store",
};

/** Allowed in-app href (path + optional query/hash), or undefined. */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  if (!h.startsWith("/") || h.startsWith("//") || /[\s\\<>"']/.test(h) || h.length > 300) return undefined;
  const path = h.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const ok = Object.keys(NAV_PAGES).some((p) => path === p || path.startsWith(`${p}/`));
  return ok ? h : undefined;
}

const navigate = tool({
  name: "navigate",
  description: `Open a page of the app for the merchant (the UI switches to it). Allowed: ${Object.entries(NAV_PAGES)
    .map(([p, l]) => `${p} (${l})`)
    .join(", ")}. Query strings allowed, e.g. /console/dashboards?site=acme.`,
  args: z.object({ href: z.string().trim().min(1).max(300) }),
  async run({ href }) {
    const safe = safeHref(href);
    if (!safe) return { ok: false, summary: `Can't open “${href.slice(0, 80)}”: not a page of the app.` };
    const label = NAV_PAGES[safe.split(/[?#]/)[0].replace(/\/+$/, "")] ?? "page";
    return { ok: true, summary: `Opened ${label}.`, navigate: safe, link: { label: `Open ${label}`, href: safe } };
  },
});

/* ------------------------------------------------------------------ Pixel: live site (darwin.js personalization) */

const SiteArg = z
  .string()
  .regex(/^[\w.-]{1,64}$/)
  .optional()
  .describe("darwin.js site id (default: the one the merchant is looking at, else the demo store)");

const pickSite = (site: string | undefined, ctx: TeamToolContext) => site || ctx.site || DEMO_SITE;

function previewHref(site: string, ruleId: string, ctx: TeamToolContext): string | undefined {
  const url = siteUrl(site, ctx.origin ?? "", webState(site).overview.url);
  if (!url) return undefined;
  const sep = url.includes("?") ? "&" : "?";
  const full = `${url}${sep}darwin_preview=${encodeURIComponent(ruleId)}`;
  const origin = ctx.origin ?? "";
  return origin && full.startsWith(origin) ? full.slice(origin.length) || "/" : full;
}

const listWebRules = tool({
  name: "list_web_rules",
  description: "List the live-site personalization rules/tests for a site (id, name, status, mode, changes).",
  args: z.object({ site: SiteArg }),
  async run({ site }, ctx) {
    const s = pickSite(site, ctx);
    const rules = listRules(s);
    return {
      ok: true,
      summary: rules.length
        ? `${rules.length} rule${rules.length === 1 ? "" : "s"} on ${s}: ${rules
            .slice(0, 4)
            .map((r) => `“${r.name}” (${r.status})`)
            .join(", ")}.`
        : `No rules on ${s} yet.`,
      link: { label: "Open Personalize", href: `/console/personalize?site=${encodeURIComponent(s)}` },
      data: rules.slice(0, 12).map((r) => ({ id: r.id, name: r.name, status: r.status, mode: r.mode, audience: r.audience, changes: r.changes })),
    };
  },
});

const draftWebRule = tool({
  name: "draft_web_rule",
  description:
    "Draft a live-site change from plain English (e.g. 'show a free-returns banner to visitors from Google', 'change the hero headline to …'). Saves it as a DRAFT rule (not live) and returns a preview link.",
  args: z.object({ request: z.string().trim().min(3).max(600), site: SiteArg }),
  async run({ request, site }, ctx) {
    const s = pickSite(site, ctx);
    try {
      const url = siteUrl(s, ctx.origin ?? "", webState(s).overview.url);
      const draft = await draftRule(s, request, { url });
      const rule = createRule(draft.rule, "draft");
      const preview = previewHref(s, rule.id, ctx);
      return {
        ok: true,
        summary: `Drafted “${rule.name}” on ${s} (draft, not live): ${rule.changes.length} change${rule.changes.length === 1 ? "" : "s"}.`,
        link: preview ? { label: "Preview", href: preview } : { label: "Open Personalize", href: `/console/personalize?site=${encodeURIComponent(s)}` },
        data: { id: rule.id, name: rule.name, hypothesis: rule.hypothesis, audience: rule.audience, changes: rule.changes, mode: rule.mode, source: draft.source },
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't draft that change: ${errText(err)}` };
    }
  },
});

const isLive = (ruleId: string) => {
  const r = getRule(ruleId);
  return r?.status === "running" || r?.status === "shipped";
};

const updateWebRule = tool({
  name: "update_web_rule",
  description:
    "Edit a live-site rule's name, hypothesis, changes or test allocation. Draft rules change freely; editing a live rule asks the merchant first. Tests that already ran are locked.",
  args: z.object({
    ruleId: z.string().min(1).max(60),
    name: WebRulePatchSchema.shape.name,
    hypothesis: WebRulePatchSchema.shape.hypothesis,
    changes: WebRulePatchSchema.shape.changes,
    allocation: WebRulePatchSchema.shape.allocation,
  }),
  confirm: ({ ruleId }) => isLive(ruleId),
  confirmPrompt: ({ ruleId }) => `Change the live rule “${getRule(ruleId)?.name ?? ruleId}”? Visitors will see the new version.`,
  precheck: ({ ruleId }) => (getRule(ruleId) ? undefined : `Rule ${ruleId} doesn't exist.`),
  async run({ ruleId, ...patch }) {
    try {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const r = updateRule(ruleId, clean);
      return { ok: true, summary: `Updated “${r.name}” (${r.status}).`, data: { id: r.id, status: r.status, changes: r.changes } };
    } catch (err) {
      return { ok: false, summary: `Couldn't update the rule: ${errText(err)}` };
    }
  },
});

const setWebRuleStatus = tool({
  name: "set_web_rule_status",
  description:
    "Launch, pause or ship a live-site rule: running = start the A/B test (or personalization), shipped = everyone in the audience gets it, paused = off. Launching or shipping asks the merchant first.",
  args: z.object({ ruleId: z.string().min(1).max(60), status: z.enum(["running", "paused", "shipped"]) }),
  confirm: ({ status }) => status !== "paused",
  confirmPrompt: ({ ruleId, status }) =>
    `${status === "shipped" ? "Ship" : "Launch"} “${getRule(ruleId)?.name ?? ruleId}” on the live site${status === "running" ? " as an A/B test" : " to everyone in its audience"}?`,
  precheck: ({ ruleId }) => (getRule(ruleId) ? undefined : `Rule ${ruleId} doesn't exist.`),
  async run({ ruleId, status }, ctx) {
    try {
      const r = updateRule(ruleId, { status });
      const preview = previewHref(r.site, r.id, ctx);
      return {
        ok: true,
        summary: `“${r.name}” is now ${r.status}.`,
        link: preview ? { label: "Preview", href: preview } : undefined,
        data: { id: r.id, status: r.status },
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't change the rule: ${errText(err)}` };
    }
  },
});

const previewLink = tool({
  name: "preview_link",
  description: "A link that previews a live-site rule's changes on the real page (only for you, not visitors).",
  args: z.object({ ruleId: z.string().min(1).max(60) }),
  async run({ ruleId }, ctx) {
    const r = getRule(ruleId);
    if (!r) return { ok: false, summary: `Rule ${ruleId} doesn't exist.` };
    const href = previewHref(r.site, r.id, ctx);
    return href
      ? { ok: true, summary: `Preview of “${r.name}” is ready.`, link: { label: "Preview", href } }
      : { ok: false, summary: `No page seen for ${r.site} yet, so there's nothing to preview on.` };
  },
});

/* ------------------------------------------------------------------ Pixel: code (GitHub repo) */

const RepoArg = z.string().trim().max(140).optional().describe("owner/repo (default: the connected repo)");
const PathArg = z.string().trim().min(1).max(300).describe("Repo-relative path, e.g. src/app/page.tsx");

function diffFor(ctx: TeamToolContext): TeamPendingConfirm["diff"] {
  const cs = getChangeset(ctx.changesetId);
  if (!cs) return undefined;
  return summarizeChangeset(cs)
    .files.filter((f) => !f.committed)
    .map((f) => ({ path: f.path, created: f.created, added: f.added, removed: f.removed, preview: f.preview.slice(0, 2500) }));
}

const changesText = (ctx: TeamToolContext) => {
  const cs = getChangeset(ctx.changesetId);
  return cs ? summarizeChangeset(cs).text : "No staged changes.";
};

const listFiles = tool({
  name: "list_files",
  description: "List files in the store's GitHub repo (optionally under a folder, at a branch/ref).",
  args: z.object({ path: z.string().trim().max(300).optional(), ref: z.string().trim().max(120).optional(), repo: RepoArg }),
  async run({ path, ref, repo }) {
    try {
      const r = await listRepoFiles({ path, ref, repo, limit: 300 });
      if (!r.ok) return { ok: false, summary: r.note ?? "Couldn't list files." };
      return {
        ok: true,
        summary: `${r.files.length}${r.truncated ? "+" : ""} files in ${r.repo}${path ? `/${path}` : ""}.`,
        data: { repo: r.repo, ref: r.ref, files: r.files, truncated: r.truncated },
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't list files: ${errText(err)}` };
    }
  },
});

const readFile = tool({
  name: "read_file",
  description:
    "Read a file from the repo (UTF-8, up to 20,000 characters). Read before editing: apply_edit needs the exact text. Staged (uncommitted) edits are not included; use view_changes for those.",
  args: z.object({ path: PathArg, ref: z.string().trim().max(120).optional(), repo: RepoArg }),
  async run({ path, ref, repo }) {
    try {
      const r = await readRepoFile({ path, ref, repo, maxChars: 20_000 });
      if (!r.ok) return { ok: false, summary: r.note ?? `Couldn't read ${path}.` };
      return {
        ok: true,
        summary: `Read ${r.path} (${r.content!.split("\n").length} lines${r.truncated ? ", truncated" : ""}).`,
        data: { path: r.path, ref: r.ref, truncated: r.truncated, content: r.content },
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't read ${path}: ${errText(err)}` };
    }
  },
});

const searchCode = tool({
  name: "search_code",
  description: "Search the repo for text (case-insensitive): returns matching files, line numbers and lines. Use it to find where a headline, component or style lives.",
  args: z.object({ query: z.string().trim().min(2).max(120), path: z.string().trim().max(300).optional(), repo: RepoArg }),
  async run({ query, path, repo }) {
    try {
      const r = await searchRepoCode({ query, path, repo, limit: 25 });
      if (!r.ok) return { ok: false, summary: r.note ?? "Search failed." };
      return {
        ok: true,
        summary: r.matches.length ? `${r.matches.length} match${r.matches.length === 1 ? "" : "es"} for “${query}”.` : `No matches for “${query}”.`,
        data: r,
      };
    } catch (err) {
      return { ok: false, summary: `Search failed: ${errText(err)}` };
    }
  },
});

const writeFile = tool({
  name: "write_file",
  description:
    "Stage a whole-file write (create a file or replace all of it). Nothing reaches GitHub until commit_changes / open_pr, which the merchant approves. Prefer apply_edit for small changes to existing files.",
  args: z.object({ path: PathArg, content: z.string().max(200_000), repo: RepoArg }),
  async run({ path, content, repo }, ctx) {
    try {
      const s = await stageFileWrite(ctx.changesetId, { path, content, repo });
      return { ok: true, summary: `Staged ${path}. Changes so far: ${s.text}`, data: { staged: s.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed })) } };
    } catch (err) {
      return { ok: false, summary: `Couldn't stage ${path}: ${errText(err)}` };
    }
  },
});

const applyEdit = tool({
  name: "apply_edit",
  description:
    "Stage exact-string replacements in one existing file, applied in order. Each `find` must match the current text exactly once (whitespace included) unless all=true; include a few surrounding lines to make it unique. Nothing reaches GitHub until the merchant approves a commit/PR.",
  args: z.object({
    path: PathArg,
    edits: z
      .array(
        z.object({
          find: z.string().min(1).max(20_000).describe("Exact existing text"),
          replace: z.string().max(20_000).describe("Replacement text"),
          all: z.boolean().optional().describe("Replace every occurrence"),
        }),
      )
      .min(1)
      .max(20),
    repo: RepoArg,
  }),
  async run({ path, edits, repo }, ctx) {
    try {
      const s = await stageFileEdits(ctx.changesetId, { path, edits, repo });
      const f = s.files.find((x) => x.path === path);
      return {
        ok: true,
        summary: `Staged ${edits.length} edit${edits.length === 1 ? "" : "s"} to ${path}${f ? ` (+${f.added} −${f.removed})` : ""}.`,
        data: { file: f, changes: s.text },
      };
    } catch (err) {
      return { ok: false, summary: `Edit not applied: ${errText(err)}` };
    }
  },
});

const viewChanges = tool({
  name: "view_changes",
  description: "Show the staged changeset: files, +/− line counts and a short diff of each.",
  args: z.object({}),
  async run(_args, ctx) {
    const cs = getChangeset(ctx.changesetId);
    if (!cs) return { ok: true, summary: "No staged changes.", data: { files: [] } };
    const s = summarizeChangeset(cs);
    return { ok: true, summary: s.text, data: { branch: s.branch, repo: s.repo, files: s.files.map((f) => ({ ...f, preview: f.preview.slice(0, 1500) })), pr: cs.pr } };
  },
});

const discardChanges = tool({
  name: "discard_changes",
  description: "Drop staged changes: one file (path) or everything.",
  args: z.object({ path: z.string().trim().max(300).optional() }),
  async run({ path }, ctx) {
    discardChangeset(ctx.changesetId, path);
    return { ok: true, summary: path ? `Dropped staged changes to ${path}.` : "Dropped all staged changes." };
  },
});

const createBranch = tool({
  name: "create_branch",
  description: "Name the working branch for the changes (always under darwin/, created from the base branch). Optional: commit_changes/open_pr pick a branch automatically.",
  args: z.object({ name: z.string().trim().min(1).max(60), repo: RepoArg }),
  async run({ name, repo }, ctx) {
    try {
      const r = await createWorkBranch(ctx.changesetId, { branch: name, repo });
      return { ok: true, summary: `${r.created ? "Created" : "Using"} branch ${r.branch}.${r.note ? ` ${r.note}` : ""}`, data: r };
    } catch (err) {
      return { ok: false, summary: `Couldn't create the branch: ${errText(err)}` };
    }
  },
});

const hasPending = (ctx: TeamToolContext) => {
  const cs = getChangeset(ctx.changesetId);
  return cs ? summarizeChangeset(cs).pending > 0 : false;
};

const commitChanges = tool({
  name: "commit_changes",
  description: "Commit ALL staged changes to the working branch in one commit. The merchant sees the diff and approves first.",
  args: z.object({ message: z.string().trim().min(3).max(200) }),
  confirm: true,
  confirmPrompt: ({ message }, ctx) => `Commit “${message}” to ${getChangeset(ctx.changesetId)?.branch ?? "a darwin/ branch"}? ${changesText(ctx)}`,
  confirmDiff: (_a, ctx) => diffFor(ctx),
  precheck: (_a, ctx) => (hasPending(ctx) ? undefined : "Nothing staged to commit: write or edit files first."),
  async run({ message }, ctx) {
    try {
      const r = await commitChangeset(ctx.changesetId, { message });
      return {
        ok: Boolean(r.commit),
        summary: r.commit ? `Committed ${r.commit.files.length} file(s) to ${r.summary.branch}${r.commit.sha ? ` (${r.commit.sha.slice(0, 7)})` : ""}.${r.note ? ` ${r.note}` : ""}` : (r.note ?? "Nothing to commit."),
        data: r,
      };
    } catch (err) {
      return { ok: false, summary: `Commit failed: ${errText(err)}` };
    }
  },
});

const openPr = tool({
  name: "open_pr",
  description: "Commit anything still staged and open (or update) a pull request from the working branch. The merchant sees the diff and approves first. Without a GitHub token this returns a preview.",
  args: z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().max(4000).optional() }),
  confirm: true,
  confirmPrompt: ({ title }, ctx) => `Open the pull request “${title}”? ${changesText(ctx)}`,
  confirmDiff: (_a, ctx) => diffFor(ctx),
  precheck: (_a, ctx) => {
    const cs = getChangeset(ctx.changesetId);
    return cs && Object.keys(cs.files).length ? undefined : "Nothing staged: write or edit files first.";
  },
  async run({ title, body }, ctx) {
    try {
      const pr = await openChangesetPR(ctx.changesetId, { title, body });
      const where = pr.url ? `PR #${pr.number} ${pr.existing ? "updated" : "opened"}` : "Dry run (no GitHub token): here's the PR Darwin would open";
      return {
        ok: true,
        summary: `${where}: “${pr.title}” on ${pr.repo} (${pr.preview.length} file${pr.preview.length === 1 ? "" : "s"}).`,
        link: pr.url ? { label: "Open PR", href: pr.url } : undefined,
        data: { url: pr.url, number: pr.number, branch: pr.branch, dryRun: pr.dryRun, preview: pr.preview, notes: pr.notes },
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't open the PR: ${errText(err)}` };
    }
  },
});

/* ------------------------------------------------------------------ PRs (Pixel + Dash) */

const prStatus = tool({
  name: "get_pr_status",
  description: "Status of a pull request: open/merged/closed, mergeable, CI checks, size. Default: Darwin's latest PR.",
  args: z.object({ number: z.number().int().positive().optional(), repo: RepoArg }),
  async run({ number, repo }) {
    try {
      const s = await pullRequestStatus({ number, repo });
      if (!s.ok) return { ok: false, summary: s.note ?? "No such PR." };
      const checks = s.checks ? `, checks ${s.checks.state}${s.checks.failing.length ? ` (failing: ${s.checks.failing.slice(0, 3).join(", ")})` : ""}` : "";
      return {
        ok: true,
        summary: s.state
          ? `PR #${s.number} “${s.title}” is ${s.state}${s.mergeable === false ? ", has conflicts" : ""}${checks}.`
          : `“${s.title}”: ${s.note ?? "recorded by Darwin"}`,
        link: s.url ? { label: "Open PR", href: s.url } : undefined,
        data: s,
      };
    } catch (err) {
      return { ok: false, summary: `Couldn't check the PR: ${errText(err)}` };
    }
  },
});

const mergePr = tool({
  name: "merge_pr",
  description: "Merge a pull request (squash by default). Refuses drafts, conflicts and failing checks. Always asks the merchant first.",
  args: z.object({ number: z.number().int().positive(), method: z.enum(["squash", "merge", "rebase"]).optional(), repo: RepoArg }),
  confirm: true,
  confirmPrompt: ({ number, method }) => `Merge PR #${number}${method && method !== "squash" ? ` (${method})` : ""}? This changes the store's main branch.`,
  async run({ number, method, repo }) {
    try {
      const r = await mergePullRequest({ number, method, repo });
      return { ok: r.ok, summary: r.merged ? `Merged PR #${r.number}${r.sha ? ` (${r.sha.slice(0, 7)})` : ""}.` : r.message, link: r.url ? { label: "Open PR", href: r.url } : undefined, data: r };
    } catch (err) {
      return { ok: false, summary: `Couldn't merge: ${errText(err)}` };
    }
  },
});

const listPrs = tool({
  name: "list_prs",
  description: "Pull requests Darwin opened (install, ship-the-winner, code edits), newest first, and the GitHub mode (live / dry-run / offline).",
  args: z.object({}),
  async run() {
    const s = getGithubStatus();
    const prs = s.recentPullRequests;
    return {
      ok: true,
      summary: `${s.repo ? `Repo ${s.repo}` : "No repo connected"} (${s.mode}). ${prs.length ? prs.slice(0, 3).map((p) => `${p.number ? `#${p.number} ` : ""}“${p.title}”${p.dryRun ? " (dry run)" : ""}`).join("; ") : "No PRs yet."}`,
      data: { repo: s.repo, mode: s.mode, prs: prs.slice(0, 10) },
    };
  },
});

/* ------------------------------------------------------------------ Fizz: store agent pitch tests */

const agentTests = tool({
  name: "agent_tests",
  description: "A/B tests on the store agent's pitch (what it tells buyer agents): running test, arms, conversion, shipped levers.",
  args: z.object({}),
  async run() {
    const { state, results } = agentTestsView(eventStore().all());
    const rows = results.map((r) => ({ ...r, test: state.tests.find((t) => t.id === r.testId) }));
    const running = rows.find((r) => r.test?.status === "running") ?? rows[0];
    const label = (r: (typeof rows)[number]) => `“${r.test?.lever ?? r.testId}” (${r.test?.status ?? "unknown"})`;
    return {
      ok: true,
      summary: rows.length
        ? `${rows.length} pitch test${rows.length === 1 ? "" : "s"}. ${running ? `${label(running)}: control ${running.control.paid}/${running.control.conversations} paid, treatment ${running.treatment.paid}/${running.treatment.conversations}.` : ""}`
        : "No pitch tests yet: step the agent tests to start one.",
      link: { label: "Open store agent", href: "/console/agents" },
      // Pitch tests count buyer-agent conversations; say "simulated" when any of them were simulated buyers.
      synthetic: agentFunnel(eventStore().all()).simulated > 0,
      data: {
        levers: state.levers,
        autopilot: state.autopilot,
        results: rows.slice(0, 4).map((r) => ({ lever: r.test?.lever, status: r.test?.status, control: r.control, treatment: r.treatment, probabilityToBeat: r.probabilityToBeat, lift: r.lift })),
      },
    };
  },
});

const stepAgentTestsTool = tool({
  name: "step_agent_tests",
  description: "Advance the store agent's pitch tests one step (start the next test, or decide the running one).",
  args: z.object({}),
  async run() {
    const log = stepAgentTests(eventStore().all());
    return { ok: true, summary: log.length ? log.join(" ") : "Nothing to do yet: the running test needs more conversations.", data: { log } };
  },
});

/* ------------------------------------------------------------------ registries */

export const TEAM_TOOLS = {
  navigate,
  // assistant tools
  get_kpis: wrap("get_kpis"),
  loop_status: wrap("loop_status"),
  step_loop: wrap("step_loop"),
  set_autopilot: wrap("set_autopilot"),
  reset_loop: wrap("reset_loop"),
  list_experiments: wrap("list_experiments"),
  ship_winner: wrap("ship_winner"),
  list_dashboards: wrap("list_dashboards"),
  add_chart: wrap("add_chart"),
  suggest_web_rules: wrap("suggest_web_rules"),
  run_simulation: wrap("run_simulation"),
  audit_readiness: wrap("audit_readiness"),
  certify_store: wrap("certify_store"),
  send_test_shopper: wrap("send_test_shopper"),
  research_competitors: wrap("research_competitors"),
  agent_funnel: wrap("agent_funnel"),
  // live site
  list_web_rules: listWebRules,
  draft_web_rule: draftWebRule,
  update_web_rule: updateWebRule,
  set_web_rule_status: setWebRuleStatus,
  preview_link: previewLink,
  // code
  list_files: listFiles,
  read_file: readFile,
  search_code: searchCode,
  write_file: writeFile,
  apply_edit: applyEdit,
  view_changes: viewChanges,
  discard_changes: discardChanges,
  create_branch: createBranch,
  commit_changes: commitChanges,
  open_pr: openPr,
  get_pr_status: prStatus,
  merge_pr: mergePr,
  list_prs: listPrs,
  // store agent
  agent_tests: agentTests,
  step_agent_tests: stepAgentTestsTool,
} satisfies Record<string, TeamTool>;

export type TeamToolName = keyof typeof TEAM_TOOLS;

/** Each agent's dedicated tool set (Darwin's orchestration tools are added by the orchestrator). */
export const AGENT_TOOLS: Record<AgentId, TeamToolName[]> = {
  darwin: ["navigate", "get_kpis", "loop_status", "step_loop", "list_experiments"],
  iris: ["get_kpis", "list_dashboards", "add_chart", "research_competitors", "audit_readiness", "certify_store", "agent_funnel", "loop_status", "navigate"],
  pixel: [
    "list_files",
    "read_file",
    "search_code",
    "write_file",
    "apply_edit",
    "view_changes",
    "discard_changes",
    "create_branch",
    "commit_changes",
    "open_pr",
    "get_pr_status",
    "merge_pr",
    "list_web_rules",
    "suggest_web_rules",
    "draft_web_rule",
    "update_web_rule",
    "set_web_rule_status",
    "preview_link",
    "navigate",
  ],
  fizz: ["list_experiments", "loop_status", "step_loop", "run_simulation", "send_test_shopper", "agent_tests", "step_agent_tests", "set_autopilot", "reset_loop", "navigate"],
  dash: ["ship_winner", "list_experiments", "list_prs", "get_pr_status", "merge_pr", "navigate"],
};

export function toolsFor(agent: AgentId): TeamTool[] {
  return AGENT_TOOLS[agent].map((n) => TEAM_TOOLS[n]);
}

export function teamTool(agent: AgentId, name: string): TeamTool | undefined {
  return (AGENT_TOOLS[agent] as string[]).includes(name) ? TEAM_TOOLS[name as TeamToolName] : undefined;
}

/** Which specialist owns a tool (first one that has it; Darwin for navigation). */
export function ownerOf(name: string): AgentId | undefined {
  if (name === "navigate") return "darwin";
  for (const a of ["iris", "fizz", "dash", "pixel"] as AgentId[]) if ((AGENT_TOOLS[a] as string[]).includes(name)) return a;
  return undefined;
}

export function needsConfirm(t: TeamTool, args: unknown, ctx: TeamToolContext): boolean {
  return typeof t.confirm === "function" ? t.confirm(args as never, ctx) : Boolean(t.confirm);
}
