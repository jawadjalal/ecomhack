/**
 * Darwin's managing-assistant tools. OWNED BY: assistant.
 *
 * Every tool is a thin, zod-typed wrapper over another module's PUBLIC API (see AGENTS.md): the assistant
 * never reaches into another area's internals and never computes numbers the modules don't already report.
 * Tools that change the store in ways the merchant should approve (ship, autopilot, reset, simulate, and a loop
 * step that would ship or roll back the live page) are marked `requiresConfirm` / `confirmWhen`: the agent returns a
 * pending confirmation instead of running them, and only an explicit `confirm` request from the merchant runs them.
 * Tools marked `untrusted` read content from the open web (or other agents); after one runs, the model may not
 * even propose a side-effecting tool in the same turn (prompt-injection guard).
 */
import { z } from "zod";
import type {
  AgentThread,
  AnalyticsSummary,
  ChangeProposal,
  Experiment,
  Insight,
  LoopState,
  ReadinessCertificate,
  SegmentKpis,
} from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { storeSnapshot } from "@/lib/analytics/snapshot";
import { listExperiments } from "@/lib/experiments/store";
import {
  getLoopState,
  resetLoop,
  setAutopilot,
  stepLoop,
} from "@/lib/optimizer";
import {
  getTargetRepo,
  githubErrorStatus,
  latestShippableExperiment,
  shipWinningSpec,
} from "@/lib/github";
import {
  askForChart,
  computeDashboards,
  getPlan,
  listPlans,
  savePlan,
} from "@/lib/tracking";
import {
  DEMO_SITE,
  pageOutline,
  siteUrl,
  suggestRules,
  webState,
} from "@/lib/web";
import { simulateTraffic } from "@/lib/simulator";
import { auditStore, certifyStore } from "@/lib/readiness";
import { parseGoalBrief, runBuyerAgent } from "@/lib/agent-commerce";
import { citedFunnel } from "@/lib/store-agent";
import { askResearch, researchCompetitors } from "@/lib/research";
import { demoStatus, ensureDemoStore } from "@/lib/demo";
import { llmAvailable } from "@/lib/llm/client";
import { id } from "@/lib/ids";
import { formatGBP } from "@/lib/money";
import { crewBrief, resolveSpecialist, specialistName } from "@/lib/crew";
import { askAgent } from "./crew";

/* ------------------------------------------------------------------ types */

/** Where the merchant is asking from (the console page), so tools can pick sensible defaults. */
export interface ToolContext {
  /** Darwin's own origin (for fetching the demo site's page outline). */
  origin?: string;
  /** darwin.js site the merchant is looking at (dashboards / personalize pages). */
  site?: string;
  /** Console path the question was asked on. */
  path?: string;
}

export interface ToolOutcome {
  ok: boolean;
  /** One or two plain sentences built from real data. Shown as the action chip and used by the heuristic replies. */
  summary: string;
  /** Compact structured result the LLM can read (never shown raw). */
  data?: unknown;
  /** The result involves simulated traffic/buyers (the UI labels it). */
  synthetic?: boolean;
  /** A link the merchant may want to open (PR, dashboards page…). */
  link?: { label: string; href: string };
  /** The UI should open `link` now (the `navigate` tool). */
  navigate?: boolean;
  /** An agent-to-agent exchange this tool ran (`ask_agent`), rendered as a thread. */
  thread?: AgentThread;
}

export interface AssistantTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** For the LLM's tool catalog. */
  description: string;
  args: S;
  /** Side-effecting: ask the merchant before running. */
  requiresConfirm?: boolean;
  /** Side-effecting only in some states (e.g. a loop step that would ship): ask the merchant when this returns true. */
  confirmWhen?: (args: z.infer<S>) => boolean;
  /** Its result carries third-party content (web pages, search results, other agents): never instructions. */
  untrusted?: boolean;
  /** The question shown with Confirm / Cancel. */
  confirmPrompt?: (args: z.infer<S>) => string;
  /** Why a confirm-required tool can't run right now (checked before asking, so we never ask for a no-op). */
  precheck?: (args: z.infer<S>) => string | undefined;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

function tool<S extends z.ZodType>(t: AssistantTool<S>): AssistantTool<S> {
  return t;
}

/* ------------------------------------------------------------------ formatting (from real data only) */

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;
const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

function kpiLine(label: string, k: SegmentKpis): string {
  if (!k.visitors) return `${label}: no visitors yet`;
  return `${label}: ${k.visitors.toLocaleString("en-GB")} visitors, ${k.orders} orders (${pct(k.conversionRate)} conversion), ${formatGBP(k.revenue)}`;
}

function compactKpis(k: SegmentKpis) {
  return {
    visitors: k.visitors,
    orders: k.orders,
    conversionRate: Number(k.conversionRate.toFixed(4)),
    revenuePence: k.revenue,
    aovPence: Math.round(k.averageOrderValue),
  };
}

/** Counts of events and how many were simulated (the console labels synthetic traffic, and so do we). */
export function trafficMix(): { events: number; synthetic: number } {
  let synthetic = 0;
  const all = eventStore().all();
  for (const e of all) if (e.properties.synthetic === true) synthetic++;
  return { events: all.length, synthetic };
}

function experimentLine(e: Experiment): string {
  const r = e.result;
  const status = e.status === "running" ? "running" : (r?.decision ?? e.status);
  if (!r || !(r.control.visitors + r.treatment.visitors))
    return `“${e.name}” (${status}, no visitors yet)`;
  return `“${e.name}” (${status}): ${signedPct(r.lift)} lift, P(better) ${r.probabilityToBeat.toFixed(2)}, ${r.control.visitors + r.treatment.visitors} visitors`;
}

function compactExperiment(e: Experiment) {
  const r = e.result;
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    decision: r?.decision,
    lift: r ? Number(r.lift.toFixed(4)) : undefined,
    probabilityToBeat: r ? Number(r.probabilityToBeat.toFixed(3)) : undefined,
    visitors: r ? r.control.visitors + r.treatment.visitors : 0,
    createdAt: e.createdAt,
  };
}

const newestFirst = (a: Experiment, b: Experiment) =>
  b.createdAt.localeCompare(a.createdAt);

/* ------------------------------------------------------------------ state snapshot (for the LLM + heuristic replies) */

export interface StateSnapshot {
  loop: {
    phase: LoopState["phase"];
    generation: number;
    autopilot: boolean;
    designer?: string;
    topInsights: string[];
    proposal?: string;
  };
  kpis: {
    overall: ReturnType<typeof compactKpis>;
    human: ReturnType<typeof compactKpis>;
    agent: ReturnType<typeof compactKpis>;
    /** Set when there is nothing to cite. */
    empty?: string;
  };
  traffic: { events: number; synthetic: number; kind?: string; simulated?: boolean };
  runningExperiments: ReturnType<typeof compactExperiment>[];
  lastCompleted?: ReturnType<typeof compactExperiment>;
}

export function stateSnapshot(): StateSnapshot {
  const loop = getLoopState();
  const snap = storeSnapshot();
  const s = snap.summary;
  const exps = [...listExperiments()].sort(newestFirst);
  const done = exps.find((e) => e.status === "completed");
  return {
    loop: {
      phase: loop.phase,
      generation: loop.generation,
      autopilot: loop.autopilot,
      designer: aiOrRules(loop.designer),
      topInsights: loop.insights.slice(0, 3).map((i) => i.title),
      proposal: loop.proposal?.title,
    },
    kpis:
      snap.kind === "empty"
        ? { overall: compactKpis(s.overall), human: compactKpis(s.byKind.human), agent: compactKpis(s.byKind.agent), empty: snap.emptyLine }
        : {
            overall: compactKpis(s.overall),
            human: compactKpis(s.byKind.human),
            agent: compactKpis(s.byKind.agent),
          },
    traffic: { ...trafficMix(), kind: snap.kind, simulated: snap.simulated },
    runningExperiments: exps
      .filter((e) => e.status === "running")
      .map(compactExperiment),
    lastCompleted: done ? compactExperiment(done) : undefined,
  };
}

/* ------------------------------------------------------------------ helpers */

/** "llm:<model>" → "ai", anything else → "rules": model names never reach the model's replies or the UI. */
function aiOrRules(label: string | undefined): "ai" | "rules" | undefined {
  if (!label) return undefined;
  return label.startsWith("llm:") ? "ai" : "rules";
}

/** Console pages the `navigate` tool can open. */
export const CONSOLE_PAGES = {
  overview: { label: "Overview", href: "/console" },
  issues: { label: "Issues", href: "/console/issues" },
  fixes: { label: "Fixes", href: "/console/fixes" },
  experiments: { label: "Experiments", href: "/console/experiments" },
  changes: { label: "Changes", href: "/console/changes" },
  agents: { label: "Store agent", href: "/console/agents" },
  dashboards: { label: "Dashboards", href: "/console/dashboards" },
  personalize: { label: "Personalize", href: "/console/personalize" },
  traffic: { label: "Traffic", href: "/console/traffic" },
  settings: { label: "Settings", href: "/console/settings" },
  research: { label: "Research", href: "/console/research" },
} as const;
export type ConsolePage = keyof typeof CONSOLE_PAGES;

/** Who `ask_agent` can consult: crew ids plus the old role names. */
export const ASK_AGENT_NAMES = [
  "iris",
  "theo",
  "ada",
  "max",
  "mika",
  "shopper",
  "grok",
  "analyst",
  "designer",
  "store_agent",
] as const;

function loopSummary(loop: LoopState): string {
  const parts = [
    `Gen ${loop.generation}, phase “${loop.phase}”, autopilot ${loop.autopilot ? "on" : "off"}.`,
  ];
  if (loop.proposal && ["propose", "experiment", "decide"].includes(loop.phase))
    parts.push(`Testing: ${loop.proposal.title}.`);
  else if (loop.insights[0])
    parts.push(`Top insight: ${loop.insights[0].title}.`);
  const last = loop.log.at(-1);
  if (last) parts.push(`Latest: ${last.message}`);
  return parts.join(" ");
}

function compactLoop(loop: LoopState) {
  return {
    phase: loop.phase,
    generation: loop.generation,
    autopilot: loop.autopilot,
    liveSpecVersion: loop.liveSpec.version,
    designer: aiOrRules(loop.designer),
    insights: loop.insights.slice(0, 4).map((i) => ({
      title: i.title,
      audience: i.audience,
      severity: i.severity,
    })),
    proposal: loop.proposal
      ? {
          title: loop.proposal.title,
          expectedLift: loop.proposal.expectedLift,
          source: aiOrRules(loop.proposal.source),
        }
      : undefined,
    experimentId: loop.experimentId,
    history: loop.history.slice(-4).map((h) => ({
      generation: h.generation,
      label: h.label,
      overallCR: Number(h.overallConversionRate.toFixed(4)),
      lift: h.lift,
      prUrl: h.prUrl,
    })),
    recentLog: loop.log.slice(-4).map((l) => `${l.phase}: ${l.message}`),
  };
}

function isProposal(v: unknown): v is ChangeProposal {
  return (
    !!v &&
    typeof v === "object" &&
    "id" in v &&
    "hypothesis" in v &&
    "patch" in v
  );
}

/** Same context the /api/github/ship route adds: proposal, insights and generation from the loop's public state. */
function shipContext(experiment: Experiment) {
  const loop = getLoopState();
  const proposal = [loop.proposal, ...loop.log.map((l) => l.data)].find(
    (p): p is ChangeProposal => isProposal(p) && p.id === experiment.proposalId,
  );
  const insights: Insight[] = proposal
    ? loop.insights.filter((i) => proposal.insightIds.includes(i.id))
    : [];
  const generation = loop.history.find(
    (h) => h.experimentId === experiment.id,
  )?.generation;
  return { proposal, insights, generation };
}

/** The site to use for site-scoped tools: explicit arg → page context → first tracking plan → demo site. */
function pickSite(
  explicit: string | undefined,
  ctx: ToolContext,
  fallback?: string,
): string | undefined {
  return explicit || ctx.site || listPlans()[0]?.site || fallback;
}

const SiteArg = z
  .string()
  .regex(/^[\w.-]{1,64}$/)
  .optional();
const UrlArg = z.string().trim().min(3).max(500);

/* ------------------------------------------------------------------ the registry */

export const TOOLS = {
  get_kpis: tool({
    name: "get_kpis",
    description:
      "Store KPIs (visitors, orders, conversion, revenue) overall and split humans vs AI agents, plus how much traffic is simulated.",
    args: z.object({
      realOnly: z.boolean().optional().describe("Exclude simulated traffic"),
    }),
    async run({ realOnly }) {
      const snap = storeSnapshot(realOnly ? { simulatedOk: false } : undefined);
      if (snap.kind === "empty") {
        return { ok: true, summary: snap.emptyLine, data: { empty: true, kind: snap.kind } };
      }
      const s: AnalyticsSummary = snap.summary;
      const synthNote = snap.simulated
        ? "All of this is simulated traffic (synthetic)."
        : "All real traffic.";
      const friction = s.friction
        .slice(0, 2)
        .map(
          (f) =>
            `${f.kind.replace(/_/g, " ")} at ${f.location} (${f.count} ${f.audience}s)`,
        );
      const summary = [
        [
          kpiLine("Overall", s.overall),
          kpiLine("Humans", s.byKind.human),
          kpiLine("AI agents", s.byKind.agent),
        ]
          .map((l) => `- ${l}`)
          .join("\n"),
        friction.length ? `Biggest friction: ${friction.join("; ")}.` : "",
        synthNote,
      ]
        .filter(Boolean)
        .join("\n\n");
      return {
        ok: true,
        summary,
        synthetic: snap.simulated || undefined,
        data: {
          overall: compactKpis(s.overall),
          human: compactKpis(s.byKind.human),
          agent: compactKpis(s.byKind.agent),
          brands: snap.brands.slice(0, 6),
          friction: s.friction.slice(0, 4).map((f) => ({
            kind: f.kind,
            audience: f.audience,
            location: f.location,
            count: f.count,
            share: Number(f.share.toFixed(3)),
          })),
          kind: snap.kind,
          realOnly: !!realOnly,
        },
      };
    },
  }),

  loop_status: tool({
    name: "loop_status",
    description:
      "Where the self-improvement loop is: phase, generation, autopilot, insights, current proposal, history.",
    args: z.object({}),
    async run() {
      const loop = getLoopState();
      return { ok: true, summary: loopSummary(loop), data: compactLoop(loop) };
    },
  }),

  step_loop: tool({
    name: "step_loop",
    description:
      "Advance the self-improvement loop by exactly one phase (observe → diagnose → propose → experiment → decide → ship). The experiment phase simulates a round of labelled synthetic traffic. When the loop is at “decide”, the step ships or rolls back the live page, so the merchant confirms it first.",
    args: z.object({}),
    confirmWhen: () => getLoopState().phase === "decide",
    confirmPrompt: () => {
      const loop = getLoopState();
      return `Step the loop from “decide”? Darwin will act on the A/B result${loop.proposal ? ` for “${loop.proposal.title}”` : ""}: ship the winner to the live page or roll it back.`;
    },
    async run() {
      const before = getLoopState();
      const loop = await stepLoop();
      const moved =
        before.phase !== loop.phase ||
        before.generation !== loop.generation ||
        before.updatedAt !== loop.updatedAt;
      const last = loop.log.at(-1);
      return {
        ok: true,
        summary: moved
          ? `Loop moved ${before.phase} → ${loop.phase} (Gen ${loop.generation}).${last ? ` ${last.message}` : ""}`
          : `A step was already running; the loop is still at “${loop.phase}”.`,
        synthetic: loop.phase === "experiment" || before.phase === "experiment",
        data: compactLoop(loop),
      };
    },
  }),

  set_autopilot: tool({
    name: "set_autopilot",
    description:
      "Turn loop autopilot on or off. While on, an open console tab keeps stepping the loop and runs simulated traffic.",
    args: z.object({ on: z.boolean() }),
    requiresConfirm: true,
    confirmPrompt: ({ on }) =>
      on
        ? "Turn autopilot on? Darwin will keep running the loop (and simulated traffic) while the console is open."
        : "Turn autopilot off? The loop will wait for you to step it.",
    async run({ on }) {
      const loop = setAutopilot(on);
      return {
        ok: true,
        summary: on
          ? "Autopilot is on: the console will keep stepping the loop while it's open."
          : "Autopilot is off: the loop waits for you.",
        data: compactLoop(loop),
      };
    },
  }),

  reset_loop: tool({
    name: "reset_loop",
    description:
      "Reset everything (spec, experiments, events, agent sessions, loop) back to Gen 0. Destructive.",
    args: z.object({}),
    requiresConfirm: true,
    confirmPrompt: () =>
      "Reset the store to Gen 0? This clears the spec, experiments, events and agent sessions.",
    async run() {
      const loop = await resetLoop();
      return {
        ok: true,
        summary: `Reset done: back to Gen ${loop.generation}, phase “${loop.phase}”.`,
        data: compactLoop(loop),
      };
    },
  }),

  explore_demo_store: tool({
    name: "explore_demo_store",
    description:
      "Is Darwin on the demo store (PACE at /store, nothing of the merchant's connected) or a connected site? Fills an empty demo store with labelled SYNTHETIC shoppers: a fresh store is run to Gen 1 with a test live, a restarted one gets one round of simulated traffic. Idempotent.",
    args: z.object({}),
    async run() {
      const { action, steps, status } = await ensureDemoStore();
      const where =
        status.mode === "demo"
          ? `Darwin is on the demo store (${status.store.name}, /store): nothing of yours is connected yet.`
          : `Connected: ${[status.connections.github, ...status.connections.sites, status.connections.whop].filter(Boolean).join(", ")}. The demo store at /store is still what the loop optimizes.`;
      const did =
        action === "seeded"
          ? ` Ran the loop ${steps} step${steps === 1 ? "" : "s"} on simulated shoppers: Gen ${status.generation} is live.`
          : action === "refilled"
            ? " Sent one round of simulated shoppers so the Overview matches the loop's history."
            : " It already has simulated shoppers.";
      return {
        ok: true,
        synthetic: action !== "none" || status.hasSimulatedTraffic,
        summary: where + did,
        data: status,
        link: status.mode === "demo" ? { label: "Connect your site", href: "/onboarding" } : { label: "Open the store", href: "/store" },
      };
    },
  }),

  list_experiments: tool({
    name: "list_experiments",
    description:
      "A/B experiments, newest first, with lift, probability to beat control and decision.",
    args: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    async run({ limit = 5 }) {
      const exps = [...listExperiments()].sort(newestFirst);
      if (!exps.length)
        return {
          ok: true,
          summary:
            "No experiments yet. Step the loop to observe, diagnose and propose the first one.",
          data: { experiments: [] },
        };
      const running = exps.filter((e) => e.status === "running").length;
      const shown = exps.slice(0, limit);
      return {
        ok: true,
        summary: `${exps.length} experiment${exps.length === 1 ? "" : "s"} (${running} running). ${shown.slice(0, 3).map(experimentLine).join("; ")}.`,
        synthetic: trafficMix().synthetic > 0,
        data: { experiments: shown.map(compactExperiment), total: exps.length },
      };
    },
  }),

  ship_winner: tool({
    name: "ship_winner",
    description:
      "Open the 'ship the winner' pull request that makes a completed experiment's spec the committed storefront config (default: latest completed experiment).",
    args: z.object({ experimentId: z.string().min(1).max(100).optional() }),
    requiresConfirm: true,
    confirmPrompt: ({ experimentId }) => {
      const exp = experimentId
        ? listExperiments().find((e) => e.id === experimentId)
        : latestShippableExperiment();
      return exp
        ? `Open a pull request shipping “${exp.name}”${exp.result ? ` (${signedPct(exp.result.lift)} lift)` : ""}?`
        : "Open a pull request shipping the current live spec?";
    },
    precheck: ({ experimentId }) => {
      if (!getTargetRepo())
        return "Couldn't ship: no repository is connected yet. Connect your store's GitHub repo in mission control (or set DARWIN_TARGET_REPO).";
      const exp = experimentId
        ? listExperiments().find((e) => e.id === experimentId)
        : latestShippableExperiment();
      if (experimentId && !exp)
        return `Couldn't ship: experiment ${experimentId} doesn't exist.`;
      if (exp?.status === "running")
        return `Couldn't ship yet: “${exp.name}” is still running. Step the loop until it's decided.`;
      if (!exp && getLoopState().liveSpec.version === 0) {
        const running = listExperiments().find((e) => e.status === "running");
        return running
          ? `Nothing to ship yet: “${running.name}” is still running. Step the loop until it's decided.`
          : "Nothing to ship yet: no experiment has finished and the live page is still the baseline.";
      }
      return undefined;
    },
    async run({ experimentId }) {
      try {
        const experiment = experimentId
          ? listExperiments().find((e) => e.id === experimentId)
          : latestShippableExperiment();
        const ctx = experiment ? shipContext(experiment) : {};
        const pr = await shipWinningSpec({
          experimentId: experiment?.id ?? experimentId,
          summary: "",
          ...ctx,
        });
        const where = pr.url
          ? `PR ${pr.number ? `#${pr.number} ` : ""}${pr.existing ? "updated" : "opened"}`
          : pr.upToDate
            ? "Already up to date, no PR needed"
            : "Dry run (no GITHUB_TOKEN): here's the PR Darwin would open";
        return {
          ok: true,
          summary: `${where}: “${pr.title}”${pr.repo ? ` on ${pr.repo}` : ""}.`,
          link: pr.url ? { label: "Open PR", href: pr.url } : undefined,
          data: {
            title: pr.title,
            url: pr.url,
            number: pr.number,
            dryRun: pr.dryRun,
            upToDate: pr.upToDate,
            repo: pr.repo,
            branch: pr.branch,
            notes: pr.notes,
          },
        };
      } catch (err) {
        const { error } = githubErrorStatus(err);
        return { ok: false, summary: `Couldn't ship: ${error}` };
      }
    },
  }),

  list_dashboards: tool({
    name: "list_dashboards",
    description:
      "The dashboards built from a site's tracking plan, with their headline numbers.",
    args: z.object({ site: SiteArg }),
    async run({ site: explicit }, ctx) {
      const site = pickSite(explicit, ctx);
      if (!site)
        return {
          ok: false,
          summary:
            "No tracking plan yet, so no dashboards. Set one up in onboarding (/onboarding).",
        };
      const res = computeDashboards(site, getPlan(site), eventStore().all());
      if (!res.plan)
        return {
          ok: false,
          summary: `No tracking plan for “${site}” yet. Set one up in onboarding (/onboarding).`,
        };
      const headline = (d: (typeof res.dashboards)[number]) =>
        d.kpis
          ?.slice(0, 2)
          .map((k) => `${k.label} ${k.value}`)
          .join(", ") ||
        (d.steps?.length
          ? `${d.steps[0].visitors} → ${d.steps.at(-1)!.visitors} visitors`
          : "") ||
        (d.rows?.[0] ? `top: ${d.rows[0].label} (${d.rows[0].visitors})` : "");
      const lines = res.dashboards
        .slice(0, 6)
        .map((d) => `${d.title}${headline(d) ? `: ${headline(d)}` : ""}`);
      return {
        ok: true,
        summary: `${res.dashboards.length} dashboards for ${site} (${res.totalEvents} events${res.syntheticEvents ? `, ${res.syntheticEvents} simulated` : ""}). ${lines.join("; ")}.`,
        synthetic: res.syntheticEvents > 0,
        link: {
          label: "Open dashboards",
          href: `/console/dashboards?site=${encodeURIComponent(site)}`,
        },
        data: {
          site,
          totalEvents: res.totalEvents,
          syntheticEvents: res.syntheticEvents,
          dashboards: res.dashboards.map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            kpis: d.kpis?.slice(0, 4),
            steps: d.steps?.map((s) => ({
              label: s.label,
              visitors: s.visitors,
            })),
          })),
        },
      };
    },
  }),

  add_chart: tool({
    name: "add_chart",
    description:
      "Add a chart to a site's dashboards from a plain-English request, e.g. 'coupon codes per minute' or 'funnel from product view to order'.",
    args: z.object({
      request: z.string().trim().min(2).max(300),
      site: SiteArg,
    }),
    async run({ request, site: explicit }, ctx) {
      const site = pickSite(explicit, ctx);
      const plan = site ? getPlan(site) : undefined;
      if (!site || !plan)
        return {
          ok: false,
          summary:
            "There's no tracking plan to add a chart to yet. Set one up in onboarding (/onboarding).",
        };
      const out = askForChart(plan, request);
      if (out.plan !== plan) savePlan(out.plan);
      return {
        ok: !!out.id,
        summary: out.reply,
        link: {
          label: "Open dashboards",
          href: `/console/dashboards?site=${encodeURIComponent(site)}${out.id ? `#${out.id}` : ""}`,
        },
        data: { site, id: out.id, reply: out.reply },
      };
    },
  }),

  suggest_web_rules: tool({
    name: "suggest_web_rules",
    description:
      "Suggest personalization rules (one per traffic source, biggest conversion gap first) for a site running darwin.js.",
    args: z.object({ site: SiteArg }),
    async run({ site: explicit }, ctx) {
      const site = explicit || ctx.site || DEMO_SITE;
      const { overview } = webState(site);
      let outline: Awaited<ReturnType<typeof pageOutline>> = [];
      try {
        outline = await pageOutline(
          siteUrl(site, ctx.origin ?? "", overview.url),
        );
      } catch {
        /* suggestions still work without the page outline */
      }
      const rules = suggestRules(site, overview, outline);
      if (!rules.length)
        return {
          ok: true,
          summary: `No suggestions for ${site} yet: it needs some traffic first.`,
          data: { site, rules: [] },
        };
      return {
        ok: true,
        summary: `${rules.length} ideas for ${site}: ${rules
          .slice(0, 3)
          .map((r) => `“${r.name}”`)
          .join(", ")}. Review and launch them in Personalize.`,
        link: {
          label: "Open Personalize",
          href: `/console/personalize?site=${encodeURIComponent(site)}`,
        },
        data: {
          site,
          rules: rules.slice(0, 5).map((r) => ({
            name: r.name,
            hypothesis: r.hypothesis,
            audience: r.audience,
            changes: r.changes.length,
          })),
        },
      };
    },
  }),

  run_simulation: tool({
    name: "run_simulation",
    description:
      "Generate clearly labelled SYNTHETIC traffic (simulated humans and AI shopper agents) against the live spec / running experiment.",
    args: z.object({
      humans: z.number().int().min(0).max(2000).default(200),
      agents: z.number().int().min(0).max(200).default(20),
    }),
    requiresConfirm: true,
    confirmPrompt: ({ humans, agents }) =>
      `Simulate ${humans} shoppers and ${agents} AI agents? They're labelled synthetic, but they add events to your analytics and any running A/B test.`,
    async run({ humans, agents }) {
      const r = await simulateTraffic({ humans, agents, spreadMinutes: 30 });
      return {
        ok: true,
        synthetic: true,
        summary: `Simulated ${r.humans} humans and ${r.agents} AI agents (synthetic): ${r.events} events, ${r.orders} orders, ${formatGBP(r.revenue)}.`,
        data: { ...r, synthetic: true, byVariantKind: undefined },
      };
    },
  }),

  audit_readiness: tool({
    name: "audit_readiness",
    description:
      "Audit any store URL for AI-agent readiness (can shopping agents find, understand and buy?). Returns a 0-100 score, grade and failing checks.",
    args: z.object({ url: UrlArg }),
    untrusted: true,
    async run({ url }) {
      try {
        const r = await auditStore(url);
        const failing = r.checks
          .filter((c) => !c.informational && c.status !== "pass")
          .sort(
            (a, b) =>
              Number(a.status !== "fail") - Number(b.status !== "fail") ||
              b.weight - a.weight,
          )
          .slice(0, 3);
        return {
          ok: true,
          summary: `${r.origin} scores ${r.score}/100 (grade ${r.grade}).${failing.length ? ` Fix first: ${failing.map((c) => c.title).join("; ")}.` : " Everything checked passed."}`,
          link: {
            label: "Full report",
            href: `/readiness?url=${encodeURIComponent(r.url)}`,
          },
          data: {
            origin: r.origin,
            platform: r.platform,
            score: r.score,
            grade: r.grade,
            categories: r.categories,
            failing: failing.map((c) => ({
              id: c.id,
              title: c.title,
              status: c.status,
            })),
          },
        };
      } catch (err) {
        return {
          ok: false,
          summary: `Couldn't audit ${url}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  }),

  certify_store: tool({
    name: "certify_store",
    description:
      "Issue an agent-readiness certificate for a store URL (an AI agent shops it when an LLM key is configured).",
    args: z.object({ url: UrlArg }),
    untrusted: true,
    async run({ url }) {
      try {
        const cert = await certifyStore(url);
        return {
          ok: true,
          summary: describeCertificate(cert),
          link: {
            label: "Full report",
            href: `/readiness?url=${encodeURIComponent(cert.url)}`,
          },
          data: compactUnknown({
            ...cert,
            trial: cert.trial
              ? { ...cert.trial, steps: cert.trial.steps?.slice(0, 6) }
              : undefined,
          }),
        };
      } catch (err) {
        return {
          ok: false,
          summary: `Couldn't certify ${url}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  }),

  send_test_shopper: tool({
    name: "send_test_shopper",
    description:
      "Send one simulated AI buyer agent shopping the demo store with a brief, e.g. 'Trail shoes, UK 10, under £140'. Labelled synthetic.",
    args: z.object({
      brief: z
        .string()
        .trim()
        .min(3)
        .max(300)
        .default("Trail shoes, UK 10, under £140, delivered by Friday"),
    }),
    async run({ brief }) {
      const useLlm = llmAvailable();
      const s = await runBuyerAgent(
        parseGoalBrief(brief),
        {
          agentId: id("agt"),
          agentName: useLlm ? "darwin-test-shopper" : "scripted-shopper",
          sessionId: id("ses"),
          synthetic: true,
          persona: "assistant",
          channel: "in-process",
        },
        { useLlm },
      );
      const missing = [...new Set(s.toolCalls.flatMap((c) => c.missing ?? []))];
      const outcome =
        s.outcome === "purchased"
          ? `bought for ${formatGBP(s.orderTotal ?? 0)}`
          : s.outcome === "abandoned"
            ? `left without buying${s.reason ? ` (${s.reason})` : ""}`
            : "is still shopping";
      return {
        ok: true,
        synthetic: true,
        summary: `Test shopper ${s.agentName} (simulated) ${outcome} after ${s.toolCalls.length} tool calls.${missing.length ? ` It asked for data the store doesn't expose: ${missing.slice(0, 4).join(", ")}.` : ""}`,
        data: {
          outcome: s.outcome,
          reason: s.reason,
          orderTotalPence: s.orderTotal,
          toolCalls: s.toolCalls.length,
          missing,
          variant: s.variant,
          synthetic: true,
        },
      };
    },
  }),

  research_competitors: tool({
    name: "research_competitors",
    description:
      "Market & competitor research on the web (Tavily): who the competitors are, their prices, delivery/returns offers, trends and what to A/B test. Pass a question for a focused answer with sources.",
    args: z.object({ question: z.string().max(300).optional() }),
    untrusted: true,
    async run({ question }) {
      try {
        const q = question?.trim();
        const r =
          q && !/\bcompetitor/i.test(q)
            ? await askResearch({ question: q })
            : await researchCompetitors({ query: q });
        const names = r.competitors
          .slice(0, 4)
          .map((c) => c.name)
          .join(", ");
        const tip = r.suggestions[0]?.title;
        return {
          ok: true,
          synthetic: r.demo,
          summary: `${r.demo ? "Sample report (add TAVILY_API_KEY for real research). " : ""}${r.summary.text}${names ? ` Competitors: ${names}.` : ""}${tip ? ` Worth testing: ${tip}.` : ""}`,
          link: { label: "Open research", href: "/console/research" },
          data: {
            id: r.id,
            demo: r.demo,
            competitors: r.competitors.length,
            sources: r.sources.length,
          },
        };
      } catch (err) {
        return {
          ok: false,
          summary: `Research failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  }),

  agent_funnel: tool({
    name: "agent_funnel",
    description:
      "The store agent's A2A funnel: buyer-agent conversations → offers → checkout links → payments.",
    args: z.object({}),
    async run() {
      const cited = citedFunnel(eventStore().all(), demoStatus().mode === "demo");
      if (cited.emptyLine) return { ok: true, summary: cited.emptyLine, data: cited.funnel };
      const f = cited.funnel;
      const label = cited.synthetic ? " These figures are simulated." : "";
      return {
        ok: true,
        synthetic: cited.synthetic || undefined,
        summary: `${f.conversations} agent conversations → ${f.offersShown} saw offers → ${f.checkouts} checkout links → ${f.paid} paid (${pct(f.conversion)}), ${formatGBP(f.revenue)}.${label}`,
        link: { label: "Open store agent", href: "/console/agents" },
        data: { ...f, recent: f.recent.slice(0, 4), synthetic: cited.synthetic },
      };
    },
  }),

  ask_agent: tool({
    name: "ask_agent",
    description:
      `Consult a crew specialist by their name and get their answer plus the conversation. The crew is ${crewBrief()}. Pass the display name (Iris, Pixel, Fizz, Dash, Mika, Grok). Each knows only its own data: Iris (where shoppers and AI agents get stuck), Pixel (what page change to make and why), Fizz (A/B results), Dash (what shipped; read-only), Mika (the store's own sales agent and real Whop sales), shopper (a simulated buyer that shops Mika; say "simulated"), Grok (the morning briefing). Old names analyst/designer/store_agent also work.`,
    args: z.object({
      agent: z.string().trim().min(2).max(40),
      question: z.string().trim().min(2).max(500),
    }),
    untrusted: true,
    async run({ agent, question }, ctx) {
      const who = resolveSpecialist(agent);
      if (!who) {
        return { ok: false, summary: `No crew member named “${agent}”. The crew is ${crewBrief()}.` };
      }
      const r = await askAgent({ agent: who, question, origin: ctx.origin });
      const name = specialistName(who);
      return {
        ok: true,
        synthetic: r.synthetic || undefined,
        summary:
          `${name}${who === "shopper" ? " (simulated shopper)" : ""}: ${r.answer}`.slice(
            0,
            700,
          ),
        thread: r.thread,
        link:
          who === "mika" || who === "shopper"
            ? { label: "Open store agent", href: "/console/agents" }
            : who === "ada"
              ? { label: "Open experiments", href: "/console/experiments" }
              : undefined,
        data: {
          agent: who,
          name,
          answer: r.answer,
          source: r.source,
          synthetic: r.synthetic,
        },
      };
    },
  }),

  navigate: tool({
    name: "navigate",
    description:
      "Open a console page for the merchant: overview, issues, fixes, experiments, changes, agents (store agent), dashboards, personalize, traffic, settings or research.",
    args: z.object({
      to: z.enum(Object.keys(CONSOLE_PAGES) as [ConsolePage, ...ConsolePage[]]),
    }),
    async run({ to }) {
      const page = CONSOLE_PAGES[to];
      return {
        ok: true,
        summary: `Opening ${page.label}.`,
        link: { label: page.label, href: page.href },
        navigate: true,
        data: { href: page.href },
      };
    },
  }),
} satisfies Record<string, AssistantTool>;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

export function getTool(name: string): AssistantTool | undefined {
  return isToolName(name)
    ? (TOOLS[name] as unknown as AssistantTool)
    : undefined;
}

/** Validate args and run one tool. Never throws: failures come back as `{ ok: false }`. */
export async function runTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext = {},
): Promise<ToolOutcome & { args: Record<string, unknown> }> {
  const t = getTool(name);
  if (!t) return { ok: false, summary: `Unknown tool “${name}”.`, args: {} };
  const parsed = t.args.safeParse(rawArgs ?? {});
  if (!parsed.success)
    return {
      ok: false,
      summary: `Bad arguments for ${name}: ${z.prettifyError(parsed.error).slice(0, 200)}`,
      args: asRecord(rawArgs),
    };
  const args = asRecord(parsed.data);
  try {
    return { ...(await t.run(parsed.data, ctx)), args };
  } catch (err) {
    return {
      ok: false,
      summary:
        `${name} failed: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          300,
        ),
      args,
    };
  }
}

/** Can this tool ever need the merchant's confirmation? (Used to accept a `confirm` request for it.) */
export function isConfirmable(name: string): boolean {
  const t = getTool(name);
  return (
    !!t && (t.requiresConfirm === true || typeof t.confirmWhen === "function")
  );
}

/** Does this call need the merchant's confirmation right now? Unknown tools and invalid args: no (they fail anyway). */
export function needsConfirm(name: string, rawArgs: unknown): boolean {
  const t = getTool(name);
  if (!t) return false;
  if (t.requiresConfirm) return true;
  if (!t.confirmWhen) return false;
  const parsed = t.args.safeParse(rawArgs ?? {});
  try {
    return t.confirmWhen(parsed.success ? parsed.data : {});
  } catch {
    return true;
  }
}

/** Reason a confirm-required tool would fail right now, if any (e.g. nothing to ship yet). */
export function precheckFor(
  name: string,
  rawArgs: unknown,
): string | undefined {
  const t = getTool(name);
  const parsed = t?.args.safeParse(rawArgs ?? {});
  if (!t?.precheck || !parsed?.success) return undefined;
  try {
    return t.precheck(parsed.data);
  } catch {
    return undefined;
  }
}

export function confirmPromptFor(
  name: string,
  rawArgs: unknown,
): { args: Record<string, unknown>; prompt: string } | undefined {
  const t = getTool(name);
  if (!t || !needsConfirm(name, rawArgs)) return undefined;
  const parsed = t.args.safeParse(rawArgs ?? {});
  if (!parsed.success) return undefined;
  return {
    args: asRecord(parsed.data),
    prompt: t.confirmPrompt?.(parsed.data) ?? `Run ${name}?`,
  };
}

/** Compact catalog for the LLM prompt: name, what it does, argument schema, confirm flag. */
export function toolCatalog(): string {
  return TOOL_NAMES.map((n) => {
    const t = TOOLS[n] as unknown as AssistantTool;
    let schema = "{}";
    try {
      const js = z.toJSONSchema(t.args, { io: "input" }) as {
        properties?: Record<string, unknown>;
      };
      schema = JSON.stringify(js.properties ?? {});
    } catch {
      /* keep {} */
    }
    return `- ${n}${t.requiresConfirm ? " [asks the merchant to confirm first]" : t.confirmWhen ? " [may ask the merchant to confirm first]" : ""}: ${t.description} args: ${schema}`;
  }).join("\n");
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/* ------------------------------------------------------------------ certificate */

function describeCertificate(cert: ReadinessCertificate): string {
  const level =
    cert.level === "none" ? "not certified" : `${cert.level} certificate`;
  const trial = cert.trial
    ? ` Agent trial (${cert.trial.mode}): ${cert.trial.passed ? "passed" : "failed"}, judged by Darwin's AI.`
    : "";
  return `${cert.origin}: ${level}, ${cert.score}/100 (grade ${cert.grade}). ${cert.verdict}${trial}`;
}

function compactUnknown(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    return s.length > 2000
      ? JSON.parse(
          JSON.stringify(v, (_k, val) =>
            typeof val === "string" && val.length > 200
              ? `${val.slice(0, 200)}…`
              : val,
          ),
        )
      : v;
  } catch {
    return undefined;
  }
}
