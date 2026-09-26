/**
 * The self-improvement loop: a persisted state machine advanced one phase per `stepLoop()`.
 *
 *   idle ──► observe ──► diagnose ──► propose ──► experiment ⟲ ──► decide ──► ship ──► observe …
 *                           ▲                                          │
 *                           └────────────── reject / inconclusive ─────┘
 *
 *   idle/ship → observe     simulate traffic on the live spec (records the Gen 0 baseline once)
 *   observe → diagnose      analytics summary for the live version → ranked insights
 *   diagnose → propose      one validated SpecPatch (LLM if configured, playbook otherwise)
 *   propose → experiment    create the A/B test, simulate the first round
 *   experiment → itself     simulate another round, recompute stats …
 *              → decide     … until the decision is not "running"
 *   decide → ship           promote the winner, open the PR, record the generation
 *   decide → diagnose       shelve the loser (never retried), re-diagnose with fresh data
 *
 * The console drives steps (manually or on autopilot). Dependencies are injectable so tests can
 * run full generations with a fake simulator.
 *
 * Candidate specs are served with version `(live + 1) * 1000 + attempt` so experiment traffic never
 * mixes into a live version's analytics; `promoteSpec` assigns the real next version on ship.
 */
import type {
  AnalyticsFilter,
  AnalyticsSummary,
  ChangeProposal,
  Experiment,
  ExperimentResult,
  GenerationRecord,
  Insight,
  LoopLogEntry,
  LoopState,
  PageSpec,
  SpecPatch,
} from "@/lib/contracts";
import { kvDelete, kvGet, kvSet } from "@/lib/db/json-store";
import { getLiveSpec, getSpecVersion, promoteSpec, resetSpec } from "@/lib/spec/store";
import { applyPatch, describeDiff } from "@/lib/spec/patch";
import { getExperiment, listExperiments, resetExperiments, saveExperiment } from "@/lib/experiments/store";
import { eventStore } from "@/lib/analytics/store";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import { simulateTraffic, type SimulationOptions, type SimulationResult } from "@/lib/simulator";
import { openSpecPR, type PullRequestResult, type RepoRef } from "@/lib/github";
import { AGENT_KV_KEYS } from "@/lib/agent-commerce";
import { llmAvailable } from "@/lib/llm/client";
import { id } from "@/lib/ids";
import { diagnose, refineInsightsWithLlm } from "./insights";
import { ideaForProposal, propose, proposeWithLlm } from "./proposals";
import {
  evaluateExperiment,
  experimentArms,
  metricAudience,
  relativeLift,
  segment,
  type DecisionConfig,
} from "./stats";
import { withAgentTelemetry } from "./telemetry";
import { diffPatch, num, pct, signedPct } from "./util";

/* ------------------------------------------------------------------ config & deps */

export interface LoopConfig extends DecisionConfig {
  /** Traffic simulated when observing a live spec. */
  observeHumans: number;
  observeAgents: number;
  /** Traffic simulated per experiment round (split across arms by `allocation`). */
  roundHumans: number;
  roundAgents: number;
  /** Share of traffic in the treatment arm. */
  allocation: number;
  /** Every Nth proposal is a wildcard (bold/creative idea). 0 disables. */
  exploreEvery: number;
  /** "owner/repo" the ship step opens PRs against. */
  targetRepo?: string;
  /** Base seed for simulated traffic. */
  seed: number;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export function loopConfigFromEnv(): LoopConfig {
  const observeHumans = envNum("DARWIN_DEMO_HUMANS", 1200);
  const observeAgents = envNum("DARWIN_DEMO_AGENTS", 150);
  return {
    observeHumans,
    observeAgents,
    roundHumans: envNum("DARWIN_ROUND_HUMANS", Math.round(observeHumans / 2)),
    roundAgents: envNum("DARWIN_ROUND_AGENTS", Math.round(observeAgents / 2)),
    minVisitors: envNum("DARWIN_MIN_ARM_VISITORS", 400),
    minSegmentVisitors: envNum("DARWIN_MIN_ARM_AGENTS", 100),
    maxRounds: Math.max(1, envNum("DARWIN_MAX_ROUNDS", 4)),
    shipThreshold: 0.95,
    rejectThreshold: 0.1,
    allocation: 0.5,
    exploreEvery: envNum("DARWIN_EXPLORE_EVERY", 3),
    targetRepo: process.env.DARWIN_TARGET_REPO?.trim() || "jawadjalal/ecomhack",
    seed: envNum("DARWIN_SEED", 42),
  };
}

export interface LoopDeps {
  simulate: (opts: SimulationOptions) => Promise<SimulationResult>;
  summary: (filter: AnalyticsFilter) => AnalyticsSummary | Promise<AnalyticsSummary>;
  openSpecPR: (
    repo: RepoRef,
    spec: PageSpec,
    ctx: { experiment?: Experiment; summary: string },
  ) => Promise<PullRequestResult>;
  /** Use the LLM for insight copy + proposals. Default: `llmAvailable()`. */
  useLlm: boolean;
  config: LoopConfig;
}

export type LoopOverrides = Partial<Omit<LoopDeps, "config">> & { config?: Partial<LoopConfig> };

/** Analytics summary, with agent telemetry derived from raw events if the summary has none yet. */
function defaultSummary(filter: AnalyticsFilter): AnalyticsSummary {
  return withAgentTelemetry(getAnalyticsSummary(filter), filter);
}

function resolveDeps(o: LoopOverrides = {}): LoopDeps {
  return {
    simulate: o.simulate ?? simulateTraffic,
    summary: o.summary ?? defaultSummary,
    openSpecPR: o.openSpecPR ?? openSpecPR,
    useLlm: o.useLlm ?? llmAvailable(),
    config: { ...loopConfigFromEnv(), ...o.config },
  };
}

export function parseRepo(input: string): RepoRef | undefined {
  const m = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/, "")
    .match(/^([\w.-]+)\/([\w.-]+)/);
  return m ? { owner: m[1], repo: m[2] } : undefined;
}

/** Version served to an experiment's treatment arm (never collides with a live version). */
export function candidateVersion(liveVersion: number, attempt: number): number {
  return (liveVersion + 1) * 1000 + attempt;
}

/* ------------------------------------------------------------------ persistence */

export interface TriedRecord {
  title: string;
  patch: SpecPatch;
  outcome: "shipped" | "rejected" | "inconclusive";
  experimentId: string;
  lift: number;
  probabilityToBeat: number;
  generation: number;
}

interface LoopMemory {
  /** Every patch that has been A/B tested, with its outcome. Never proposed again. */
  tried: TriedRecord[];
  /** Traffic rounds run for the current experiment. */
  round: number;
  /** Simulator calls so far (drives deterministic seeds). */
  simRuns: number;
  /** Proposals made so far (drives wildcard turns). */
  proposals: number;
}

interface Persisted {
  state: LoopState;
  memory: LoopMemory;
}

const KEY = "loop";
const AUTOPILOT_KEY = "loop-autopilot";
const LOG_CAP = 200;

function initialPersisted(): Persisted {
  return {
    state: {
      phase: "idle",
      autopilot: false,
      generation: 0,
      liveSpec: getLiveSpec(),
      insights: [],
      history: [],
      log: [],
      updatedAt: new Date().toISOString(),
    },
    memory: { tried: [], round: 0, simRuns: 0, proposals: 0 },
  };
}

function readPersisted(): Persisted {
  const p = kvGet<Persisted>(KEY, initialPersisted);
  return p && p.state && p.memory ? p : initialPersisted();
}

function load(): Persisted {
  return structuredClone(readPersisted());
}

interface Runtime {
  busy: boolean;
  /** Log lines produced (e.g. by setAutopilot) while a step was in flight. */
  pending: LoopLogEntry[];
}
const g = globalThis as unknown as { __darwinLoop?: Runtime };
const runtime = (): Runtime => (g.__darwinLoop ??= { busy: false, pending: [] });

function save(ctx: Persisted) {
  const rt = runtime();
  if (rt.pending.length) ctx.state.log.push(...rt.pending.splice(0));
  ctx.state.log = ctx.state.log.slice(-LOG_CAP);
  ctx.state.updatedAt = new Date().toISOString();
  ctx.state.liveSpec = getLiveSpec();
  kvSet(KEY, ctx);
}

function autopilotOn(): boolean {
  return kvGet<boolean>(AUTOPILOT_KEY, () => false) === true;
}

/** Internal view for tests and debugging (tried patches, round counter…). */
export function getLoopMemory(): LoopMemory {
  return structuredClone(readPersisted().memory);
}

/* ------------------------------------------------------------------ helpers */

type Actor = LoopLogEntry["actor"];

function say(ctx: Persisted, actor: Actor, message: string, data?: unknown) {
  ctx.state.log.push({
    at: new Date().toISOString(),
    phase: ctx.state.phase,
    actor,
    message,
    ...(data === undefined ? {} : { data }),
  });
}

async function runTraffic(ctx: Persisted, deps: LoopDeps, humans: number, agents: number): Promise<SimulationResult> {
  ctx.memory.simRuns += 1;
  return deps.simulate({ humans, agents, seed: deps.config.seed + ctx.memory.simRuns * 7919 });
}

/** Stop any experiment still marked running (defensive: observation must see the live spec only). */
function stopRunningExperiments() {
  for (const e of listExperiments()) {
    if (e.status === "running") saveExperiment({ ...e, status: "stopped", completedAt: new Date().toISOString() });
  }
}

function slimSummary(s: AnalyticsSummary) {
  const seg = (k: AnalyticsSummary["overall"]) => ({ visitors: k.visitors, orders: k.orders, conversionRate: k.conversionRate });
  return { overall: seg(s.overall), human: seg(s.byKind.human), agent: seg(s.byKind.agent), totalEvents: s.totalEvents };
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}

function verdict(result: ExperimentResult, round: number): string {
  const audience = result.audience ?? "all";
  const c = segment(result.control, audience);
  const t = segment(result.treatment, audience);
  const h = relativeLift(result.control.byKind.human.conversionRate, result.treatment.byKind.human.conversionRate);
  const a = relativeLift(result.control.byKind.agent.conversionRate, result.treatment.byKind.agent.conversionRate);
  const split =
    audience === "all"
      ? [h !== undefined ? `humans ${signedPct(h)}` : "", a !== undefined ? `agents ${signedPct(a)}` : ""]
          .filter(Boolean)
          .join(", ")
      : "";
  const who = audience === "agent" ? "AI shoppers: " : audience === "human" ? "Humans: " : "";
  const [lo, hi] = result.liftInterval;
  switch (result.decision) {
    case "ship":
      return (
        `Verdict: SHIP. ${who}${pct(t.conversionRate)} vs ${pct(c.conversionRate)} is a ${signedPct(result.lift)} lift ` +
        `(95% CI ${signedPct(lo)} to ${signedPct(hi)})${split ? `; ${split}` : ""}. ${pct(result.probabilityToBeat)} sure it beats control.`
      );
    case "reject":
      return (
        `Verdict: REJECT. ${who}${who ? "the" : "The"} candidate converts ${signedPct(result.lift)} vs control${split ? ` (${split})` : ""}; ` +
        `only a ${pct(result.probabilityToBeat)} chance it's better. Killing it.`
      );
    case "inconclusive":
      return (
        `Verdict: INCONCLUSIVE after ${round} rounds. Lift ${signedPct(result.lift)}, P(better) ${pct(result.probabilityToBeat)}: ` +
        `not enough evidence to ship.`
      );
    default:
      return `Still running: P(better) ${pct(result.probabilityToBeat)}.`;
  }
}

function prBody(args: {
  experiment: Experiment;
  result: ExperimentResult;
  promoted: PageSpec;
  proposal?: ChangeProposal;
  insights: Insight[];
  diff: string[];
  synthetic: boolean;
}): string {
  const { experiment: exp, result, promoted, proposal, insights, diff, synthetic } = args;
  const c = result.control;
  const t = result.treatment;
  const [lo, hi] = result.liftInterval;
  const motivating = insights.filter((i) => proposal?.insightIds.includes(i.id));
  const row = (name: string, s: typeof c) =>
    `| ${name} | ${num(s.visitors)} | ${num(s.conversions)} | ${pct(s.conversionRate)} | ${pct(s.byKind.human.conversionRate)} | ${pct(s.byKind.agent.conversionRate)} |`;
  return [
    `## ${promoted.label}`,
    "",
    `Darwin A/B-tested this change against the live store (v${exp.controlVersion}) and it won.`,
    "",
    ...(motivating.length ? ["**What we saw**", ...motivating.map((i) => `- ${i.title}`), ""] : []),
    ...(proposal ? [`**Hypothesis:** ${proposal.hypothesis}`, ""] : []),
    "| Arm | Visitors | Orders | Conversion | Humans | AI agents |",
    "|---|---:|---:|---:|---:|---:|",
    row(`Control (v${exp.controlVersion})`, c),
    row("Candidate", t),
    "",
    `**Result:** ${signedPct(result.lift)} conversion lift` +
      `${result.audience === "agent" ? " among AI shoppers (agent-only change, invisible to humans)" : ""} ` +
      `(95% credible interval ${signedPct(lo)} to ${signedPct(hi)}), ` +
      `P(beats control) = ${pct(result.probabilityToBeat)}. Experiment \`${exp.id}\`.`,
    "",
    "**Changes to `storefront.config.json`**",
    ...diff.map((d) => `- \`${d}\``),
    "",
    ...(synthetic ? ["_This experiment includes simulated traffic from Darwin's synthetic shoppers and AI agents._", ""] : []),
    `_Proposal source: ${proposal?.source ?? "unknown"}._`,
  ].join("\n");
}

/* ------------------------------------------------------------------ phases */

async function observe(ctx: Persisted, deps: LoopDeps) {
  stopRunningExperiments();
  const live = getLiveSpec();
  const sim = await runTraffic(ctx, deps, deps.config.observeHumans, deps.config.observeAgents);
  const summary = await deps.summary({ specVersion: live.version });
  const H = summary.byKind.human;
  const A = summary.byKind.agent;

  ctx.state.phase = "observe";
  ctx.state.insights = [];
  ctx.state.proposal = undefined;
  ctx.state.experimentId = undefined;

  if (sim.events > 0) {
    say(
      ctx,
      "observer",
      `Simulated ${num(sim.humans)} shoppers and ${num(sim.agents)} AI agents on v${live.version} "${live.label}" (synthetic traffic).`,
      { simulation: sim, specVersion: live.version },
    );
  } else {
    say(
      ctx,
      "observer",
      `No simulated traffic this time${summary.overall.visitors ? "" : ", and no real visitors yet"}. Watching v${live.version} "${live.label}".`,
      { simulation: sim, specVersion: live.version },
    );
  }

  if (summary.overall.visitors > 0) {
    const base = ctx.state.history[0];
    const vsBase =
      base && ctx.state.generation > 0
        ? ` (Gen 0: humans ${pct(base.humanConversionRate)}, agents ${pct(base.agentConversionRate)})`
        : "";
    say(
      ctx,
      "observer",
      `${num(H.visitors)} humans convert at ${pct(H.conversionRate)}, ${num(A.visitors)} AI agents at ${pct(A.conversionRate)}${vsBase}.`,
      { summary: slimSummary(summary) },
    );
  }

  if (ctx.state.generation === 0 && ctx.state.history.length === 0 && summary.overall.visitors > 0) {
    ctx.state.history.push({
      generation: 0,
      specVersion: live.version,
      label: live.label,
      humanConversionRate: H.conversionRate,
      agentConversionRate: A.conversionRate,
      overallConversionRate: summary.overall.conversionRate,
      shippedAt: new Date().toISOString(),
    });
    say(ctx, "observer", `Baseline locked in as Gen 0: ${pct(summary.overall.conversionRate)} of all visitors buy.`);
  }
}

async function diagnoseNow(ctx: Persisted, deps: LoopDeps, intro = "") {
  const live = getLiveSpec();
  const summary = await deps.summary({ specVersion: live.version });
  let insights = diagnose(summary, live);
  if (deps.useLlm) insights = await refineInsightsWithLlm(insights, summary);

  ctx.state.insights = insights;
  ctx.state.phase = "diagnose";

  if (!insights.length) {
    say(ctx, "analyst", `${intro}No clear leaks in ${num(summary.overall.visitors)} visitors on v${live.version}. Time for a creative bet.`);
    return;
  }
  const [top, ...rest] = insights;
  const audit = top.evidence.some((e) => e.label === "Basis");
  say(
    ctx,
    "analyst",
    audit
      ? `${intro}Not enough traffic to measure yet, so I audited the spec. Biggest risk: ${top.title}.`
      : `${intro}${top.title}. That's the biggest leak (≈${top.impactScore} orders lost per 1,000 sessions).`,
    { insights },
  );
  if (rest.length) {
    say(ctx, "analyst", `Also on the radar: ${rest.slice(0, 2).map((i) => i.title).join("; ")}.`);
  }
}

async function proposeNow(ctx: Persisted, deps: LoopDeps) {
  const live = getLiveSpec();
  const { exploreEvery } = deps.config;
  const explore = exploreEvery > 0 && (ctx.memory.proposals + 1) % exploreEvery === 0;

  let proposal: ChangeProposal | null = null;
  if (deps.useLlm) {
    const res = await proposeWithLlm(
      ctx.state.insights,
      live,
      ctx.memory.tried.map((t) => ({ title: t.title, patch: t.patch, outcome: t.outcome, lift: t.lift })),
      { explore },
    );
    proposal = res.proposal;
    if (!proposal) say(ctx, "designer", `LLM idea discarded (${res.reason}). Falling back to the playbook.`);
  }
  proposal ??= propose(
    ctx.state.insights,
    live,
    ctx.memory.tried.map((t) => t.patch),
    { explore },
  );

  if (!proposal) {
    ctx.state.phase = "idle";
    ctx.state.proposal = undefined;
    kvSet(AUTOPILOT_KEY, false);
    say(
      ctx,
      "designer",
      `Out of untested ideas for v${live.version}: every playbook move has shipped or lost. Darwin is resting (autopilot off).`,
    );
    return;
  }

  ctx.memory.proposals += 1;
  ctx.state.proposal = proposal;
  ctx.state.phase = "propose";
  const idea = ideaForProposal(proposal);
  const wildcard = explore && Boolean(idea?.risky || idea?.creative);
  const why = firstSentence(idea?.hypothesis ?? proposal.hypothesis);
  say(
    ctx,
    "designer",
    `${wildcard ? "Wildcard" : "Proposal"}: ${proposal.title}. ${why} Expected lift ${signedPct(proposal.expectedLift)}` +
      `${idea?.risky ? " (risky: could backfire)" : ""}.`,
    { proposal },
  );
}

async function startExperiment(ctx: Persisted, deps: LoopDeps) {
  const proposal = ctx.state.proposal;
  if (!proposal) {
    say(ctx, "system", "No proposal to test; going back to diagnosis.");
    return diagnoseNow(ctx, deps);
  }
  stopRunningExperiments();
  const live = getLiveSpec();
  const treatment = applyPatch(live, proposal.patch);
  const attempt = listExperiments().filter((e) => e.controlVersion === live.version).length + 1;
  const exp: Experiment = {
    id: id("exp"),
    name: proposal.title,
    status: "running",
    createdAt: new Date().toISOString(),
    proposalId: proposal.id,
    controlVersion: live.version,
    treatmentSpec: { ...treatment, version: candidateVersion(live.version, attempt), label: `Candidate: ${proposal.title}` },
    allocation: deps.config.allocation,
    primaryMetric: "order_completed",
  };
  saveExperiment(exp);

  ctx.memory.round = 0;
  ctx.state.experimentId = exp.id;
  ctx.state.phase = "experiment";
  const audience = metricAudience(proposal.patch);
  say(
    ctx,
    "experimenter",
    `A/B test live: ${pct(exp.allocation)} of shoppers and agents now get "${proposal.title}"; the rest stay on v${live.version}.` +
      (audience === "agent" ? " Humans can't see this change, so we judge it on AI shoppers only." : ""),
    { experimentId: exp.id, controlVersion: live.version, treatmentVersion: exp.treatmentSpec.version, audience },
  );
  await runRound(ctx, deps, exp);
}

/** Which visitors an experiment's decision is measured on (see stats.metricAudience). */
function experimentAudience(ctx: Persisted, exp: Experiment) {
  const control = getSpecVersion(exp.controlVersion) ?? getLiveSpec();
  return metricAudience(ctx.state.proposal?.patch ?? diffPatch(control, exp.treatmentSpec));
}

async function runRound(ctx: Persisted, deps: LoopDeps, exp: Experiment) {
  const round = ctx.memory.round + 1;
  await runTraffic(ctx, deps, deps.config.roundHumans, deps.config.roundAgents);
  ctx.memory.round = round;
  const audience = experimentAudience(ctx, exp);
  const { result, synthetic } = evaluateExperiment(exp.id, round, deps.config, audience);
  saveExperiment({ ...exp, result });

  const c = segment(result.control, audience);
  const t = segment(result.treatment, audience);
  const unit = audience === "agent" ? "agents" : "visitors";
  say(
    ctx,
    "experimenter",
    `Round ${round}${audience === "agent" ? " (AI shoppers)" : ""}: control ${pct(c.conversionRate)} (${num(c.visitors)} ${unit}) ` +
      `vs candidate ${pct(t.conversionRate)} (${num(t.visitors)}). P(candidate wins) ${pct(result.probabilityToBeat)}.`,
    { experimentId: exp.id, round, result, synthetic },
  );
  if (result.decision !== "running") {
    ctx.state.phase = "decide";
    say(ctx, "experimenter", verdict(result, round), { experimentId: exp.id, result });
  }
}

async function experimentStep(ctx: Persisted, deps: LoopDeps) {
  const exp = ctx.state.experimentId ? getExperiment(ctx.state.experimentId) : undefined;
  if (!exp || exp.status !== "running") {
    say(ctx, "system", "The running experiment is gone (reset elsewhere?). Re-diagnosing.");
    ctx.state.experimentId = undefined;
    return diagnoseNow(ctx, deps);
  }
  if (exp.result && exp.result.decision !== "running") {
    ctx.state.phase = "decide";
    say(ctx, "experimenter", verdict(exp.result, ctx.memory.round), { experimentId: exp.id, result: exp.result });
    return;
  }
  await runRound(ctx, deps, exp);
}

async function decideStep(ctx: Persisted, deps: LoopDeps) {
  const exp = ctx.state.experimentId ? getExperiment(ctx.state.experimentId) : undefined;
  const result = exp?.result;
  if (!exp || !result) {
    say(ctx, "system", "Lost track of the experiment result. Re-diagnosing.");
    ctx.state.experimentId = undefined;
    return diagnoseNow(ctx, deps);
  }
  if (result.decision === "running") {
    ctx.state.phase = "experiment";
    return runRound(ctx, deps, exp);
  }
  if (result.decision === "ship") return ship(ctx, deps, exp, result);

  const now = new Date().toISOString();
  saveExperiment({ ...exp, status: "completed", completedAt: now });
  const control = getSpecVersion(exp.controlVersion) ?? getLiveSpec();
  ctx.memory.tried.push({
    title: exp.name,
    patch: ctx.state.proposal?.patch ?? diffPatch(control, exp.treatmentSpec),
    outcome: result.decision === "reject" ? "rejected" : "inconclusive",
    experimentId: exp.id,
    lift: result.lift,
    probabilityToBeat: result.probabilityToBeat,
    generation: ctx.state.generation,
  });
  ctx.state.proposal = undefined;
  ctx.state.experimentId = undefined;
  say(
    ctx,
    "experimenter",
    result.decision === "reject"
      ? `Shelved "${exp.name}": it lost. Darwin won't try it again.`
      : `Shelved "${exp.name}": no clear signal after ${ctx.memory.round} rounds. Not worth shipping on a hunch.`,
    { experimentId: exp.id, decision: result.decision },
  );
  await diagnoseNow(ctx, deps, "Back to the data. ");
}

async function ship(ctx: Persisted, deps: LoopDeps, exp: Experiment, result: ExperimentResult) {
  const before = getLiveSpec();
  const generation = ctx.state.generation + 1;
  const promoted = promoteSpec(exp.treatmentSpec, `Gen ${generation}: ${exp.name}`);
  const now = new Date().toISOString();
  const completed = saveExperiment({ ...exp, status: "completed", completedAt: now, result });
  const proposal = ctx.state.proposal;
  const diff = proposal?.diff ?? describeDiff(before, promoted);

  ctx.memory.tried.push({
    title: exp.name,
    patch: proposal?.patch ?? diffPatch(before, promoted),
    outcome: "shipped",
    experimentId: exp.id,
    lift: result.lift,
    probabilityToBeat: result.probabilityToBeat,
    generation,
  });
  ctx.state.generation = generation;
  ctx.state.phase = "ship";
  say(ctx, "shipper", `Shipped v${promoted.version} "${promoted.label}" to 100% of traffic.`, {
    specVersion: promoted.version,
    diff,
  });

  let prUrl: string | undefined;
  const repo = deps.config.targetRepo ? parseRepo(deps.config.targetRepo) : undefined;
  if (!repo) {
    say(ctx, "shipper", "No DARWIN_TARGET_REPO configured, so no pull request this time.");
  } else {
    try {
      const pr = await deps.openSpecPR(repo, promoted, {
        experiment: completed,
        summary: prBody({
          experiment: completed,
          result,
          promoted,
          proposal,
          insights: ctx.state.insights,
          diff,
          synthetic: experimentArms(exp.id).synthetic,
        }),
      });
      prUrl = pr.url;
      const prData = { url: pr.url, number: pr.number, branch: pr.branch, title: pr.title, dryRun: pr.dryRun };
      say(
        ctx,
        "shipper",
        pr.url && !pr.dryRun
          ? `Pull request${pr.number ? ` #${pr.number}` : ""} opened: ${pr.url}`
          : `PR drafted (dry run, no GitHub token): "${pr.title}" on branch ${pr.branch}.`,
        { pr: prData },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      say(ctx, "shipper", `PR queued (dry run): GitHub integration unavailable (${reason.slice(0, 80)}).`, {
        pr: { dryRun: true, queued: true, repo: `${repo.owner}/${repo.repo}` },
      });
    }
  }

  const t = result.treatment;
  const record: GenerationRecord = {
    generation,
    specVersion: promoted.version,
    label: promoted.label,
    humanConversionRate: t.byKind.human.conversionRate,
    agentConversionRate: t.byKind.agent.conversionRate,
    overallConversionRate: t.conversionRate,
    experimentId: exp.id,
    lift: result.lift,
    ...(prUrl ? { prUrl } : {}),
    shippedAt: now,
  };
  ctx.state.history.push(record);
  const base = ctx.state.history[0];
  if (base && base !== record) {
    const agentsOnly = result.audience === "agent";
    const from = agentsOnly ? base.agentConversionRate : base.overallConversionRate;
    const to = agentsOnly ? record.agentConversionRate : record.overallConversionRate;
    const total = relativeLift(from, to);
    say(
      ctx,
      "shipper",
      `Gen ${generation} is live. ${agentsOnly ? "AI shopper conversion" : "Conversion"} ${pct(from)} → ${pct(to)} since Gen 0` +
        `${total !== undefined ? ` (${signedPct(total)})` : ""}.`,
      { generation: record },
    );
  }
}

/* ------------------------------------------------------------------ public API */

export function getLoopState(): LoopState {
  const p = readPersisted();
  return { ...p.state, autopilot: autopilotOn(), liveSpec: getLiveSpec() };
}

/**
 * Advance the loop by exactly one phase. If a step is already in flight, returns the current state
 * without doing anything (the console may double-fire on autopilot).
 */
export async function stepLoop(overrides?: LoopOverrides): Promise<LoopState> {
  const rt = runtime();
  if (rt.busy) return getLoopState();
  rt.busy = true;
  const ctx = load();
  try {
    const deps = resolveDeps(overrides);
    switch (ctx.state.phase) {
      case "idle":
      case "ship":
        await observe(ctx, deps);
        break;
      case "observe":
        await diagnoseNow(ctx, deps);
        break;
      case "diagnose":
        await proposeNow(ctx, deps);
        break;
      case "propose":
        await startExperiment(ctx, deps);
        break;
      case "experiment":
        await experimentStep(ctx, deps);
        break;
      case "decide":
        await decideStep(ctx, deps);
        break;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[loop] step failed", err);
    say(ctx, "system", `Step failed during ${ctx.state.phase}: ${reason.slice(0, 160)}. Will retry on the next step.`);
  } finally {
    save(ctx);
    rt.busy = false;
  }
  return getLoopState();
}

export function setAutopilot(on: boolean): LoopState {
  const was = autopilotOn();
  kvSet(AUTOPILOT_KEY, on);
  if (was !== on) {
    const rt = runtime();
    const current = readPersisted().state;
    const entry: LoopLogEntry = {
      at: new Date().toISOString(),
      phase: current.phase,
      actor: "system",
      message: on ? "Autopilot on: Darwin keeps evolving the store on its own." : "Autopilot off: stepping manually.",
    };
    if (rt.busy) rt.pending.push(entry);
    else {
      const ctx = load();
      ctx.state.log.push(entry);
      save(ctx);
    }
  }
  return getLoopState();
}

async function waitForIdle(timeoutMs = 120_000) {
  const start = Date.now();
  while (runtime().busy && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Reset everything (spec, experiments, events, agent sessions, loop) back to Gen 0. */
export async function resetLoop(): Promise<LoopState> {
  await waitForIdle();
  const rt = runtime();
  rt.busy = true;
  try {
    eventStore().clear();
    resetSpec();
    resetExperiments();
    for (const key of Object.values(AGENT_KV_KEYS)) kvDelete(key);
    kvSet(AUTOPILOT_KEY, false);
    rt.pending = [];
    const fresh = initialPersisted();
    say(fresh, "system", "Reset to Gen 0: events, experiments, agent sessions and the live spec are back to baseline.");
    save(fresh);
  } finally {
    rt.busy = false;
  }
  return getLoopState();
}
