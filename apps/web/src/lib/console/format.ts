/**
 * Formatting + presentation helpers for the console. Pure functions, safe on server and client.
 */
import type { AnalyticsEvent, LoopLogEntry, LoopPhase, LoopState } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import { PRODUCTS } from "@/lib/catalog/products";

/* ------------------------------------------------------------------ numbers */

export function pct(x: number | undefined | null, digits = 1): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

/** Signed relative change, e.g. +34% / −12%. */
export function signedPct(x: number | undefined | null, digits = 0): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return "–";
  const v = (x * 100).toFixed(digits);
  if (Number(v) === 0) return `±0%`;
  return x > 0 ? `+${v}%` : `−${v.replace("-", "")}%`;
}

/** Percentage-point delta, e.g. +1.4pp. */
export function pp(delta: number | undefined | null, digits = 1): string {
  if (delta === undefined || delta === null || !Number.isFinite(delta)) return "–";
  const v = (delta * 100).toFixed(digits);
  if (Number(v) === 0) return "±0pp";
  return delta > 0 ? `+${v}pp` : `−${v.replace("-", "")}pp`;
}

export function money(pence: number | undefined | null, opts: { compact?: boolean } = {}): string {
  if (pence === undefined || pence === null || !Number.isFinite(pence)) return "–";
  const pounds = pence / 100;
  if (opts.compact && Math.abs(pounds) >= 10_000) {
    return `£${(pounds / 1000).toFixed(pounds >= 100_000 ? 0 : 1)}k`;
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: opts.compact && Math.abs(pounds) >= 1000 ? 0 : 2,
  }).format(pounds);
}

export function count(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "–";
  return new Intl.NumberFormat("en-GB").format(Math.round(n));
}

export function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 3) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/* ------------------------------------------------------------------ phases */

export const PHASES: Exclude<LoopPhase, "idle">[] = ["observe", "diagnose", "propose", "experiment", "decide", "ship"];

export const PHASE_META: Record<LoopPhase, { label: string; verb: string; blurb: string }> = {
  idle: { label: "Idle", verb: "Ready", blurb: "Waiting to start the loop" },
  observe: { label: "Observe", verb: "Observing", blurb: "Watching humans and AI agents shop" },
  diagnose: { label: "Diagnose", verb: "Diagnosing", blurb: "Turning behaviour into insights" },
  propose: { label: "Propose", verb: "Designing", blurb: "Writing a page change as a spec diff" },
  experiment: { label: "Experiment", verb: "Experimenting", blurb: "A/B testing the change on live traffic" },
  decide: { label: "Decide", verb: "Deciding", blurb: "Reading the result, honestly" },
  ship: { label: "Ship", verb: "Shipping", blurb: "Promoting the winner and opening a PR" },
};

export function phaseIndex(phase: LoopPhase): number {
  return phase === "idle" ? -1 : PHASES.indexOf(phase);
}

/* ------------------------------------------------------------------ LLM source */

export interface SourceBadge {
  label: "Grok" | "Claude" | "OpenRouter" | "Heuristic" | "LLM";
  model?: string;
}

/** Map ChangeProposal.source ("llm:grok-4", "llm:claude-…", "llm:deepseek/…", "heuristic") to a chip. */
export function sourceBadge(source: string | undefined): SourceBadge | undefined {
  if (!source) return undefined;
  const s = source.toLowerCase();
  const model = s.startsWith("llm:") ? source.slice(4) : undefined;
  if (s.includes("heuristic")) return { label: "Heuristic" };
  if (s.includes("grok") || s.includes("xai")) return { label: "Grok", model };
  if (s.includes("claude") || s.includes("anthropic")) return { label: "Claude", model };
  if (s.includes("openrouter") || (model && model.includes("/"))) return { label: "OpenRouter", model };
  return { label: "LLM", model };
}

/* ------------------------------------------------------------------ diffs */

export interface DiffLine {
  path: string;
  before?: string;
  after?: string;
  raw: string;
}

/** "cart.showShippingUpfront: false → true" → { path, before, after }. */
export function parseDiffLine(raw: string): DiffLine {
  const m = /^\s*([^:]+?):\s*(.*?)\s*(?:→|->)\s*(.*)$/.exec(raw);
  if (!m) return { path: raw, raw };
  return { path: m[1], before: m[2], after: m[3], raw };
}

/** Readable version of a spec path: "cart.showShippingUpfront" → "Cart · show shipping upfront". */
export function humanizePath(path: string): string {
  const parts = path.split(".");
  const words = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/Pct$/i, "%")
      .toLowerCase();
  const section = parts[0] === "agentSurface" ? "Agent API" : words(parts[0]).replace(/^./, (c) => c.toUpperCase());
  return [section, ...parts.slice(1).map(words)].join(" · ");
}

/* ------------------------------------------------------------------ pull requests */

/**
 * A PR as the console shows it. The optimizer logs a full PullRequestResult when GitHub answers,
 * or a partial `{ dryRun, queued, repo }` when it can't, so everything but dryRun is optional.
 */
export type PrInfo = Partial<PullRequestResult> & {
  dryRun: boolean;
  queued?: boolean;
  repo?: string;
  /** The log message that carried the PR (explains dry runs / failures). */
  note?: string;
  generation?: number;
};

function asPr(v: unknown): PrInfo | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const full = typeof o.title === "string" && (typeof o.url === "string" || typeof o.branch === "string");
  const partial = typeof o.dryRun === "boolean" || (typeof o.url === "string" && o.url.includes("/pull/"));
  if (!full && !partial) return undefined;
  return { ...(o as Partial<PullRequestResult>), dryRun: typeof o.dryRun === "boolean" ? o.dryRun : !o.url };
}

export function extractPr(entry: LoopLogEntry): PrInfo | undefined {
  const d = entry.data;
  const direct = asPr(d);
  if (direct) return { ...direct, note: entry.message };
  if (d && typeof d === "object") {
    for (const key of ["pr", "pullRequest", "pull_request"]) {
      const inner = asPr((d as Record<string, unknown>)[key]);
      if (inner) return { ...inner, note: entry.message };
    }
  }
  return undefined;
}

function genFromText(s: string | undefined): number | undefined {
  const m = s ? /(?:Gen |gen-)(\d+)/.exec(s) : null;
  return m ? Number(m[1]) : undefined;
}

/** Every PR in the loop log, keyed by the generation it shipped. */
export function prsByGeneration(loop: Pick<LoopState, "log" | "history" | "generation"> | undefined): Map<number, PrInfo> {
  const out = new Map<number, PrInfo>();
  if (!loop) return out;
  let context: number | undefined;
  for (const e of loop.log) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (typeof d.specVersion === "number") {
      const h = loop.history.find((x) => x.specVersion === d.specVersion);
      if (h) context = h.generation;
    }
    const rec = d.generation as { generation?: unknown } | undefined;
    if (rec && typeof rec === "object" && typeof rec.generation === "number") context = rec.generation;
    const pr = extractPr(e);
    if (!pr) continue;
    const g = genFromText(pr.title) ?? genFromText(pr.branch) ?? context ?? loop.generation;
    const prev = out.get(g);
    // prefer the richest payload for a generation
    if (!prev || (!prev.title && pr.title) || (!prev.url && pr.url)) out.set(g, { ...pr, generation: g });
  }
  return out;
}

/**
 * Merge PRs the GitHub module reports in /api/github/status (`recentPullRequests`, beyond the
 * base contract) into the per-generation map, so real PR links show even if the log lacks them.
 */
export function withStatusPrs(
  prs: Map<number, PrInfo>,
  status: unknown,
  history: Pick<LoopState, "history">["history"],
): Map<number, PrInfo> {
  const list = (status as { recentPullRequests?: unknown } | undefined)?.recentPullRequests;
  if (!Array.isArray(list)) return prs;
  const out = new Map(prs);
  for (const r of list as Record<string, unknown>[]) {
    if (!r || r.kind !== "spec" || typeof r.specVersion !== "number") continue;
    const g = history.find((h) => h.specVersion === r.specVersion)?.generation;
    if (g === undefined) continue;
    const prev = out.get(g);
    out.set(g, {
      ...prev,
      dryRun: typeof r.dryRun === "boolean" ? r.dryRun : (prev?.dryRun ?? true),
      url: (typeof r.url === "string" ? r.url : undefined) ?? prev?.url,
      number: (typeof r.number === "number" ? r.number : undefined) ?? prev?.number,
      title: prev?.title ?? (typeof r.title === "string" ? r.title : undefined),
      branch: prev?.branch ?? (typeof r.branch === "string" ? r.branch : undefined),
      repo: prev?.repo ?? (typeof r.repo === "string" ? r.repo : undefined),
      generation: g,
    });
  }
  return out;
}

/** The PR for the current generation (what the ship stage shows). */
export function findPullRequest(loop: Pick<LoopState, "log" | "history" | "generation"> | undefined): PrInfo | undefined {
  return prsByGeneration(loop).get(loop?.generation ?? -1);
}

export function prNumberFromUrl(url: string | undefined): number | undefined {
  const m = url ? /\/pull\/(\d+)/.exec(url) : null;
  return m ? Number(m[1]) : undefined;
}

/* ------------------------------------------------------------------ events → feed rows */

const PRODUCT_NAMES = new Map(PRODUCTS.map((p) => [p.id, p.name]));

export function productName(id: unknown): string | undefined {
  return typeof id === "string" ? (PRODUCT_NAMES.get(id) ?? id) : undefined;
}

export type FeedTone = "default" | "good" | "bad" | "warn" | "dim";

export interface FeedRow {
  id: string;
  kind: "human" | "agent";
  actor: string;
  text: string;
  detail?: string;
  tone: FeedTone;
  /** 0 = skip, 1 = low (dropped first when throttling), 2 = normal, 3 = key moment. */
  priority: 0 | 1 | 2 | 3;
  synthetic: boolean;
  variant?: string;
  at: string;
}

function listFields(v: unknown): string | undefined {
  return Array.isArray(v) && v.length ? v.join(", ") : undefined;
}

export function actorName(e: AnalyticsEvent): string {
  const p = e.properties;
  if (typeof p.agent_name === "string" && p.agent_name) return p.agent_name;
  if (typeof p.persona === "string" && p.persona) return p.persona;
  const id = e.distinct_id.replace(/^(v_|agent_|a_)/, "");
  return p.visitor_kind === "agent" ? `agent ${id.slice(0, 6)}` : `visitor ${id.slice(0, 6)}`;
}

/** Turn a raw analytics event into a friendly feed row. */
export function describeEvent(e: AnalyticsEvent): FeedRow {
  const p = e.properties;
  const kind = p.visitor_kind === "agent" ? "agent" : "human";
  const product = productName(p.product_id);
  const size = typeof p.size === "string" || typeof p.size === "number" ? `UK ${p.size}` : undefined;
  const base = {
    id: e.uuid,
    kind,
    actor: actorName(e),
    synthetic: Boolean(p.synthetic),
    variant: typeof p.variant === "string" ? p.variant : undefined,
    at: e.timestamp,
  } as const;
  const row = (text: string, tone: FeedTone, priority: FeedRow["priority"], detail?: string): FeedRow => ({
    ...base,
    text,
    tone,
    priority,
    detail,
  });

  switch (e.event) {
    case "$pageview":
      return row(`landed on ${p.$pathname ?? "the store"}`, "dim", 1);
    case "$pageleave":
    case "$autocapture":
      return row(e.event.replace("$", ""), "dim", 0);
    case "$rageclick":
      return row(`rage-clicked ${typeof p.element === "string" ? `“${p.element}”` : "the page"}`, "warn", 2);
    case "product_viewed":
      return row(`viewed ${product ?? "a product"}`, "dim", 1);
    case "product_added":
      return row(`added ${product ?? "an item"}${size ? ` · ${size}` : ""}`, "default", 2);
    case "cart_viewed":
      return row("opened the bag", "dim", 1);
    case "checkout_started":
      return row(`started checkout${typeof p.value === "number" ? ` · ${money(p.value)}` : ""}`, "default", 2);
    case "shipping_cost_revealed":
      return row(
        `hit surprise shipping${typeof p.shipping === "number" ? ` +${money(p.shipping)}` : ""} at the last step`,
        "warn",
        2,
      );
    case "checkout_step_completed":
      return row(`completed checkout step ${p.step ?? ""}`.trim(), "dim", 1);
    case "checkout_abandoned":
      return row(`abandoned checkout${p.reason ? `: ${String(p.reason)}` : ""}`, "bad", 3);
    case "order_completed": {
      const amount = typeof p.revenue === "number" ? money(p.revenue) : undefined;
      return row(`ordered ${product ?? ""}${amount ? ` · ${amount}` : ""}`.replace("  ", " "), "good", 3);
    }
    case "agent_request": {
      const tool = typeof p.tool === "string" ? p.tool : "tool call";
      const missing = listFields(p.missing);
      if (p.ok === false) return row(`${tool} ✗${p.reason ? ` ${String(p.reason)}` : ""}`, "bad", 2, missing && `missing ${missing}`);
      if (missing) return row(`${tool} ✓ but missing ${missing}`, "warn", 2);
      return row(`${tool} ✓${product ? ` · ${product}` : ""}`, "dim", 1);
    }
    case "agent_negotiation": {
      const offer = typeof p.offer === "number" ? money(p.offer) : undefined;
      const msg = typeof p.message === "string" ? p.message : undefined;
      return row(`negotiating${offer ? ` · offer ${offer}` : ""}`, "default", 2, msg);
    }
    case "agent_abandoned":
      return row(`abandoned${p.reason ? `: ${String(p.reason)}` : ""}`, "bad", 3);
    default:
      return row(e.event.replace(/_/g, " "), "dim", 1);
  }
}

/* ------------------------------------------------------------------ misc */

export function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
