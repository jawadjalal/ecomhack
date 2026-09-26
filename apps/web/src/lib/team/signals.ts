/**
 * What the team looks at every 15 minutes, and the signals it comes back with. OWNED BY: team.
 *
 * Iris and Fizz do the sweep in parallel (Dash adds the pull-request check, because that's its tool), each
 * through the team's real tool registry — the same tools they use in chat — so every fact in a signal is a
 * line from a tool result in that run, with the tool's name as its source. Nothing here computes a
 * statistic the owning area doesn't already report: test decisions come from the briefing (which reads the
 * optimiser, web and store-agent verdicts), and the only arithmetic done here is the difference between two
 * counts the tools returned.
 *
 * A check that fails doesn't stop the run: it comes back with an error and Darwin says he couldn't look.
 */
import type { AgentId } from "@/lib/contracts/team";
import type { Signal, SignalKind, SignalSeverity, WatchAction } from "@/lib/contracts/watch";
import type { Briefing, BriefingItem } from "@/lib/briefing";
import { getBriefing } from "@/lib/briefing";
import { getLoopState } from "@/lib/optimizer";
import { recentCertificate, CERT_VALID_DAYS } from "@/lib/readiness";
import { listReports, getReport } from "@/lib/research";
import { DEMO_SITE, webState } from "@/lib/web";
import { id } from "@/lib/ids";
import { listMemory, recordKpiPoint, updateMemory, type KpiPoint, type MemoryEntry } from "./watch-store";

/* ------------------------------------------------------------------ the shape of a check */

export interface WatchToolResult {
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  synthetic?: boolean;
}

export interface CheckContext {
  now: number;
  origin: string;
  /** Run one of the team's tools; counted against the run's budget. Never throws. */
  call: (tool: string, args?: Record<string, unknown>) => Promise<WatchToolResult>;
  /** True when the run has no budget left: a check should stop and return what it has. */
  exhausted: () => boolean;
  /** When the previous watch run finished (undefined on the first run). */
  lastRunAt?: string;
  /** Signals from earlier runs, newest first (for "has this changed?" checks). */
  previous: Signal[];
}

export interface Check {
  id: string;
  agent: AgentId;
  /** What the merchant sees in "the team looked at…". */
  label: string;
  run: (ctx: CheckContext) => Promise<Signal[]>;
}

/* ------------------------------------------------------------------ small helpers */

const pct = (x: number) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const num = (n: number) => n.toLocaleString("en-GB");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Draft {
  kind: SignalKind;
  agent: AgentId;
  severity: SignalSeverity;
  title: string;
  facts: string[];
  sources: string[];
  synthetic: boolean;
  fingerprint: string;
  score?: number;
  suggestedAction?: WatchAction;
  href?: string;
  data?: Record<string, unknown>;
}

function signal(draft: Draft, at: number): Signal {
  return { id: id("sig"), at: new Date(at).toISOString(), ...draft };
}

/** The newest earlier signal of this kind whose fingerprint starts with `prefix`. */
function previousOf(ctx: CheckContext, kind: SignalKind, prefix?: string): Signal | undefined {
  return ctx.previous.find((s) => s.kind === kind && (!prefix || s.fingerprint.startsWith(prefix)));
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/* ------------------------------------------------------------------ 1. tests that reached a decision (Fizz) */

const DECISIVE = new Set<BriefingItem["status"]>(["ready", "winning", "losing"]);

const SEVERITY_OF: Partial<Record<BriefingItem["status"], SignalSeverity>> = { ready: "high", winning: "normal", losing: "normal" };

/**
 * The briefing already knows which tests cleared their owner's bar; it computes no statistics of its own and
 * neither do we. One signal per decisive test, plus a quiet one for anything that shipped or stopped today.
 */
export const testsCheck: Check = {
  id: "tests",
  agent: "fizz",
  label: "tests that reached a decision",
  async run(ctx) {
    const briefing: Briefing = await getBriefing({ origin: ctx.origin });
    const out: Signal[] = [];
    for (const item of briefing.items) {
      const synthetic = item.traffic !== "real";
      if (DECISIVE.has(item.status) && item.actions.length) {
        const action: WatchAction | undefined =
          item.status === "losing"
            ? item.actions.includes("stop")
              ? { type: "briefing", id: item.id, action: "stop", title: item.title }
              : undefined
            : item.actions.includes("ship")
              ? { type: "briefing", id: item.id, action: "ship", title: item.title }
              : undefined;
        const p = item.probabilityToBeat;
        out.push(
          signal(
            {
              kind: "experiment_decided",
              agent: "fizz",
              severity: SEVERITY_OF[item.status] ?? "normal",
              title: `“${item.title}” is ${item.status}`,
              facts: [item.say],
              sources: ["briefing"],
              synthetic,
              fingerprint: `test:${item.id}:${item.status}`,
              score: item.status === "losing" ? (p === undefined ? 0.6 : 1 - p) : (p ?? 0.5),
              ...(action ? { suggestedAction: action } : {}),
              href: consolePath(item.url, ctx.origin),
              data: { itemId: item.id, status: item.status, probabilityToBeat: p, lift: item.lift, sample: item.sample, traffic: item.traffic },
            },
            ctx.now,
          ),
        );
      } else if ((item.status === "shipped" || item.status === "stopped") && item.endedAt && ctx.now - Date.parse(item.endedAt) < DAY) {
        out.push(
          signal(
            {
              kind: "experiment_decided",
              agent: "fizz",
              severity: "low",
              title: `“${item.title}” ${item.status}`,
              facts: [item.say],
              sources: ["briefing"],
              synthetic,
              fingerprint: `test:${item.id}:${item.status}`,
              score: 0.2,
              href: consolePath(item.url, ctx.origin),
              data: { itemId: item.id, status: item.status },
            },
            ctx.now,
          ),
        );
      }
    }
    return out;
  },
};

/** Briefing urls are absolute (they're written for a bot); the console wants a path. */
function consolePath(url: string | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith(origin) ? url.slice(origin.length) || "/console" : url;
}

/* ------------------------------------------------------------------ 2. a KPI outside its usual band (Iris) */

/** Real visitors a window needs before it counts, and how many past windows make a band. */
export const KPI_MIN_WINDOW_VISITORS = 100;
export const KPI_MIN_WINDOWS = 5;
/** How far outside the band (in standard deviations) and how big a relative move before Darwin cares. */
export const KPI_SIGMA = 2;
export const KPI_MIN_RELATIVE_MOVE = 0.15;

interface Window {
  visitors: number;
  orders: number;
  rate: number;
}

/** Windows between consecutive readings: only the traffic that arrived since the last watch run. */
export function kpiWindows(points: KpiPoint[], minVisitors = KPI_MIN_WINDOW_VISITORS): Window[] {
  const out: Window[] = [];
  for (let i = 1; i < points.length; i++) {
    const visitors = points[i].visitors - points[i - 1].visitors;
    const orders = points[i].orders - points[i - 1].orders;
    if (visitors >= minVisitors && orders >= 0) out.push({ visitors, orders, rate: orders / visitors });
  }
  return out;
}

function meanAndSigma(values: number[]): { mean: number; sigma: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sigma: Math.sqrt(variance) };
}

/** Conversion on real traffic, against the band of what this store usually does. Simulated traffic excluded. */
export const kpiCheck: Check = {
  id: "kpis",
  agent: "iris",
  label: "conversion on real traffic",
  async run(ctx) {
    const res = await ctx.call("get_kpis", { realOnly: true });
    if (!res.ok) throw new Error(res.summary);
    const overall = asRecord(asRecord(res.data).overall);
    const visitors = asNumber(overall.visitors) ?? 0;
    const orders = asNumber(overall.orders) ?? 0;
    const revenuePence = asNumber(overall.revenuePence) ?? 0;
    const points = recordKpiPoint({ at: new Date(ctx.now).toISOString(), visitors, orders, revenuePence });
    const windows = kpiWindows(points);
    if (windows.length < KPI_MIN_WINDOWS + 1) return [];

    const current = windows[windows.length - 1];
    const past = windows.slice(0, -1).map((w) => w.rate);
    const { mean, sigma } = meanAndSigma(past);
    if (!(mean > 0) || !(sigma > 0)) return [];
    const z = (current.rate - mean) / sigma;
    const move = current.rate / mean - 1;
    if (Math.abs(z) < KPI_SIGMA || Math.abs(move) < KPI_MIN_RELATIVE_MOVE) return [];

    const down = move < 0;
    return [
      signal(
        {
          kind: "kpi_band",
          agent: "iris",
          severity: down ? "high" : "normal",
          title: `Conversion ${down ? "dropped" : "jumped"} on real traffic`,
          facts: [
            `Real visitors converted at ${pct(current.rate)} over the last ${num(current.visitors)} visitors (${num(current.orders)} orders), against ${pct(mean)} across the previous ${past.length} checks.`,
          ],
          sources: ["get_kpis"],
          synthetic: false,
          fingerprint: `kpi:conversion:${down ? "down" : "up"}`,
          score: Math.min(1, Math.abs(z) / 4),
          suggestedAction: { type: "open", href: "/console/traffic" },
          href: "/console/traffic",
          data: { rate: current.rate, mean, visitors: current.visitors, orders: current.orders, windows: past.length },
        },
        ctx.now,
      ),
    ];
  },
};

/* ------------------------------------------------------------------ 3. the AI-shopper funnel (Iris) */

export const FUNNEL_MIN_CONVERSATIONS = 20;
/** A step that keeps less than this share of the agents before it is worth a word. */
export const FUNNEL_DROP = 0.5;

/** Where buyer agents fall out of the store agent's funnel: conversation → offers → checkout → paid. */
export const agentFunnelCheck: Check = {
  id: "agent-funnel",
  agent: "iris",
  label: "the AI shopper funnel",
  async run(ctx) {
    const res = await ctx.call("agent_funnel");
    if (!res.ok) throw new Error(res.summary);
    const f = asRecord(res.data);
    const conversations = asNumber(f.conversations) ?? 0;
    if (conversations < FUNNEL_MIN_CONVERSATIONS) return [];
    const steps: { from: string; to: string; before: number; after: number }[] = [
      { from: "conversations", to: "offers", before: conversations, after: asNumber(f.offersShown) ?? 0 },
      { from: "offers", to: "a checkout link", before: asNumber(f.offersShown) ?? 0, after: asNumber(f.checkouts) ?? 0 },
      { from: "checkout links", to: "a payment", before: asNumber(f.checkouts) ?? 0, after: asNumber(f.paid) ?? 0 },
    ];
    const worst = steps
      .filter((s) => s.before > 0)
      .map((s) => ({ ...s, kept: s.after / s.before }))
      .sort((a, b) => a.kept - b.kept)[0];
    if (!worst || worst.kept >= FUNNEL_DROP) return [];
    const simulated = asNumber(f.simulated) ?? 0;
    return [
      signal(
        {
          kind: "agent_funnel_drop",
          agent: "iris",
          severity: worst.to === "a payment" && worst.after === 0 ? "high" : "normal",
          title: `AI shoppers drop at ${worst.to}`,
          facts: [
            `${num(worst.after)} of ${num(worst.before)} ${worst.from} reached ${worst.to} (${pct(worst.kept)}).`,
            res.summary.split("\n")[0],
          ],
          sources: ["agent_funnel"],
          synthetic: simulated > 0,
          fingerprint: `funnel:${worst.to}`,
          score: 1 - worst.kept,
          suggestedAction: { type: "open", href: "/console/agents" },
          href: "/console/agents",
          data: { step: worst.to, before: worst.before, after: worst.after, conversations, simulated },
        },
        ctx.now,
      ),
    ];
  },
};


/* ------------------------------------------------------------------ 4. pull requests (Dash) */

/** An open pull request nobody has touched for this long is "waiting". */
export const PR_WAITING_MS = 6 * HOUR;

/** The newest pull request Darwin opened: merged, failing its checks, or sitting there. */
export const pullRequestCheck: Check = {
  id: "pull-requests",
  agent: "dash",
  label: "your pull requests",
  async run(ctx) {
    const res = await ctx.call("pr_status");
    if (!res.ok) return []; // no repo connected yet: nothing to say, and nothing failed
    const pr = asRecord(res.data);
    const state = typeof pr.state === "string" ? pr.state : "";
    if (!state || state === "preview") return [];
    const number = asNumber(pr.number);
    const checks = asRecord(pr.checks).state;
    const title = typeof pr.title === "string" ? pr.title : `PR #${number ?? "?"}`;
    const label = `${number ? `PR #${number}` : "The pull request"} (“${title}”)`;
    const base = { agent: "dash" as const, sources: ["pr_status"], synthetic: false, href: "/console/pulls" };

    if (checks === "failure" && state === "open") {
      return [
        signal(
          {
            ...base,
            kind: "pr_state",
            severity: "high",
            title: `${label} is failing its checks`,
            facts: [`${label} is open with failing checks, so nothing from it is live.`],
            fingerprint: `pr:${number ?? title}:checks-failed`,
            score: 0.9,
            suggestedAction: { type: "tool", agent: "dash", tool: "pr_status", args: number ? { number } : {} },
            data: { number, state, checks },
          },
          ctx.now,
        ),
      ];
    }
    if (state === "merged") {
      return [
        signal(
          {
            ...base,
            kind: "pr_state",
            severity: "low",
            title: `${label} merged`,
            facts: [`${label} is merged.`],
            fingerprint: `pr:${number ?? title}:merged`,
            score: 0.2,
            data: { number, state },
          },
          ctx.now,
        ),
      ];
    }
    if (state === "open") {
      const previous = previousOf(ctx, "pr_state", `pr:${number ?? title}`);
      const openedAt = previous ? Date.parse(previous.at) : undefined;
      const waited = openedAt ? ctx.now - openedAt : 0;
      if (waited < PR_WAITING_MS) {
        // First sighting: remember it quietly so "waiting" means waiting, not "just opened".
        return [
          signal(
            {
              ...base,
              kind: "pr_state",
              severity: "low",
              title: `${label} is open`,
              facts: [`${label} is open${checks === "pending" ? " with checks still running" : ""}.`],
              fingerprint: `pr:${number ?? title}:open`,
              score: 0.1,
              data: { number, state, checks },
            },
            ctx.now,
          ),
        ];
      }
      return [
        signal(
          {
            ...base,
            kind: "pr_state",
            severity: "normal",
            title: `${label} has been waiting`,
            facts: [`${label} has been open since I first saw it ${Math.round(waited / HOUR)} hours ago${pr.mergeable === false ? ", and it has conflicts" : ""}.`],
            fingerprint: `pr:${number ?? title}:waiting`,
            score: 0.5,
            suggestedAction: { type: "open", href: "/console/pulls" },
            data: { number, state, checks, waitedHours: Math.round(waited / HOUR) },
          },
          ctx.now,
        ),
      ];
    }
    return [];
  },
};


/* ------------------------------------------------------------------ 5. agent readiness (Iris) */

/** The store URL to watch: the first darwin.js site that has one, else DARWIN_STORE_URL. */
function storeUrl(): string | undefined {
  try {
    for (const site of webState(DEMO_SITE).sites ?? []) {
      if (site.url) return site.url;
    }
  } catch {
    /* no site connected */
  }
  return process.env.DARWIN_STORE_URL?.trim() || undefined;
}

/** Did the store's agent-readiness score move since the last time we saw a certificate? */
export const readinessCheck: Check = {
  id: "readiness",
  agent: "iris",
  label: "your agent-readiness score",
  async run(ctx) {
    const url = storeUrl();
    if (!url) return [];
    const cert = recentCertificate(url, CERT_VALID_DAYS * DAY, ctx.now);
    if (!cert) return [];
    const previous = previousOf(ctx, "readiness_change", "readiness:");
    const before = asNumber(asRecord(previous?.data).score);
    if (before === undefined) {
      return [
        signal(
          {
            kind: "readiness_change",
            agent: "iris",
            severity: "low",
            title: `${cert.origin} is at ${cert.score}/100 for AI shoppers`,
            facts: [`${cert.origin} holds a ${cert.level} agent-readiness certificate at ${cert.score}/100 (grade ${cert.grade}).`],
            sources: ["readiness"],
            synthetic: false,
            fingerprint: `readiness:${cert.origin}:${cert.score}`,
            score: 0.2,
            href: `/readiness?url=${encodeURIComponent(cert.url)}`,
            data: { score: cert.score, level: cert.level, origin: cert.origin },
          },
          ctx.now,
        ),
      ];
    }
    if (before === cert.score) return [];
    const down = cert.score < before;
    return [
      signal(
        {
          kind: "readiness_change",
          agent: "iris",
          severity: down ? "normal" : "low",
          title: `Agent readiness ${down ? "fell" : "rose"} to ${cert.score}/100`,
          facts: [`${cert.origin} moved from ${before}/100 to ${cert.score}/100 for AI shoppers (grade ${cert.grade}).`],
          sources: ["readiness"],
          synthetic: false,
          fingerprint: `readiness:${cert.origin}:${cert.score}`,
          score: down ? Math.min(1, (before - cert.score) / 20) : 0.2,
          suggestedAction: { type: "open", href: `/readiness?url=${encodeURIComponent(cert.url)}` },
          href: `/readiness?url=${encodeURIComponent(cert.url)}`,
          data: { score: cert.score, before, level: cert.level, origin: cert.origin },
        },
        ctx.now,
      ),
    ];
  },
};

/* ------------------------------------------------------------------ 6. research findings (Iris) */

/** A competitor or market report that landed since the last run. */
export const researchCheck: Check = {
  id: "research",
  agent: "iris",
  label: "competitor research",
  async run(ctx) {
    const newest = listReports()[0];
    if (!newest) return [];
    const seen = previousOf(ctx, "research_finding");
    if (seen?.data?.reportId === newest.id) return [];
    if (ctx.lastRunAt && newest.createdAt <= ctx.lastRunAt) return [];
    const report = getReport(newest.id);
    if (!report) return [];
    const finding = report.summary?.text?.trim();
    const suggestion = report.suggestions?.[0]?.title;
    if (!finding) return [];
    return [
      signal(
        {
          kind: "research_finding",
          agent: "iris",
          severity: "low",
          title: report.query ? `Research: ${report.query}` : "New competitor research",
          facts: [finding, suggestion ? `Worth testing: ${suggestion}.` : ""].filter(Boolean),
          sources: ["research"],
          // A demo report is a sample, not real research: label it like simulated traffic.
          synthetic: !!report.demo,
          fingerprint: `research:${report.id}`,
          score: 0.3,
          suggestedAction: { type: "open", href: "/console/research" },
          href: "/console/research",
          data: { reportId: report.id, competitors: report.competitors?.length ?? 0, sources: report.sources?.length ?? 0, demo: !!report.demo },
        },
        ctx.now,
      ),
    ];
  },
};

/* ------------------------------------------------------------------ 7. a loop that stopped moving (Fizz) */

export const LOOP_STUCK_MS = 3 * HOUR;
/** A decision waiting to be taken is more pressing than a loop merely idling. */
export const LOOP_DECIDE_STUCK_MS = HOUR;

export const loopCheck: Check = {
  id: "loop",
  agent: "fizz",
  label: "the optimisation loop",
  async run(ctx) {
    const res = await ctx.call("loop_status");
    if (!res.ok) throw new Error(res.summary);
    const state = getLoopState();
    if (state.phase === "idle") return [];
    const age = ctx.now - Date.parse(state.updatedAt);
    const limit = state.phase === "decide" ? LOOP_DECIDE_STUCK_MS : LOOP_STUCK_MS;
    if (!Number.isFinite(age) || age < limit) return [];
    const hours = Math.round(age / HOUR);
    return [
      signal(
        {
          kind: "loop_stuck",
          agent: "fizz",
          severity: state.phase === "decide" ? "normal" : "low",
          title: `The loop has been at “${state.phase}” for ${hours}h`,
          facts: [`Darwin's loop has sat at “${state.phase}” on Gen ${state.generation} for about ${hours} hours${state.autopilot ? " with autopilot on" : " with autopilot off"}.`],
          sources: ["loop_status"],
          synthetic: false,
          fingerprint: `loop:${state.phase}:${state.generation}`,
          score: state.phase === "decide" ? 0.6 : 0.3,
          suggestedAction: { type: "tool", agent: "fizz", tool: "step_loop", args: {} },
          href: "/console",
          data: { phase: state.phase, generation: state.generation, hours, autopilot: state.autopilot },
        },
        ctx.now,
      ),
    ];
  },
};

/* ------------------------------------------------------------------ 8. a week after a ship (Fizz) */

export const FOLLOW_UP_MS = 7 * DAY;

/** "The new checkout is still +8%": one follow-up per ship, a week later, same measure as the baseline. */
export const shipFollowUpCheck: Check = {
  id: "ship-follow-up",
  agent: "fizz",
  label: "how last week's changes are doing",
  async run(ctx) {
    const due: MemoryEntry[] = listMemory().filter((m) => m.kind === "shipped" && !m.followedUpAt && m.baseline !== undefined && ctx.now - Date.parse(m.at) >= FOLLOW_UP_MS);
    if (!due.length) return [];
    const entry = due[0];
    const res = await ctx.call("get_kpis");
    if (!res.ok) throw new Error(res.summary);
    const overall = asRecord(asRecord(res.data).overall);
    const rate = asNumber(overall.conversionRate);
    const visitors = asNumber(overall.visitors) ?? 0;
    if (rate === undefined || !visitors) return [];
    updateMemory(entry.id, { followedUpAt: new Date(ctx.now).toISOString() });
    const baseline = entry.baseline!;
    const change = baseline > 0 ? rate / baseline - 1 : undefined;
    const days = Math.round((ctx.now - Date.parse(entry.at)) / DAY);
    return [
      signal(
        {
          kind: "ship_followup",
          agent: "fizz",
          severity: "low",
          title: `${entry.label}: ${days} days on`,
          facts: [
            `Since “${entry.label}” shipped ${days} days ago, conversion went from ${pct(baseline)} to ${pct(rate)}${change === undefined ? "" : ` (${change >= 0 ? "+" : ""}${Math.round(change * 100)}%)`} across ${num(visitors)} visitors.`,
          ],
          sources: ["get_kpis"],
          synthetic: !!res.synthetic,
          fingerprint: `followup:${entry.id}`,
          score: change !== undefined && change < 0 ? Math.min(1, Math.abs(change)) : 0.25,
          href: "/console/changes",
          data: { memoryId: entry.id, baseline, rate, visitors, change },
        },
        ctx.now,
      ),
    ];
  },
};

/* ------------------------------------------------------------------ the sweep */

/** Every check, in the order the console lists them. Iris and Fizz do the sweep; Dash checks its own PRs. */
export const CHECKS: Check[] = [testsCheck, kpiCheck, agentFunnelCheck, pullRequestCheck, readinessCheck, researchCheck, loopCheck, shipFollowUpCheck];

export function checkById(checkId: string): Check | undefined {
  return CHECKS.find((c) => c.id === checkId);
}
