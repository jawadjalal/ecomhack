/**
 * Data helpers for the Experiments and Pull requests screens. Pure functions over the loop state,
 * the experiments list and the GitHub status: no fetching, no fake numbers.
 */
import type { ChangeProposal, Experiment, ExperimentResult, GenerationRecord, Insight, LoopState, PageSpec } from "@/lib/contracts";
import { money, parseDiffLine, humanizePath, prsByGeneration, withStatusPrs, type DiffLine, type PrInfo } from "@/lib/console/format";
import { describeDiff } from "@/lib/spec/patch";

/**
 * `Card` wraps its children in a plain `div.relative`; this makes that wrapper a full-height flex
 * column so charts and mocks can grow to fill the card (pair with `[&>.relative]:gap-*`).
 */
export const CARD_FILL = "flex flex-col [&>.relative]:flex [&>.relative]:min-h-0 [&>.relative]:flex-1 [&>.relative]:flex-col";

/* ------------------------------------------------------------------ decision rules */

/**
 * The optimizer's bar for shipping (lib/optimizer/loop.ts, loopConfigFromEnv): 97.5% on the final
 * look, 99.5% on earlier looks so noise can't sneak a win, and it drops the idea under 10%.
 * The in-browser demo engine (?mock=1) ships at 96.5% (lib/console/mock.ts).
 */
export function decisionRules(mock: boolean) {
  return mock ? { ship: 0.965, early: 0.965, drop: 0.2 } : { ship: 0.975, early: 0.995, drop: 0.1 };
}

/* ------------------------------------------------------------------ log index */

export interface RoundPoint {
  round: number;
  p: number;
  synthetic?: boolean;
  at: string;
}

export interface LogIndex {
  proposals: Map<string, ChangeProposal>;
  insights: Map<string, Insight>;
  /** experimentId → P(beat) after each traffic round, from the experimenter's log lines. */
  rounds: Map<string, RoundPoint[]>;
  /** specVersion → the diff lines logged when it shipped. */
  shipDiffs: Map<number, string[]>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function indexLog(loop: LoopState | undefined): LogIndex {
  const out: LogIndex = { proposals: new Map(), insights: new Map(), rounds: new Map(), shipDiffs: new Map() };
  if (!loop) return out;
  for (const e of loop.log) {
    const d = e.data;
    if (!isObj(d)) continue;
    const p = d.proposal;
    if (isObj(p) && typeof p.id === "string" && Array.isArray(p.diff)) out.proposals.set(p.id, p as unknown as ChangeProposal);
    if (Array.isArray(d.insights)) {
      for (const i of d.insights) if (isObj(i) && typeof i.id === "string" && typeof i.title === "string") out.insights.set(i.id, i as unknown as Insight);
    }
    if (typeof d.experimentId === "string" && typeof d.round === "number" && isObj(d.result) && typeof d.result.probabilityToBeat === "number") {
      const list = out.rounds.get(d.experimentId) ?? [];
      list.push({ round: d.round, p: d.result.probabilityToBeat, synthetic: typeof d.synthetic === "boolean" ? d.synthetic : undefined, at: e.at });
      out.rounds.set(d.experimentId, list);
    }
    if (typeof d.specVersion === "number" && Array.isArray(d.diff)) out.shipDiffs.set(d.specVersion, d.diff.filter((x): x is string => typeof x === "string"));
  }
  if (loop.proposal) out.proposals.set(loop.proposal.id, loop.proposal);
  for (const i of loop.insights) out.insights.set(i.id, i);
  return out;
}

/* ------------------------------------------------------------------ experiments */

const newestFirst = (a: Experiment, b: Experiment) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/** The running experiment (the loop's own first), else the most recent one. */
export function pickExperiment(exps: Experiment[] | undefined, loop: LoopState | undefined): Experiment | undefined {
  if (!exps?.length) return undefined;
  const running = exps.filter((e) => e.status === "running").sort(newestFirst);
  return running.find((e) => e.id === loop?.experimentId) ?? running[0] ?? [...exps].sort(newestFirst)[0];
}

export function historyFor(exp: Experiment | undefined, loop: LoopState | undefined): GenerationRecord | undefined {
  return exp ? loop?.history.find((h) => h.experimentId === exp.id) : undefined;
}

/** The diff B makes to A, as "path: before → after" lines. */
export function diffFor(exp: Experiment, loop: LoopState | undefined, idx: LogIndex): string[] {
  const proposal = idx.proposals.get(exp.proposalId);
  if (proposal?.diff?.length) return proposal.diff;
  const rec = historyFor(exp, loop);
  const shipped = rec ? idx.shipDiffs.get(rec.specVersion) : undefined;
  if (shipped?.length) return shipped;
  if (loop && loop.liveSpec.version === exp.controlVersion) return describeDiff(loop.liveSpec, exp.treatmentSpec);
  return [];
}

function parseValue(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Put the "before" values of a diff back onto a spec (to rebuild A for a past experiment). */
export function revertDiff(spec: PageSpec, lines: string[]): PageSpec {
  const out = structuredClone(spec) as unknown as Record<string, unknown>;
  for (const raw of lines) {
    const l = parseDiffLine(raw);
    if (l.before === undefined) continue;
    const parts = l.path.split(".");
    let node: Record<string, unknown> = out;
    for (const k of parts.slice(0, -1)) {
      if (!isObj(node[k])) node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    node[parts.at(-1)!] = parseValue(l.before);
  }
  return out as unknown as PageSpec;
}

/** A = the live spec at the control version (or B with the diff undone once the store moved on). */
export function controlSpecFor(exp: Experiment, loop: LoopState | undefined, diff: string[]): PageSpec {
  if (loop && loop.liveSpec.version === exp.controlVersion) return loop.liveSpec;
  return revertDiff(exp.treatmentSpec, diff);
}

/* ------------------------------------------------------------------ what B changes */

export type MockPage = "cart" | "product" | "checkout" | "home" | "agent";

const SECTION_PAGE: Record<string, MockPage> = {
  cart: "cart",
  productPage: "product",
  checkout: "checkout",
  agentSurface: "agent",
  hero: "home",
  announcement: "home",
  productGrid: "home",
  theme: "home",
};
const PAGE_ORDER: MockPage[] = ["cart", "product", "checkout", "agent", "home"];

/** The page the change touches most (human pages win ties over the agent API). */
export function pageFor(diff: string[]): MockPage {
  const counts = new Map<MockPage, number>();
  for (const raw of diff) {
    const page = SECTION_PAGE[parseDiffLine(raw).path.split(".")[0]];
    if (page) counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  let best: MockPage = "home";
  let n = 0;
  for (const p of PAGE_ORDER) {
    const c = counts.get(p) ?? 0;
    if (c > n) {
      best = p;
      n = c;
    }
  }
  return n === 0 ? "cart" : best;
}

const LABELS: Record<string, string> = {
  "cart.showShippingUpfront": "Shipping shown in the bag",
  "cart.freeShippingThreshold": "Free delivery over",
  "cart.upsell": "“Complete your kit” in the bag",
  "productPage.ctaText": "Add-to-bag button",
  "productPage.ctaPosition": "Add-to-bag position",
  "productPage.showReviews": "Reviews on product pages",
  "productPage.showSizeGuide": "Size guide",
  "productPage.showDeliveryEstimate": "Delivery date on product pages",
  "productPage.showReturnsPolicy": "Returns on product pages",
  "productPage.urgency": "Low-stock urgency",
  "productPage.trustBadges": "Trust badges",
  "checkout.steps": "Checkout steps",
  "checkout.guestCheckout": "Guest checkout",
  "checkout.expressPay": "Apple Pay and Google Pay",
  "hero.headline": "Homepage headline",
  "hero.subheadline": "Homepage subheadline",
  "hero.ctaText": "Homepage button",
  "hero.layout": "Homepage layout",
  "hero.showSocialProof": "Ratings under the headline",
  "announcement.enabled": "Announcement bar",
  "announcement.text": "Announcement text",
  "productGrid.columns": "Products per row",
  "productGrid.showRatings": "Ratings in the grid",
  "productGrid.showQuickAdd": "Quick add in the grid",
  "productGrid.sort": "Product order",
  "theme.accent": "Button colour",
  "theme.radius": "Corner style",
  "agentSurface.structuredData": "Product data for agents on pages",
  "agentSurface.exposeStock": "Stock per size in the store API",
  "agentSurface.exposeDeliveryEta": "Delivery date in the store API",
  "agentSurface.exposeReturnPolicy": "Returns policy in the store API",
  "agentSurface.exposeLandedPrice": "Price with delivery in the store API",
  "agentSurface.negotiation.enabled": "Agents can negotiate",
  "agentSurface.negotiation.maxDiscountPct": "Most an agent can knock off",
};

export function settingLabel(path: string): string {
  return LABELS[path] ?? humanizePath(path);
}

/** "false" → "off", "null" (threshold) → "never", 6000 → "£60", "\"Add to bag\"" → "Add to bag". */
export function valueLabel(path: string, raw: string | undefined): string {
  if (raw === undefined) return "–";
  const v = parseValue(raw);
  if (path === "cart.freeShippingThreshold") return v === null ? "never" : typeof v === "number" ? money(v).replace(/\.00$/, "") : String(v);
  if (path === "agentSurface.negotiation.maxDiscountPct") return `${String(v)}%`;
  if (path === "checkout.steps") return `${String(v)} ${v === 1 ? "page" : "steps"}`;
  if (typeof v === "boolean") {
    if (path.startsWith("agentSurface.expose")) return v ? "shared" : "hidden";
    if (/\.(show|trustBadges|upsell|structuredData)/.test(path) || path.endsWith("Badges")) return v ? "shown" : "hidden";
    return v ? "on" : "off";
  }
  if (typeof v === "string") {
    const words: Record<string, string> = { "below-description": "below the text", "above-fold": "at the top", sticky: "always on screen", "low-stock": "low stock", none: "none" };
    const s = words[v] ?? v;
    return s.length > 28 ? `${s.slice(0, 27)}…` : s;
  }
  return v === null ? "none" : String(v);
}

export type SeenBy = "people" | "agents" | "both";

export function seenBy(path: string, spec?: PageSpec): SeenBy {
  if (path.startsWith("agentSurface.")) return "agents";
  // Agents feel the free-delivery threshold through their landed price.
  if (path === "cart.freeShippingThreshold" && (spec?.agentSurface.exposeLandedPrice ?? false)) return "both";
  return "people";
}

export interface ChangeRow {
  path: string;
  setting: string;
  a: string;
  b: string;
  seenBy: SeenBy;
  leak?: string;
}

export function changeRows(diff: string[], proposal: ChangeProposal | undefined, idx: LogIndex, spec?: PageSpec): ChangeRow[] {
  const insights = (proposal?.insightIds ?? []).map((id) => idx.insights.get(id)).filter((i): i is Insight => Boolean(i));
  return diff.map((raw) => {
    const l: DiffLine = parseDiffLine(raw);
    const who = seenBy(l.path, spec);
    const match =
      insights.find((i) => (who === "agents" ? i.audience === "agent" : i.audience !== "agent")) ?? insights[0];
    return { path: l.path, setting: settingLabel(l.path), a: valueLabel(l.path, l.before), b: valueLabel(l.path, l.after), seenBy: who, leak: match?.title };
  });
}

/* ------------------------------------------------------------------ result helpers */

export type Outcome = "running" | "shipped" | "lost" | "unclear" | "stopped";

export function outcomeOf(exp: Experiment, loop: LoopState | undefined): Outcome {
  if (exp.status === "running") return "running";
  if (historyFor(exp, loop) || exp.result?.decision === "ship") return "shipped";
  if (exp.result?.decision === "reject") return "lost";
  if (exp.result?.decision === "inconclusive") return "unclear";
  return "stopped";
}

/** Shoppers the decision is measured on (the audience segment when the change only reaches one). */
export function measured(result: ExperimentResult) {
  const aud = result.audience ?? "all";
  const pick = (v: ExperimentResult["control"]) => (aud === "all" ? v : v.byKind[aud]);
  const a = pick(result.control);
  const b = pick(result.treatment);
  return { audience: aud, a, b, visitors: a.visitors + b.visitors };
}

export function audienceNoun(aud: "all" | "human" | "agent", n = 2): string {
  if (aud === "agent") return n === 1 ? "AI shopper" : "AI shoppers";
  if (aud === "human") return n === 1 ? "person" : "people";
  return n === 1 ? "shopper" : "shoppers";
}

/* ------------------------------------------------------------------ pull requests */

export type PrState = "open" | "preview" | "queued";

export interface PrRow {
  key: string;
  kind: "spec" | "install";
  generation?: number;
  pr: PrInfo;
  title: string;
  state: PrState;
  lift?: number;
  at?: string;
  experiment?: Experiment;
  diff: string[];
}

/** "Darwin Gen 2: one-page guest checkout (+45.1% conversion, P=>0.99)" → "One-page guest checkout". */
export function cleanPrTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const t = title
    .replace(/^Darwin\s+Gen\s+\d+:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : undefined;
}

function prState(pr: PrInfo): PrState {
  if (pr.queued) return "queued";
  return pr.dryRun || !pr.url ? "preview" : "open";
}

interface StatusPr {
  kind?: unknown;
  title?: unknown;
  branch?: unknown;
  url?: unknown;
  number?: unknown;
  dryRun?: unknown;
  repo?: unknown;
  at?: unknown;
}

/** Every PR Darwin drafted or opened: winners per generation (newest first), then the analytics install. */
export function buildPrRows(loop: LoopState | undefined, status: unknown, exps: Experiment[] | undefined, idx: LogIndex): PrRow[] {
  if (!loop) return [];
  const byGen = withStatusPrs(prsByGeneration(loop), status, loop.history);
  const rows: PrRow[] = [];
  for (const [gen, pr] of [...byGen.entries()].sort((a, b) => b[0] - a[0])) {
    const rec = loop.history.find((h) => h.generation === gen);
    const experiment = rec?.experimentId ? exps?.find((e) => e.id === rec.experimentId) : undefined;
    const diff =
      (rec ? idx.shipDiffs.get(rec.specVersion) : undefined) ??
      (experiment ? diffFor(experiment, loop, idx) : undefined) ??
      [];
    rows.push({
      key: `gen-${gen}`,
      kind: "spec",
      generation: gen,
      pr,
      title: cleanPrTitle(pr.title) ?? rec?.label.replace(/^Gen \d+:\s*/, "") ?? `Generation ${gen}`,
      state: prState(pr),
      lift: rec?.lift,
      at: rec?.shippedAt,
      experiment,
      diff,
    });
  }
  const list = (status as { recentPullRequests?: unknown } | undefined)?.recentPullRequests;
  const install = Array.isArray(list) ? (list as StatusPr[]).find((r) => r && r.kind === "install") : undefined;
  if (install) {
    const pr: PrInfo = {
      dryRun: typeof install.dryRun === "boolean" ? install.dryRun : true,
      url: typeof install.url === "string" ? install.url : undefined,
      number: typeof install.number === "number" ? install.number : undefined,
      branch: typeof install.branch === "string" ? install.branch : undefined,
      title: typeof install.title === "string" ? install.title : undefined,
      repo: typeof install.repo === "string" ? install.repo : undefined,
    };
    rows.push({
      key: "install",
      kind: "install",
      pr,
      title: "Install Darwin analytics for people and agents",
      state: prState(pr),
      at: typeof install.at === "string" ? install.at : undefined,
      diff: [],
    });
  }
  return rows;
}

/** GitHub mode from /api/github/status: "live" opens real PRs; anything else drafts previews. */
export function githubLive(status: unknown): boolean {
  const s = status as { configured?: boolean; dryRun?: boolean; mode?: string } | undefined;
  if (!s) return false;
  if (typeof s.dryRun === "boolean") return !s.dryRun;
  if (typeof s.mode === "string") return s.mode === "live";
  return Boolean(s.configured);
}

/* ------------------------------------------------------------------ JSON diff for the code card */

export interface CodeLine {
  kind: "ctx" | "add" | "del";
  depth: number;
  text: string;
}

interface Node {
  children: Map<string, Node>;
  line?: DiffLine;
}

/** Diff lines → a storefront.config.json-shaped diff ("cart": { - old, + new }). */
export function diffCode(diff: string[]): CodeLine[] {
  const root: Node = { children: new Map() };
  for (const raw of diff) {
    const l = parseDiffLine(raw);
    let node = root;
    for (const k of l.path.split(".")) {
      if (!node.children.has(k)) node.children.set(k, { children: new Map() });
      node = node.children.get(k)!;
    }
    node.line = l;
  }
  const out: CodeLine[] = [];
  const walk = (node: Node, depth: number) => {
    const entries = [...node.children.entries()];
    entries.forEach(([key, child], i) => {
      const comma = i < entries.length - 1 ? "," : "";
      if (child.line && !child.children.size) {
        if (child.line.before !== undefined) out.push({ kind: "del", depth, text: `"${key}": ${child.line.before}${comma}` });
        if (child.line.after !== undefined) out.push({ kind: "add", depth, text: `"${key}": ${child.line.after}${comma}` });
        if (child.line.before === undefined && child.line.after === undefined) out.push({ kind: "ctx", depth, text: child.line.raw });
        return;
      }
      out.push({ kind: "ctx", depth, text: `"${key}": {` });
      walk(child, depth + 1);
      out.push({ kind: "ctx", depth, text: `}${comma}` });
    });
  };
  walk(root, 0);
  return out;
}
