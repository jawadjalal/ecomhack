/**
 * Per-agent tool registries for the Darwin team. OWNED BY: team.
 *
 * Every tool wraps another area's PUBLIC API: most are the assistant's tools (lib/assistant/tools.ts) reused by
 * name; the rest wrap lib/web (rules), lib/github (repo editing), lib/store-agent (pitch tests) and add
 * `navigate` (client-side: the chat panel routes to an allowed in-app page). Which agent gets which tool is read
 * from the roster (lib/team/roster.ts), so the onboarding intro and the model see the same list.
 *
 * `confirm: true` tools never run on an agent's say-so: the orchestrator posts a `confirm` message and runs them
 * only after the merchant approves. `prepare` runs first (e.g. drafting the rule) so the merchant confirms exactly
 * what will happen.
 */
import { z } from "zod";
import type { AgentId, WebRuleDraft } from "@/lib/contracts";
import { getTool, trafficMix, type ToolContext, type ToolOutcome } from "@/lib/assistant/tools";
import { eventStore } from "@/lib/analytics/store";
import { agentTestsView, stepAgentTests } from "@/lib/store-agent";
import { DEMO_SITE, WebRuleDraftSchema, createRule, draftRule, getRule, siteUrl, updateRule } from "@/lib/web";
import {
  commitFileChanges,
  githubErrorStatus,
  githubMode,
  invalidEditPath,
  listRepoFiles,
  mergePullRequest,
  openPullRequest,
  pullRequestStatus,
  readRepoFile,
  resolveRepo,
} from "@/lib/github";
import { TEAM_BY_ID } from "./roster";

export interface TeamToolOutcome extends Omit<ToolOutcome, "navigate"> {
  /** Ask the chat panel to open this in-app path. */
  navigate?: string;
}

export interface TeamTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  args: S;
  confirm?: boolean;
  confirmPrompt?: (args: z.infer<S>) => string;
  /** Why a confirm tool can't run right now (checked before asking). */
  precheck?: (args: z.infer<S>) => string | undefined;
  /** Runs before asking for confirmation; returns the args the merchant confirms (e.g. with the drafted rule). */
  prepare?: (args: z.infer<S>, ctx: ToolContext) => Promise<z.infer<S>>;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<TeamToolOutcome>;
}

function tool<S extends z.ZodType>(t: TeamTool<S>): TeamTool<S> {
  return t;
}

/** Reuse an assistant tool as-is (same name, args, confirm flag and prompt). */
function fromAssistant(name: string): TeamTool {
  const t = getTool(name);
  if (!t) throw new Error(`assistant tool ${name} missing`);
  return {
    name: t.name,
    description: t.description,
    args: t.args,
    confirm: t.requiresConfirm,
    confirmPrompt: t.confirmPrompt,
    precheck: t.precheck,
    run: async (args, ctx) => {
      // The assistant flags `navigate: true` next to a link; the team carries the path itself.
      const { navigate, ...rest } = await t.run(args, ctx);
      return { ...rest, ...(navigate && rest.link ? { navigate: rest.link.href } : {}) };
    },
  };
}

const errText = (err: unknown) => githubErrorStatus(err).error;
const RepoArg = z.string().trim().min(3).max(200).optional().describe("owner/repo; default: the connected repo");

function modeNote(): string {
  const mode = githubMode();
  return mode === "live" ? "" : mode === "dry-run" ? " (dry run: nothing will be written)" : " (preview only: no GitHub token, nothing will be written)";
}

/* ------------------------------------------------------------------ navigation */

/** Named console pages the agents can open. */
export const PAGES: Record<string, string> = {
  home: "/console",
  console: "/console",
  overview: "/console",
  traffic: "/console/traffic",
  experiments: "/console/experiments",
  dashboards: "/console/dashboards",
  personalize: "/console/personalize",
  personalization: "/console/personalize",
  agents: "/console/agents",
  "store agent": "/console/agents",
  research: "/console/research",
  pulls: "/console/pulls",
  "pull requests": "/console/pulls",
  changes: "/console/changes",
  fixes: "/console/fixes",
  issues: "/console/issues",
  settings: "/console/settings",
  store: "/store",
  storefront: "/store",
  onboarding: "/onboarding",
  setup: "/onboarding",
  readiness: "/readiness",
  audit: "/readiness",
  demo: "/demo/north-trail",
};

const ALLOWED_PREFIXES = ["/console", "/store", "/onboarding", "/readiness", "/demo", "/checkout/demo"];

/** An in-app path the chat may route to, or undefined (external URLs, protocol tricks, unknown areas). */
export function safeHref(input: string): string | undefined {
  const raw = input.trim();
  const named = PAGES[raw.toLowerCase().replace(/^\/+/, "").replace(/ page$/, "")];
  if (named) return named;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s<>"']/.test(raw) || /^\/[a-z]+:/i.test(raw)) return undefined;
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path.split("/").some((s) => s === "..")) return undefined;
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? raw.slice(0, 200) : undefined;
}

/* ------------------------------------------------------------------ team-only tools */

const EditFile = z.object({ path: z.string().trim().min(1).max(300), content: z.string().max(200_000) });

export const TEAM_TOOLS: Record<string, TeamTool> = {
  get_kpis: fromAssistant("get_kpis"),
  loop_status: fromAssistant("loop_status"),
  step_loop: fromAssistant("step_loop"),
  set_autopilot: fromAssistant("set_autopilot"),
  reset_loop: fromAssistant("reset_loop"),
  list_experiments: fromAssistant("list_experiments"),
  ship_winner: fromAssistant("ship_winner"),
  list_dashboards: fromAssistant("list_dashboards"),
  add_chart: fromAssistant("add_chart"),
  suggest_web_rules: fromAssistant("suggest_web_rules"),
  run_simulation: fromAssistant("run_simulation"),
  audit_readiness: fromAssistant("audit_readiness"),
  certify_store: fromAssistant("certify_store"),
  send_test_shopper: fromAssistant("send_test_shopper"),
  research_competitors: fromAssistant("research_competitors"),
  agent_funnel: fromAssistant("agent_funnel"),

  navigate: tool({
    name: "navigate",
    description: `Open a page in Darwin for the merchant. Use a page name (${Object.keys(PAGES).filter((k, i, a) => a.indexOf(k) === i).slice(0, 14).join(", ")}) or an in-app path like /console/experiments.`,
    args: z.object({ page: z.string().trim().min(1).max(200) }),
    async run({ page }) {
      const href = safeHref(page);
      if (!href) return { ok: false, summary: `I can only open Darwin's own pages, and “${page.slice(0, 60)}” isn't one.` };
      return { ok: true, summary: `Opening ${href}.`, navigate: href, link: { label: "Open", href } };
    },
  }),

  agent_tests: tool({
    name: "agent_tests",
    description: "A/B tests on the store agent's sales pitch (Whop store agent): current levers, running test, results. step=true lets it start/decide the next test.",
    args: z.object({ step: z.boolean().optional() }),
    async run({ step }) {
      const events = eventStore().all();
      const did = step ? stepAgentTests(events) : [];
      const { state, results } = agentTestsView(eventStore().all());
      const running = state.tests.find((t) => t.status === "running");
      const r = running ? results.find((x) => x.testId === running.id) : undefined;
      const parts = [
        did.length ? did.join(" ") : "",
        running
          ? `Testing “${running.lever}” on the pitch: control ${r?.control.paid ?? 0}/${r?.control.conversations ?? 0} paid, treatment ${r?.treatment.paid ?? 0}/${r?.treatment.conversations ?? 0}.`
          : `No pitch test running. ${state.tests.length} run so far; default pitch levers: ${state.levers.join(", ") || "none"}.`,
      ].filter(Boolean);
      return {
        ok: true,
        summary: parts.join(" "),
        synthetic: trafficMix().synthetic > 0,
        link: { label: "Open store agent", href: "/console/agents" },
        data: { levers: state.levers, autopilot: state.autopilot, tests: state.tests.slice(-5), results: results.slice(-5), did },
      };
    },
  }),

  draft_web_rule: tool({
    name: "draft_web_rule",
    description: "Draft a live-site change (personalization rule: text/banner/badge/hide/style for an audience) from plain English. Not saved; use save_web_rule to publish.",
    args: z.object({ request: z.string().trim().min(3).max(600), site: z.string().regex(/^[\w.-]{1,64}$/).optional() }),
    async run({ request, site }, ctx) {
      const s = site ?? ctx.site ?? DEMO_SITE;
      const url = ctx.origin ? siteUrl(s, ctx.origin) : undefined;
      const d = await draftRule(s, request, { url });
      const changes = d.rule.changes.map((c) => `${c.action}${c.selector ? ` ${c.selector}` : ""}${c.value ? ` → “${c.value}”` : ""}`).join("; ");
      return {
        ok: true,
        summary: `Drafted “${d.rule.name}” for ${s}: ${changes} (${d.rule.mode === "test" ? "as an A/B test" : "for everyone"}, ${d.source}).`,
        data: { draft: d.rule, source: d.source },
        link: { label: "Open personalize", href: "/console/personalize" },
      };
    },
  }),

  save_web_rule: tool({
    name: "save_web_rule",
    description: "Publish a live-site change: either `request` (plain English, drafted then published as a running A/B test) or `draft` (from draft_web_rule), or change an existing rule's status with `ruleId` + `status`.",
    args: z.object({
      request: z.string().trim().min(3).max(600).optional(),
      draft: z.record(z.string(), z.unknown()).optional(),
      ruleId: z.string().trim().min(3).max(80).optional(),
      status: z.enum(["running", "paused", "shipped", "draft"]).optional(),
      site: z.string().regex(/^[\w.-]{1,64}$/).optional(),
    }),
    confirm: true,
    precheck: ({ request, draft, ruleId, status }) => {
      if (ruleId) return getRule(ruleId) ? (status ? undefined : "Say which status the rule should get (running, paused or shipped).") : `There's no rule ${ruleId}.`;
      if (!request && !draft) return "Tell me what to change on the site.";
      return undefined;
    },
    async prepare(args, ctx) {
      if (args.ruleId || args.draft || !args.request) return args;
      const s = args.site ?? ctx.site ?? DEMO_SITE;
      const d = await draftRule(s, args.request, { url: ctx.origin ? siteUrl(s, ctx.origin) : undefined });
      return { ...args, draft: d.rule as unknown as Record<string, unknown>, request: undefined };
    },
    confirmPrompt: ({ ruleId, status, draft }) => {
      if (ruleId) return `Set rule “${getRule(ruleId)?.name ?? ruleId}” to ${status}? This changes what shoppers see.`;
      const parsed = WebRuleDraftSchema.safeParse(draft ?? {});
      if (!parsed.success) return "Publish this site change?";
      const d = parsed.data;
      return `Publish “${d.name}” on ${d.site} (${d.changes.length} change${d.changes.length === 1 ? "" : "s"}, ${d.mode === "test" ? "A/B test" : "for everyone"})? Shoppers will see it right away.`;
    },
    async run({ ruleId, status, draft, request, site }, ctx) {
      try {
        if (ruleId && status) {
          const r = updateRule(ruleId, { status });
          return { ok: true, summary: `Rule “${r.name}” is now ${r.status}.`, link: { label: "Open personalize", href: "/console/personalize" } };
        }
        let d: WebRuleDraft | undefined = draft ? WebRuleDraftSchema.parse({ author: "Pixel", ...draft }) : undefined;
        if (!d && request) {
          const s = site ?? ctx.site ?? DEMO_SITE;
          d = (await draftRule(s, request, { url: ctx.origin ? siteUrl(s, ctx.origin) : undefined })).rule;
        }
        if (!d) return { ok: false, summary: "Nothing to publish." };
        const r = createRule({ ...d, author: d.author === "manual" ? "Pixel" : d.author }, "running");
        return { ok: true, summary: `Published “${r.name}” on ${r.site} (${r.mode === "test" ? "A/B test running" : "live for everyone"}).`, link: { label: "Open personalize", href: "/console/personalize" }, data: { ruleId: r.id } };
      } catch (err) {
        return { ok: false, summary: `Couldn't publish: ${err instanceof Error ? err.message : String(err)}`.slice(0, 240) };
      }
    },
  }),

  list_repo_files: tool({
    name: "list_repo_files",
    description: "List files in the store's GitHub repo (optionally under a folder prefix).",
    args: z.object({ repo: RepoArg, prefix: z.string().trim().max(200).optional(), ref: z.string().trim().max(100).optional() }),
    async run({ repo, prefix, ref }) {
      try {
        const r = await listRepoFiles({ repo, prefix, ref, limit: 150 });
        return {
          ok: true,
          summary: `${r.files.length}${r.truncated ? "+" : ""} files in ${r.repo}@${r.ref}${prefix ? ` under ${prefix}` : ""}.`,
          data: { repo: r.repo, ref: r.ref, files: r.files.map((f) => f.path), truncated: r.truncated },
        };
      } catch (err) {
        return { ok: false, summary: `Couldn't list the repo: ${errText(err)}` };
      }
    },
  }),

  read_repo_file: tool({
    name: "read_repo_file",
    description: "Read one file from the store's GitHub repo.",
    args: z.object({ path: z.string().trim().min(1).max(300), repo: RepoArg, ref: z.string().trim().max(100).optional() }),
    async run({ path, repo, ref }) {
      try {
        const f = await readRepoFile({ repo, path, ref, maxChars: 12_000 });
        return {
          ok: true,
          summary: `Read ${f.path} from ${f.repo}@${f.ref} (${f.size.toLocaleString("en-GB")} chars${f.truncated ? ", truncated" : ""}).`,
          data: { path: f.path, ref: f.ref, content: f.content, truncated: f.truncated },
        };
      } catch (err) {
        return { ok: false, summary: `Couldn't read ${path}: ${errText(err)}` };
      }
    },
  }),

  propose_file_edit: tool({
    name: "propose_file_edit",
    description: "Commit file changes (full new content per file) to a new darwin/* branch in the store's repo and open a PR. Read the file first.",
    args: z.object({
      message: z.string().trim().min(3).max(200).describe("commit message / PR title"),
      files: z.array(EditFile).min(1).max(10),
      repo: RepoArg,
      body: z.string().max(4000).optional(),
      openPr: z.boolean().optional(),
    }),
    confirm: true,
    precheck: ({ files, repo }) => {
      for (const f of files) {
        const bad = invalidEditPath(f.path);
        if (bad) return `Can't edit ${f.path}: ${bad}.`;
      }
      try {
        resolveRepo(repo);
      } catch (err) {
        return errText(err);
      }
      return undefined;
    },
    confirmPrompt: ({ files, repo, openPr }) => {
      let where = repo ?? "your repo";
      try {
        const r = resolveRepo(repo);
        where = `${r.owner}/${r.repo}`;
      } catch {
        /* precheck reports it */
      }
      const paths = files.map((f) => f.path).slice(0, 4).join(", ");
      return `Commit ${files.length} file${files.length === 1 ? "" : "s"} (${paths}) to a new branch on ${where}${openPr === false ? "" : " and open a PR"}${modeNote()}?`;
    },
    async run({ message, files, repo, body, openPr }) {
      try {
        const r = await commitFileChanges({ repo, files, message, title: message, body, openPr });
        const changed = r.files.filter((f) => f.changed).length;
        const head = r.dryRun ? `Preview: would commit ${changed} file${changed === 1 ? "" : "s"} to ${r.branch}` : r.commitSha ? `Committed ${changed} file${changed === 1 ? "" : "s"} to ${r.branch}` : r.notes[0] ?? "Nothing to commit";
        const pr = r.pr?.url ? `; PR #${r.pr.number} ${r.pr.existing ? "updated" : "opened"}` : r.pr && r.dryRun ? " and open a PR" : "";
        return {
          ok: true,
          summary: `${head}${pr} on ${r.repo}.${r.dryRun ? ` ${r.notes[0]}` : ""}`,
          link: r.pr?.url ? { label: "Open PR", href: r.pr.url } : undefined,
          data: { ...r, files: r.files },
        };
      } catch (err) {
        return { ok: false, summary: `Couldn't commit: ${errText(err)}` };
      }
    },
  }),

  open_pr: tool({
    name: "open_pr",
    description: "Open a pull request from an existing darwin/* branch in the store's repo.",
    args: z.object({ branch: z.string().trim().min(3).max(120), title: z.string().trim().min(3).max(120), body: z.string().max(4000).optional(), repo: RepoArg }),
    confirm: true,
    precheck: ({ branch }) => (branch.startsWith("darwin/") ? undefined : "Darwin only opens PRs from its own darwin/* branches."),
    confirmPrompt: ({ branch, title }) => `Open a pull request “${title}” from ${branch}${modeNote()}?`,
    async run({ branch, title, body, repo }) {
      try {
        const r = await openPullRequest({ repo, branch, title, body });
        return {
          ok: true,
          summary: r.dryRun ? `Preview: would open “${title}” from ${branch} on ${r.repo}.` : `PR #${r.pr?.number} ${r.pr?.existing ? "already open" : "opened"} on ${r.repo}.`,
          link: r.pr?.url ? { label: "Open PR", href: r.pr.url } : undefined,
          data: r,
        };
      } catch (err) {
        return { ok: false, summary: `Couldn't open the PR: ${errText(err)}` };
      }
    },
  }),

  merge_pr: tool({
    name: "merge_pr",
    description: "Merge a pull request in the store's repo (squash by default). Check pr_status first.",
    args: z.object({ number: z.number().int().min(1), method: z.enum(["squash", "merge", "rebase"]).optional(), repo: RepoArg }),
    confirm: true,
    precheck: ({ repo }) => {
      try {
        resolveRepo(repo);
        return undefined;
      } catch (err) {
        return errText(err);
      }
    },
    confirmPrompt: ({ number, method, repo }) => {
      let where = "your repo";
      try {
        const r = resolveRepo(repo);
        where = `${r.owner}/${r.repo}`;
      } catch {
        /* precheck reports it */
      }
      return `Merge ${where}#${number} (${method ?? "squash"})? This changes your main branch${modeNote()}.`;
    },
    async run({ number, method, repo }) {
      try {
        const r = await mergePullRequest({ repo, number, method });
        return { ok: r.merged || r.dryRun, summary: r.dryRun ? r.message : r.merged ? `Merged ${r.repo}#${r.number}.` : `GitHub didn't merge #${r.number}: ${r.message}`, link: r.url ? { label: "Open PR", href: r.url } : undefined, data: r };
      } catch (err) {
        return { ok: false, summary: `Couldn't merge #${number}: ${errText(err)}` };
      }
    },
  }),

  set_autonomy: tool({
    name: "set_autonomy",
    description: "Set how much Darwin may do without asking: off (silent), suggest (messages only, the default), auto-safe (reversible things, then he tells you), or autopilot (also what a confirmed standing policy allows). Drastic changes still need a tap or a policy.",
    args: z.object({ level: z.enum(["off", "suggest", "auto-safe", "autopilot"]) }),
    confirm: true,
    confirmPrompt: ({ level }) => `Set Darwin to “${level}”? ${level === "autopilot" ? "He'll act on his own, except drastic changes, which still need you or a standing policy." : level === "off" ? "He'll keep watching but never message you." : "He'll only message you; nothing runs until you tap."}`,
    async run({ level }) {
      const { updateAutonomy } = await import("./watch");
      const res = await updateAutonomy({ level });
      return { ok: true, summary: res.text, data: { autonomy: res.settings.autonomy } };
    },
  }),

  add_policy: tool({
    name: "add_policy",
    description: "Turn a plain-English standing policy into a guard Darwin follows on autopilot, e.g. 'ship winners above 95% with at least 500 real visitors per arm' or 'never touch checkout on Fridays'. Darwin reads the compiled form back; it only counts once you confirm.",
    args: z.object({
      text: z.string().trim().min(8).max(400),
      policyId: z.string().optional(),
      compiled: z.string().optional(),
      guard: z.record(z.string(), z.unknown()).optional(),
      source: z.enum(["llm", "heuristic"]).optional(),
    }),
    confirm: true,
    async prepare(args) {
      if (args.policyId && args.compiled && args.guard) return args;
      const { compilePolicy } = await import("./autonomy");
      const policy = await compilePolicy(args.text);
      const { savePolicy } = await import("./watch-store");
      savePolicy(policy);
      return { text: policy.text, policyId: policy.id, compiled: policy.compiled, guard: policy.guard as unknown as Record<string, unknown>, source: policy.source };
    },
    confirmPrompt: ({ compiled, text }) => (compiled ? `I'll follow this: ${compiled}` : `Add this standing policy? “${text}”`),
    async run({ policyId, compiled }) {
      const { getPolicy, savePolicy } = await import("./watch-store");
      const policy = policyId ? getPolicy(policyId) : undefined;
      if (!policy) return { ok: false, summary: "I couldn't find that policy to confirm. Say it again and I'll recompile it." };
      savePolicy({ ...policy, confirmedAt: new Date().toISOString() });
      return { ok: true, summary: `Standing policy on: ${compiled ?? policy.compiled}`, data: { policyId: policy.id } };
    },
  }),

  pr_status: tool({
    name: "pr_status",
    description: "State, mergeability and CI checks of a pull request (default: the newest PR Darwin opened).",
    args: z.object({ number: z.number().int().min(1).optional(), repo: RepoArg }),
    async run({ number, repo }) {
      try {
        const s = await pullRequestStatus({ number, repo });
        if (s.state === "preview") return { ok: true, summary: `The latest PR (“${s.title}”) was a preview only; nothing is open on GitHub.`, data: s };
        const checks = s.checks && s.checks.state !== "none" ? `, checks ${s.checks.state}` : ", no checks";
        const merge = s.state === "open" ? (s.mergeable === false ? ", has conflicts" : s.mergeable ? ", mergeable" : "") : "";
        return { ok: true, summary: `${s.repo}#${s.number} “${s.title}” is ${s.state}${merge}${checks}.`, link: s.url ? { label: "Open PR", href: s.url } : undefined, data: s };
      } catch (err) {
        return { ok: false, summary: `Couldn't check the PR: ${errText(err)}` };
      }
    },
  }),
};

/** Orchestration tools (handled by the orchestrator, not TEAM_TOOLS). */
export const META_TOOLS = ["delegate", "start_group_chat", "post", "report", "ask"] as const;
export type MetaTool = (typeof META_TOOLS)[number];

export function isMetaTool(name: string): name is MetaTool {
  return (META_TOOLS as readonly string[]).includes(name);
}

/** The regular (non-meta) tools an agent may call, per the roster. */
export function toolsFor(agent: AgentId): TeamTool[] {
  return (TEAM_BY_ID[agent].tools ?? []).map((t) => TEAM_TOOLS[t.name]).filter((t): t is TeamTool => Boolean(t));
}

/** Which agent owns a tool (first specialist listing it; Darwin only for its own direct tools). */
export function ownerOf(toolName: string, prefer: AgentId[] = ["iris", "pixel", "fizz", "dash", "darwin"]): AgentId | undefined {
  return prefer.find((a) => (TEAM_BY_ID[a].tools ?? []).some((t) => t.name === toolName));
}

export function agentHasTool(agent: AgentId, name: string): boolean {
  return (TEAM_BY_ID[agent].tools ?? []).some((t) => t.name === name);
}

/** JSON schema for a tool's args (for native tool calling). */
export function jsonSchemaOf(args: z.ZodType): Record<string, unknown> {
  try {
    const js = z.toJSONSchema(args, { io: "input" }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  } catch {
    return { type: "object", properties: {} };
  }
}

export interface PreparedCall {
  tool: TeamTool;
  args: Record<string, unknown>;
}

/** Validate args for an agent's tool. */
export function parseCall(agent: AgentId, name: string, rawArgs: unknown): PreparedCall | { error: string } {
  if (!agentHasTool(agent, name)) return { error: `${TEAM_BY_ID[agent].name} has no tool “${name}”.` };
  const t = TEAM_TOOLS[name];
  if (!t) return { error: `Unknown tool “${name}”.` };
  const parsed = t.args.safeParse(rawArgs ?? {});
  if (!parsed.success) return { error: `Bad arguments for ${name}: ${z.prettifyError(parsed.error).slice(0, 200)}` };
  return { tool: t, args: (parsed.data ?? {}) as Record<string, unknown> };
}

/** Run a validated call. Never throws. */
export async function runTeamTool(t: TeamTool, args: Record<string, unknown>, ctx: ToolContext): Promise<TeamToolOutcome> {
  try {
    return await t.run(args, ctx);
  } catch (err) {
    return { ok: false, summary: `${t.name} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
  }
}
