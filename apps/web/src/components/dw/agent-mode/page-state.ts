"use client";

/**
 * What's on a console page, as data: the same SWR hooks the pages use (useLoop, useExperiments, useSummary), shaped
 * into plain rows for people and a JSON object for agents. Only reports what the API returned; nothing is invented.
 */
import { PAGES, type PageKey } from "@/lib/commands";
import type { Experiment, LoopState, SegmentKpis } from "@/lib/contracts";
import { useExperiments, useLoop, useSummary } from "@/lib/console/hooks";
import { count, money, pct, signedPct } from "@/lib/console/format";
import { roadmapFor } from "@/lib/status/roadmap";
import { STATUS_LABEL, FIX_STATUS_LABEL, buildFixes, fmtImpact, rankIssues } from "../issues/model";

export interface StateRow {
  key: string;
  value: string;
}

export interface StateBlock {
  heading: string;
  rows: StateRow[];
  /** Shown when rows is empty. */
  empty?: string;
}

export interface PageState {
  loading: boolean;
  blocks: StateBlock[];
  /** Machine-readable copy of the page's key data. */
  json: Record<string, unknown>;
}

const DATA_PAGES = new Set<PageKey>(["overview", "issues", "fixes", "experiments", "changes"]);

function kpis(k: SegmentKpis | undefined) {
  if (!k) return undefined;
  return { visitors: k.visitors, sessions: k.sessions, orders: k.orders, revenue_pence: k.revenue, conversion_rate: k.conversionRate, aov_pence: k.averageOrderValue };
}

function kpiRow(label: string, k: SegmentKpis | undefined): StateRow {
  return { key: label, value: k ? `${count(k.visitors)} visitors · ${count(k.orders)} orders · ${pct(k.conversionRate)} conv · ${money(k.revenue)}` : "–" };
}

function experimentJson(e: Experiment) {
  const r = e.result;
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    allocation: e.allocation,
    control_version: e.controlVersion,
    created_at: e.createdAt,
    completed_at: e.completedAt,
    result: r
      ? {
          decision: r.decision,
          lift: r.lift,
          probability_to_beat: r.probabilityToBeat,
          lift_interval: r.liftInterval,
          control: { visitors: r.control.visitors, conversions: r.control.conversions, conversion_rate: r.control.conversionRate },
          treatment: { visitors: r.treatment.visitors, conversions: r.treatment.conversions, conversion_rate: r.treatment.conversionRate },
        }
      : null,
  };
}

function experimentRow(e: Experiment): StateRow {
  const r = e.result;
  const res = r
    ? ` · ${count(r.control.visitors + r.treatment.visitors)} visitors · lift ${signedPct(r.lift, 1)} · P(beat) ${pct(r.probabilityToBeat, 0)} · ${r.decision}`
    : " · no result yet";
  return { key: e.id, value: `${e.name} [${e.status}]${res}` };
}

function loopJson(loop: LoopState) {
  return { phase: loop.phase, generation: loop.generation, autopilot: loop.autopilot, designer: loop.designer ?? null, running_experiment_id: loop.experimentId ?? null, updated_at: loop.updatedAt };
}

export function usePageState(page: PageKey | undefined, pathname: string): PageState {
  const data = !!page && DATA_PAGES.has(page);
  const { loop } = useLoop();
  const experiments = useExperiments();
  // Same filters as the pages: Overview reads all traffic, Issues the live spec version.
  const { summary } = useSummary(page === "overview" ? {} : page === "issues" && loop ? { specVersion: loop.liveSpec.version } : null, page === "overview" ? 3000 : 5000);

  const base = { page: page ?? null, title: page ? PAGES[page].label : "This page", path: pathname };
  const synthNote = "Counts include simulated traffic (synthetic: true) when the simulator has run; the console labels it.";

  if (!data || !page) {
    const area = roadmapFor(pathname);
    return {
      loading: false,
      blocks: [
        {
          heading: "Page",
          rows: area
            ? [
                { key: "area", value: area.name },
                { key: "status", value: area.inProgress ? `${area.status}: ${area.inProgress}` : area.status },
                { key: "what works", value: area.done },
                ...area.leftToDo.map((t, i) => ({ key: `left ${i + 1}`, value: t })),
              ]
            : [],
          empty: "No roadmap entry for this page.",
        },
      ],
      json: { ...base, whats_left: area ? { area: area.key, status: area.status, in_progress: area.inProgress ?? null, done: area.done, left_to_do: area.leftToDo, limitations: area.limitations } : null },
    };
  }

  const loading = !loop;
  const blocks: StateBlock[] = [];
  const json: Record<string, unknown> = { ...base, loop: loop ? loopJson(loop) : null };

  if (loop) {
    blocks.push({
      heading: "Loop",
      rows: [
        { key: "phase", value: loop.phase },
        { key: "generation", value: String(loop.generation) },
        { key: "autopilot", value: loop.autopilot ? "on" : "off" },
        { key: "running test", value: loop.experimentId ?? "none" },
      ],
    });
  }

  switch (page) {
    case "overview": {
      blocks.push({ heading: "Conversion (all traffic)", rows: summary ? [kpiRow("all", summary.overall), kpiRow("humans", summary.byKind.human), kpiRow("agents", summary.byKind.agent)] : [], empty: "Loading analytics…" });
      const top = rankIssues(loop, experiments).slice(0, 3);
      blocks.push({ heading: "Top issues", rows: top.map((r) => ({ key: `#${r.n} −${fmtImpact(r.insight.impactScore)}/1k`, value: `${r.insight.title} (${r.who}, ${r.where})` })), empty: "No issues found yet." });
      json.kpis = summary ? { overall: kpis(summary.overall), human: kpis(summary.byKind.human), agent: kpis(summary.byKind.agent), total_events: summary.totalEvents, window: { from: summary.from, to: summary.to } } : null;
      json.top_issues = top.map(({ insight: i, n, status }) => ({ rank: n, id: i.id, title: i.title, audience: i.audience, severity: i.severity, stage: i.stage, buyers_lost_per_1k_visits: i.impactScore, status: STATUS_LABEL[status] }));
      json.running_experiments = (experiments ?? []).filter((e) => e.status === "running").map(experimentJson);
      json.note = synthNote;
      break;
    }
    case "issues": {
      const list = rankIssues(loop, experiments);
      blocks.push({
        heading: `Issues (${list.length})`,
        rows: list.map(({ insight: i, n, status, who, where }) => ({ key: `#${n} −${fmtImpact(i.impactScore)}/1k`, value: `${i.title} — ${who}, ${where}. ${STATUS_LABEL[status]}. ${i.detail}` })),
        empty: loop ? "No issues found yet. Step the loop to diagnose." : "Loading…",
      });
      const friction = (summary?.friction ?? []).slice().sort((a, b) => b.count - a.count).slice(0, 6);
      blocks.push({ heading: "Friction signals (live spec)", rows: friction.map((f) => ({ key: f.kind, value: `${f.audience} at ${f.location}: ${count(f.count)} (${pct(f.share)})` })), empty: summary ? "No friction recorded." : "Loading analytics…" });
      json.issues = list.map(({ insight: i, n, status, who, where }) => ({ rank: n, id: i.id, title: i.title, who, where, audience: i.audience, severity: i.severity, stage: i.stage, status: STATUS_LABEL[status], detail: i.detail, evidence: i.evidence, buyers_lost_per_1k_visits: i.impactScore }));
      json.friction = friction;
      json.note = synthNote;
      break;
    }
    case "fixes": {
      const fixes = buildFixes(loop, experiments);
      blocks.push({
        heading: `Fixes (${fixes.length})`,
        rows: fixes.map((f) => {
          const lift = f.lift !== undefined ? ` · measured lift ${signedPct(f.lift, 1)}` : f.expectedLift !== undefined ? ` · expected lift ${signedPct(f.expectedLift, 1)}` : "";
          return { key: FIX_STATUS_LABEL[f.status], value: `${f.title}${lift}${f.generation !== undefined ? ` · gen ${f.generation}` : ""}${f.prUrl ? ` · ${f.prUrl}` : ""}` };
        }),
        empty: loop ? "No fixes yet. Step the loop past diagnose to get one." : "Loading…",
      });
      json.fixes = fixes.map((f) => ({ id: f.id, title: f.title, status: f.status, hypothesis: f.hypothesis ?? null, diff: f.diff, insight_ids: f.insightIds, expected_lift: f.expectedLift ?? null, measured_lift: f.lift ?? null, probability_to_beat: f.probability ?? null, experiment_id: f.experiment?.id ?? null, generation: f.generation ?? null, pr_url: f.prUrl ?? null, source: f.source ?? null, created_at: f.createdAt }));
      break;
    }
    case "experiments": {
      blocks.push({ heading: `Experiments (${experiments?.length ?? 0})`, rows: (experiments ?? []).map(experimentRow), empty: experiments ? "No experiments yet." : "Loading…" });
      json.experiments = (experiments ?? []).map(experimentJson);
      json.note = synthNote;
      break;
    }
    case "changes": {
      const hist = (loop?.history ?? []).slice().sort((a, b) => b.generation - a.generation);
      blocks.push({
        heading: `Generations shipped (${hist.length})`,
        rows: hist.map((g) => ({ key: `gen ${g.generation}`, value: `${g.label} · ${pct(g.overallConversionRate)} conv (humans ${pct(g.humanConversionRate)}, agents ${pct(g.agentConversionRate)})${g.lift !== undefined ? ` · lift ${signedPct(g.lift, 1)}` : ""}${g.prUrl ? ` · ${g.prUrl}` : ""}` })),
        empty: "Nothing shipped yet.",
      });
      json.live_spec_version = loop?.liveSpec?.version ?? null;
      json.generations = hist;
      break;
    }
  }

  return { loading, blocks, json };
}
