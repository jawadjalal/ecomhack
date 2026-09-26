/**
 * Issues + Fixes: pure derivations from the loop state, experiments and agent sessions.
 *
 * Everything here reads real data. Issues are `loop.insights` ranked by impact (buyers lost per
 * 1,000 visits). Fixes are every proposal Darwin has written, recovered from the loop log (the
 * designer logs `{ proposal }`), the current `loop.proposal`, and experiments whose proposal has
 * aged out of the capped log.
 */
import type { AgentSessionSummary, ChangeProposal, Experiment, Insight, LoopState } from "@/lib/contracts";

/* ------------------------------------------------------------------ numbers */

/** 9.5 → "9.5", 36.2 → "36", 0 → "0". Buyers lost per 1,000 visits. */
export function fmtImpact(v: number): string {
  if (!Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 10) return String(Math.round(a));
  const s = a.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** [1, 2, 3] → "1, 2 and 3". */
export function listJoin(items: (string | number)[]): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join("");
  return `${s.slice(0, -1).join(", ")} and ${s.at(-1)}`;
}

/* ------------------------------------------------------------------ issues */

export type IssueStatus = "test" | "drafted" | "queued";
export type StageKey = "home" | "product" | "cart" | "checkout";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "product", label: "Product" },
  { key: "cart", label: "Cart" },
  { key: "checkout", label: "Checkout" },
];

export const STATUS_LABEL: Record<IssueStatus, string> = { test: "In test B", drafted: "Drafted", queued: "Queued" };

export interface IssueRow {
  insight: Insight;
  /** 1-based rank, biggest first. */
  n: number;
  status: IssueStatus;
  who: "Agents" | "People" | "Everyone";
  stage: StageKey;
  /** "at checkout", "in the agent catalog" … */
  where: string;
}

export function stageKey(stage: string): StageKey {
  const s = stage.toLowerCase();
  if (/home|landing/.test(s)) return "home";
  if (/checkout|payment|order/.test(s)) return "checkout";
  if (/cart|bag|basket/.test(s)) return "cart";
  return "product";
}

export function whereText(stage: string): string {
  const s = stage.toLowerCase().trim();
  if (s.startsWith("agent:")) {
    const rest = s.slice(6).trim();
    return rest === "checkout" ? "at agent checkout" : `in the agent ${rest || "API"}`;
  }
  if (/home|landing/.test(s)) return "on the home page";
  if (/product/.test(s)) return "on product pages";
  if (/cart|bag/.test(s)) return "in the bag";
  if (/checkout/.test(s)) return "at checkout";
  return `at ${s}`;
}

export function whoOf(a: Insight["audience"]): IssueRow["who"] {
  return a === "agent" ? "Agents" : a === "human" ? "People" : "Everyone";
}

/** Is the loop's current proposal being A/B tested right now? */
export function proposalInTest(loop: LoopState, experiments: Experiment[] | undefined): boolean {
  const p = loop.proposal;
  if (!p) return false;
  const exp = experiments?.find((e) => e.proposalId === p.id);
  if (exp) return exp.status === "running";
  return Boolean(loop.experimentId) && (loop.phase === "experiment" || loop.phase === "decide");
}

export function rankIssues(loop: LoopState | undefined, experiments: Experiment[] | undefined): IssueRow[] {
  if (!loop) return [];
  const covered = new Set(loop.proposal?.insightIds ?? []);
  const testing = proposalInTest(loop, experiments);
  return [...loop.insights]
    .sort((a, b) => b.impactScore - a.impactScore)
    .map((insight, i) => ({
      insight,
      n: i + 1,
      status: covered.has(insight.id) ? (testing ? "test" : "drafted") : "queued",
      who: whoOf(insight.audience),
      stage: stageKey(insight.stage),
      where: whereText(insight.stage),
    }));
}

/** "Darwin found them in … The first K are already being fixed in test B." — always from real ranks. */
export function coverageSentence(rows: IssueRow[]): string {
  const inTest = rows.filter((r) => r.status === "test").map((r) => r.n);
  const drafted = rows.filter((r) => r.status === "drafted").map((r) => r.n);
  const nums = inTest.length ? inTest : drafted;
  if (!nums.length) return "Darwin picks the biggest one to fix first.";
  const firstK = nums.every((n, i) => n === i + 1);
  const verb = inTest.length ? "already being fixed in test B" : "covered by a fix Darwin just drafted";
  if (firstK) {
    if (nums.length === rows.length && rows.length > 1) return `All of them are ${verb}.`;
    if (nums.length === 1) return `The biggest one is ${verb}.`;
    return `The first ${nums.length === 2 ? "two" : nums.length === 3 ? "three" : nums.length} are ${verb}.`;
  }
  return `${nums.length === 1 ? "Number" : "Numbers"} ${listJoin(nums)} ${nums.length === 1 ? "is" : "are"} ${verb}.`;
}

/* ------------------------------------------------------------------ stats per issue */

export interface IssueStat {
  value: string;
  label: string;
}

const SHARE = /^(\d+(?:\.\d+)?%) of ([a-z][a-z -]*?)(?= (?:asked|give|die|never|leave|leaves|tried|walk|stop|abandon|bounce|drop|quit|hit|can|don|won|get)\b|:|,|$)/i;

/**
 * Three honest numbers for the detail panel: the headline share ("41% of AI shoppers"), buyers lost
 * per 1,000 visits, and one count from the evidence. Nothing is invented: shares come from the title
 * the analyst wrote, counts from its evidence.
 */
export function issueStats(insight: Insight): IssueStat[] {
  const out: IssueStat[] = [];
  const m = SHARE.exec(insight.title);
  const evidence = insight.evidence.filter((e) => !/impact/i.test(e.label));
  if (m) out.push({ value: m[1], label: `of ${m[2]}` });
  else if (evidence[0]) out.push({ value: evidence[0].value, label: evidence[0].label });
  out.push({ value: fmtImpact(insight.impactScore), label: "buyers lost / 1,000" });
  const used = new Set(out.map((s) => s.value));
  const count = evidence.find((e) => /^[\d,]+$/.test(e.value.trim()) && !used.has(e.value)) ?? evidence.find((e) => !used.has(e.value));
  if (count) out.push({ value: count.value, label: count.label });
  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ sessions that show an issue */

export interface SeenSession {
  id: string;
  name: string;
  arm?: "A" | "B";
  what: string;
  outcome: AgentSessionSummary["outcome"];
  synthetic: boolean;
}

const FIELD_MATCH: Record<string, RegExp> = {
  agent_missing_eta: /(^|[^a-z])eta|deliver|arriv|dispatch/i,
  agent_missing_returns: /return|refund/i,
  agent_missing_landed_price: /landed|shipping|postage|total/i,
  agent_missing_stock: /stock|availab|inventory|size/i,
  agent_missing_negotiation: /negotiat/i,
  agent_missing_structured_data: /.+/,
};

const FIELD_NAMES: Record<string, string> = {
  deliveryEtaDays: "a delivery date",
  deliveryEta: "a delivery date",
  landedPrice: "the total incl. delivery",
  returnPolicy: "the returns policy",
  negotiation: "a better price",
  sizes: "stock by size",
  stock: "stock by size",
};

/** "deliveryEtaDays" → "a delivery date"; unknown fields are split into words. */
export function fieldName(f: string): string {
  return FIELD_NAMES[f] ?? f.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function shortReason(reason: string | undefined): string {
  if (!reason) return "";
  const after = reason.includes("—") ? reason.split("—").slice(1).join("—").trim() : reason.trim();
  return after.length > 60 ? `${after.slice(0, 58).trimEnd()}…` : after;
}

function outcomeText(s: AgentSessionSummary, field?: string): string {
  const asked = field ? `asked for ${fieldName(field)}` : "";
  if (s.outcome === "purchased") return [asked, "bought anyway"].filter(Boolean).join(", ").replace(/^bought anyway$/, "bought");
  if (s.outcome === "abandoned") {
    const why = shortReason(s.reason);
    return `${asked ? `${asked}, ` : ""}left${why ? `: ${why}` : ""}`;
  }
  return `${asked ? `${asked}, ` : ""}still shopping`;
}

/** Agent sessions whose tool calls (or abandon reason) show this issue. Human issues have none. */
export function sessionsFor(insight: Insight, sessions: AgentSessionSummary[] | undefined, limit = 4): { rows: SeenSession[]; matched: number; scanned: number } {
  if (!sessions?.length || insight.audience === "human") return { rows: [], matched: 0, scanned: sessions?.length ?? 0 };
  const kind = insight.id.replace(/^ins_/, "");
  const re = FIELD_MATCH[kind];
  const hits: { s: AgentSessionSummary; field?: string }[] = [];
  for (const s of sessions) {
    if (re) {
      const field = s.toolCalls.flatMap((t) => t.missing ?? []).find((f) => re.test(f));
      const failed = kind === "agent_missing_negotiation" && s.toolCalls.some((t) => t.tool === "negotiate" && !t.ok);
      const reason = Boolean(s.reason && re.test(s.reason) && kind !== "agent_missing_structured_data");
      if (field || failed || reason) hits.push({ s, field: field ?? (failed ? "a better price" : undefined) });
    } else if (kind === "agent_abandon" || kind === "agent_blind") {
      if (s.outcome === "abandoned") hits.push({ s });
    } else if (stageKey(insight.stage) === "checkout" && s.toolCalls.some((t) => t.tool === "checkout" && !t.ok)) {
      hits.push({ s });
    }
  }
  // Walk-aways first (they are the issue), then B-arm buyers (the fix at work); one per agent before repeats.
  const rank = (h: (typeof hits)[number]) => (h.s.outcome === "abandoned" ? 0 : h.s.variant === "treatment" ? 1 : 2);
  const sorted = [...hits].sort((a, b) => rank(a) - rank(b) || Date.parse(b.s.startedAt) - Date.parse(a.s.startedAt));
  const firsts: typeof hits = [];
  const repeats: typeof hits = [];
  const agents = new Set<string>();
  for (const h of sorted) {
    if (agents.has(h.s.agentName)) repeats.push(h);
    else {
      agents.add(h.s.agentName);
      firsts.push(h);
    }
  }
  const rows = [...firsts, ...repeats]
    .slice(0, limit)
    .map(({ s, field }) => ({
      id: s.sessionId,
      name: s.agentName,
      arm: s.variant === "treatment" ? ("B" as const) : s.variant === "control" ? ("A" as const) : undefined,
      what: outcomeText(s, field),
      outcome: s.outcome,
      synthetic: s.synthetic,
    }));
  return { rows, matched: hits.length, scanned: sessions.length };
}

/* ------------------------------------------------------------------ fixes */

export type FixStatus = "test" | "drafted" | "shipped" | "rejected" | "shelved" | "stopped" | "untested";

export const FIX_STATUS_LABEL: Record<FixStatus, string> = {
  test: "In test",
  drafted: "Drafted",
  shipped: "Shipped",
  rejected: "Rejected",
  shelved: "Shelved",
  stopped: "Stopped",
  untested: "Never tested",
};

export interface FixRow {
  id: string;
  title: string;
  hypothesis?: string;
  diff: string[];
  insightIds: string[];
  expectedLift?: number;
  source?: string;
  createdAt: string;
  experiment?: Experiment;
  status: FixStatus;
  /** Measured relative lift (when a test has a result). */
  lift?: number;
  probability?: number;
  generation?: number;
  prUrl?: string;
}

function isProposal(v: unknown): v is ChangeProposal {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.title === "string" && Array.isArray(o.diff) && Array.isArray(o.insightIds);
}

function isInsightList(v: unknown): v is Insight[] {
  return Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof (x as Insight).id === "string" && typeof (x as Insight).title === "string");
}

/** Every insight Darwin has written (latest wording wins), so old fixes can still name their issues. */
export function insightArchive(loop: LoopState | undefined): Map<string, Insight> {
  const out = new Map<string, Insight>();
  if (!loop) return out;
  for (const e of loop.log) {
    const d = e.data as { insights?: unknown } | undefined;
    if (d && isInsightList(d.insights)) for (const i of d.insights) out.set(i.id, i);
  }
  for (const i of loop.insights) out.set(i.id, i);
  return out;
}

export function buildFixes(loop: LoopState | undefined, experiments: Experiment[] | undefined): FixRow[] {
  if (!loop) return [];
  const proposals = new Map<string, ChangeProposal>();
  for (const e of loop.log) {
    const p = (e.data as { proposal?: unknown } | undefined)?.proposal;
    if (isProposal(p)) proposals.set(p.id, p);
  }
  if (loop.proposal) proposals.set(loop.proposal.id, loop.proposal);

  const exps = experiments ?? [];
  const expFor = (pid: string) =>
    exps.filter((x) => x.proposalId === pid).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  // Shipped diffs, keyed by spec version, for experiments whose proposal left the capped log.
  const shippedDiff = new Map<number, string[]>();
  for (const e of loop.log) {
    const d = e.data as { specVersion?: unknown; diff?: unknown } | undefined;
    if (d && typeof d.specVersion === "number" && Array.isArray(d.diff)) shippedDiff.set(d.specVersion, d.diff.map(String));
  }

  const rows: FixRow[] = [];
  const seenExp = new Set<string>();
  const statusOf = (exp: Experiment | undefined, pid?: string): FixStatus => {
    if (!exp) {
      if (pid && pid === loop.proposal?.id) return proposalInTest(loop, experiments) ? "test" : "drafted";
      return "untested";
    }
    if (exp.status === "running") return "test";
    const d = exp.result?.decision;
    if (loop.history.some((h) => h.experimentId === exp.id) || d === "ship") return exp.status === "completed" ? "shipped" : "stopped";
    if (d === "reject") return "rejected";
    if (d === "inconclusive") return "shelved";
    return exp.status === "stopped" ? "stopped" : "shelved";
  };
  const measured = (exp: Experiment | undefined) => {
    const gen = exp ? loop.history.find((h) => h.experimentId === exp.id) : undefined;
    return {
      lift: exp?.result?.lift,
      probability: exp?.result?.probabilityToBeat,
      generation: gen?.generation,
      prUrl: gen?.prUrl,
    };
  };

  for (const p of proposals.values()) {
    const exp = expFor(p.id);
    if (exp) seenExp.add(exp.id);
    rows.push({
      id: p.id,
      title: p.title,
      hypothesis: p.hypothesis,
      diff: p.diff,
      insightIds: p.insightIds,
      expectedLift: p.expectedLift,
      source: p.source,
      createdAt: p.createdAt,
      experiment: exp,
      status: statusOf(exp, p.id),
      ...measured(exp),
    });
  }
  for (const exp of exps) {
    if (seenExp.has(exp.id)) continue;
    const gen = loop.history.find((h) => h.experimentId === exp.id);
    rows.push({
      id: exp.proposalId || exp.id,
      title: exp.name,
      diff: gen ? (shippedDiff.get(gen.specVersion) ?? []) : [],
      insightIds: [],
      createdAt: exp.createdAt,
      experiment: exp,
      status: statusOf(exp),
      ...measured(exp),
    });
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** The lift to show on a fix: measured when tested, expected otherwise. */
export function fixLift(f: FixRow): { value?: number; kind: "measured" | "expected" } {
  if (f.lift !== undefined && Number.isFinite(f.lift)) return { value: f.lift, kind: "measured" };
  return { value: f.expectedLift, kind: "expected" };
}

/* ------------------------------------------------------------------ search params */

/** Replace `?id=` in the URL (keeps `?mock=1` etc.) without a navigation. Next syncs useSearchParams. */
export function setIdParam(id: string | undefined) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
