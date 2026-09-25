/**
 * Analytics summary: KPIs + funnel per visitor kind, friction signals, agent tool stats, and
 * per-variant experiment comparison.
 *
 * Everything is computed in ONE pass over the event store (200k events in well under 500ms),
 * with small per-visitor state for the signals that need ordering (rage clicks, shipping shock,
 * dead ends). Funnel semantics: a visitor "reached" a step if they ever fired that event
 * (agents enter the funnel via `agent_request` instead of `$pageview`).
 */
import {
  EVENTS,
  FUNNEL_STEPS,
  type AgentToolStat,
  type AnalyticsEvent,
  type AnalyticsFilter,
  type AnalyticsSummary,
  type EventProperties,
  type FrictionSignal,
  type SegmentKpis,
  type VariantStats,
  type VisitorKind,
} from "@/lib/contracts";
import { eventStore } from "./store";

const STEP_COUNT = FUNNEL_STEPS.length;
const STEP_INDEX: Record<string, number> = Object.fromEntries(FUNNEL_STEPS.map((s, i) => [s, i]));
STEP_INDEX[EVENTS.agentRequest] = 0;

/** Rage click fallback: this many autocaptured clicks on one element… */
const RAGE_CLICKS = 3;
/** …within this window. */
const RAGE_WINDOW_MS = 2000;
const MAX_FRICTION_SIGNALS = 100;

const kindOf = (p: EventProperties): VisitorKind => (p.visitor_kind === "agent" ? "agent" : "human");

/* ------------------------------------------------------------------ filtering */

interface CompiledFilter {
  from?: string;
  to?: string;
  visitorKind?: VisitorKind;
  experimentId?: string;
  variant?: string;
  specVersion?: number;
  excludeSynthetic: boolean;
}

const isoOrRaw = (s: string | undefined) => {
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
};

function compileFilter(f: AnalyticsFilter): CompiledFilter {
  return {
    from: isoOrRaw(f.from),
    to: isoOrRaw(f.to),
    visitorKind: f.visitorKind,
    experimentId: f.experimentId,
    variant: f.variant,
    specVersion: f.specVersion,
    excludeSynthetic: f.includeSynthetic === false,
  };
}

function matches(e: AnalyticsEvent, f: CompiledFilter): boolean {
  const p = e.properties;
  if (f.from && e.timestamp < f.from) return false;
  if (f.to && e.timestamp > f.to) return false;
  if (f.visitorKind && kindOf(p) !== f.visitorKind) return false;
  if (f.experimentId && p.experiment_id !== f.experimentId) return false;
  if (f.variant && p.variant !== f.variant) return false;
  if (f.specVersion !== undefined && p.spec_version !== f.specVersion) return false;
  if (f.excludeSynthetic && p.synthetic) return false;
  return true;
}

export function filterEvents(events: readonly AnalyticsEvent[], f: AnalyticsFilter = {}): AnalyticsEvent[] {
  const cf = compileFilter(f);
  return events.filter((e) => matches(e, cf));
}

/* ------------------------------------------------------------------ KPIs */

class SegmentAcc {
  visitors = new Set<string>();
  sessions = new Set<string>();
  steps: Set<string>[] = Array.from({ length: STEP_COUNT }, () => new Set<string>());
  orders = 0;
  revenue = 0;

  add(e: AnalyticsEvent) {
    const p = e.properties;
    this.visitors.add(e.distinct_id);
    if (p.$session_id) this.sessions.add(p.$session_id);
    const step = STEP_INDEX[e.event];
    if (step !== undefined) this.steps[step].add(e.distinct_id);
    if (e.event === EVENTS.orderCompleted) {
      this.orders++;
      this.revenue += Number(p.revenue ?? 0) || 0;
    }
  }
}

function unionSize(a: Set<string>, b: Set<string>): number {
  if (a.size < b.size) [a, b] = [b, a];
  let n = a.size;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}

function kpisFrom(visitors: number, sessions: number, stepSizes: number[], orders: number, revenue: number): SegmentKpis {
  const first = Math.max(1, stepSizes[0]);
  const funnel = FUNNEL_STEPS.map((step, i) => {
    const n = stepSizes[i];
    const prev = i === 0 ? n : stepSizes[i - 1];
    return { step, visitors: n, rateFromStart: n / first, rateFromPrevious: prev ? n / prev : 0 };
  });
  const buyers = stepSizes[STEP_COUNT - 1];
  return {
    visitors,
    sessions,
    orders,
    revenue,
    conversionRate: visitors ? buyers / visitors : 0,
    averageOrderValue: orders ? revenue / orders : 0,
    funnel,
  };
}

const segmentKpis = (a: SegmentAcc) =>
  kpisFrom(a.visitors.size, a.sessions.size, a.steps.map((s) => s.size), a.orders, a.revenue);

const mergedKpis = (a: SegmentAcc, b: SegmentAcc) =>
  kpisFrom(
    unionSize(a.visitors, b.visitors),
    unionSize(a.sessions, b.sessions),
    a.steps.map((s, i) => unionSize(s, b.steps[i])),
    a.orders + b.orders,
    a.revenue + b.revenue,
  );

export function computeKpis(events: readonly AnalyticsEvent[]): SegmentKpis {
  const acc = new SegmentAcc();
  for (const e of events) acc.add(e);
  return segmentKpis(acc);
}

/* ------------------------------------------------------------------ locations */

const ID_PARENT = /^(products?|p|items?|orders?|collections?|categories?|c)$/i;
const ID_LIKE = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|p_[a-z0-9_-]+)$/i;
const PRODUCT_PATH = /\/(products?|p|items?)\/\[id\]/;
const pathCache = new Map<string, string>();

/** `/store/products/aurora-daily-trainer?x=1` → `/store/products/[id]` (cached). */
export function normalizePath(path: string): string {
  const hit = pathCache.get(path);
  if (hit !== undefined) return hit;
  let clean = path.split(/[?#]/, 1)[0] || "/";
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  const parts = clean.split("/");
  for (let i = 1; i < parts.length; i++) {
    if (ID_PARENT.test(parts[i - 1]) || ID_LIKE.test(parts[i])) parts[i] = "[id]";
  }
  const out = parts.join("/") || "/";
  if (pathCache.size > 5000) pathCache.clear();
  pathCache.set(path, out);
  return out;
}

function rawPath(p: EventProperties): string | undefined {
  if (typeof p.$pathname === "string") return p.$pathname;
  const url = p.$current_url;
  if (typeof url !== "string") return undefined;
  const scheme = url.indexOf("://");
  const start = scheme === -1 ? url.indexOf("/") : url.indexOf("/", scheme + 3);
  if (start === -1) return "/";
  const end = url.slice(start).search(/[?#]/);
  return end === -1 ? url.slice(start) : url.slice(start, start + end);
}

const chainCache = new Map<string, string>();
const ATTR = /([\w-]+)="((?:[^"\\]|\\.)*)"/g;

/** Readable selector for the first element of a PostHog `$elements_chain`: `button#buy "Add to cart"`. */
function selectorFromChain(chain: string): string {
  const hit = chainCache.get(chain);
  if (hit !== undefined) return hit;
  // First element ends at the first ';' outside quotes.
  let end = chain.length;
  let inQuote = false;
  for (let i = 0; i < chain.length; i++) {
    const c = chain.charCodeAt(i);
    if (c === 92 /* \ */) i++;
    else if (c === 34 /* " */) inQuote = !inQuote;
    else if (c === 59 /* ; */ && !inQuote) {
      end = i;
      break;
    }
  }
  const first = chain.slice(0, end);
  const colon = first.indexOf(":");
  const head = colon === -1 ? first : first.slice(0, colon);
  const attrs: Record<string, string> = {};
  if (colon !== -1) for (const m of first.slice(colon + 1).matchAll(ATTR)) attrs[m[1]] = m[2].replace(/\\"/g, '"');
  const [tag, ...classes] = head.split(".");
  const out = buildSelector(tag, attrs.attr_id ?? attrs.attr__id, attrs, attrs.text, classes);
  if (chainCache.size > 5000) chainCache.clear();
  chainCache.set(chain, out);
  return out;
}

function buildSelector(tag: string | undefined, id: string | undefined, attrs: Record<string, unknown>, text: unknown, classes: string[]) {
  let s = tag || "element";
  if (id) s += `#${id}`;
  const testId = attrs["attr__data-testid"] ?? attrs["attr__data-track"] ?? attrs["attr__data-darwin"];
  if (typeof testId === "string" && testId) s += `[data-testid="${testId}"]`;
  if (typeof text === "string" && text.trim()) s += ` "${text.trim().slice(0, 40)}"`;
  else if (!id && !testId && classes.length) s += `.${classes.slice(0, 2).join(".")}`;
  return s;
}

/** Where a click happened: `<normalized path> <selector>`. */
function clickLocation(p: EventProperties): string {
  let selector: string | undefined;
  if (typeof p.$elements_chain === "string" && p.$elements_chain) selector = selectorFromChain(p.$elements_chain);
  else if (Array.isArray(p.$elements) && p.$elements[0] && typeof p.$elements[0] === "object") {
    const el = p.$elements[0] as Record<string, unknown>;
    const classes = Array.isArray(el.attr__class) ? (el.attr__class as string[]) : String(el.attr__class ?? "").split(" ").filter(Boolean);
    selector = buildSelector(el.tag_name as string, el.attr__id as string, el, el.$el_text, classes);
  } else {
    const explicit = p.selector ?? p.element ?? p.$el_text;
    if (typeof explicit === "string" && explicit) selector = p.$el_text === explicit ? `"${explicit.slice(0, 40)}"` : explicit;
  }
  const path = rawPath(p);
  const where = path ? normalizePath(path) : undefined;
  return [where, selector].filter(Boolean).join(" ") || "unknown element";
}

/* ------------------------------------------------------------------ friction */

interface VisitorState {
  kind: VisitorKind;
  added?: boolean;
  /** Raw pathnames where this visitor fired product_viewed. */
  productPaths?: string[];
  /** Normalized product pages this visitor left (dead-end candidates). */
  leftProductPages?: string[];
  /** Shipping shock tracking. */
  shippingAt?: string;
  shippingFee?: number;
  abandonedAfterShipping?: boolean;
  completedAfterShipping?: boolean;
  /** Rage-click fallback tracking. */
  clickKey?: string;
  clickTimes?: number[];
  lastTool?: string;
}

interface FrictionAcc {
  kind: FrictionSignal["kind"];
  audience: VisitorKind;
  location: string;
  detail?: string;
  visitors: Set<string>;
}

class FrictionTracker {
  private visitors = new Map<string, VisitorState>();
  private signals = new Map<string, FrictionAcc>();
  readonly tools = new Map<string, AgentToolStat>();

  private state(id: string, kind: VisitorKind): VisitorState {
    let s = this.visitors.get(id);
    if (!s) this.visitors.set(id, (s = { kind }));
    return s;
  }

  private hit(kind: FrictionSignal["kind"], audience: VisitorKind, location: string, visitor: string, detail?: string) {
    const key = `${audience}\u0000${kind}\u0000${location}\u0000${detail ?? ""}`;
    let acc = this.signals.get(key);
    if (!acc) this.signals.set(key, (acc = { kind, audience, location, detail, visitors: new Set() }));
    acc.visitors.add(visitor);
  }

  /** Called for every filtered event. Cheap for events it doesn't care about. */
  add(e: AnalyticsEvent, kind: VisitorKind) {
    const p = e.properties;
    const id = e.distinct_id;
    switch (e.event) {
      case EVENTS.productViewed: {
        const path = rawPath(p);
        if (!path) return;
        const paths = (this.state(id, kind).productPaths ??= []);
        if (!paths.includes(path)) paths.push(path);
        return;
      }
      case EVENTS.productAdded:
        this.state(id, kind).added = true;
        return;
      case EVENTS.pageleave: {
        const path = rawPath(p);
        if (!path) return;
        const s = this.visitors.get(id);
        const norm = normalizePath(path);
        if (s?.productPaths?.includes(path) || PRODUCT_PATH.test(norm)) {
          const st = s ?? this.state(id, kind);
          if (!st.leftProductPages?.includes(norm)) (st.leftProductPages ??= []).push(norm);
        }
        return;
      }
      case EVENTS.shippingRevealed: {
        const s = this.state(id, kind);
        if (s.shippingAt === undefined) {
          const path = rawPath(p);
          s.shippingAt = path ? normalizePath(path) : "checkout";
          const fee = Number(p.shipping ?? p.shipping_cost ?? p.shipping_fee);
          if (Number.isFinite(fee)) s.shippingFee = fee;
        }
        s.abandonedAfterShipping = false;
        s.completedAfterShipping = false;
        return;
      }
      case EVENTS.checkoutAbandoned: {
        const s = this.visitors.get(id);
        if (s?.shippingAt !== undefined) s.abandonedAfterShipping = true;
        return;
      }
      case EVENTS.orderCompleted: {
        const s = this.visitors.get(id);
        if (s?.shippingAt !== undefined) s.completedAfterShipping = true;
        return;
      }
      case EVENTS.rageclick:
        this.hit("rage_click", kind, clickLocation(p), id);
        return;
      case EVENTS.autocapture: {
        if (p.$event_type !== undefined && p.$event_type !== "click") return;
        const t = Date.parse(e.timestamp);
        if (!Number.isFinite(t)) return;
        const loc = clickLocation(p);
        const s = this.state(id, kind);
        if (s.clickKey === loc && s.clickTimes) {
          s.clickTimes.push(t);
          while (s.clickTimes.length && t - s.clickTimes[0] > RAGE_WINDOW_MS) s.clickTimes.shift();
        } else {
          s.clickKey = loc;
          s.clickTimes = [t];
        }
        if (s.clickTimes.length >= RAGE_CLICKS) this.hit("rage_click", kind, loc, id);
        return;
      }
      case EVENTS.agentRequest: {
        const tool = typeof p.tool === "string" && p.tool ? p.tool : "unknown";
        let stat = this.tools.get(tool);
        if (!stat) this.tools.set(tool, (stat = { tool, calls: 0, errors: 0, missing: {} }));
        stat.calls++;
        if (p.ok === false) {
          stat.errors++;
          const detail = typeof p.error === "string" ? p.error : typeof p.reason === "string" ? p.reason : undefined;
          this.hit("agent_error", kind, tool, id, detail);
        }
        if (Array.isArray(p.missing)) {
          for (const field of p.missing) {
            if (typeof field !== "string") continue;
            stat.missing[field] = (stat.missing[field] ?? 0) + 1;
            this.hit("agent_missing_field", kind, tool, id, field);
          }
        }
        this.state(id, kind).lastTool = tool;
        return;
      }
      case EVENTS.agentAbandoned: {
        const s = this.visitors.get(id);
        const where = typeof p.tool === "string" && p.tool ? p.tool : (s?.lastTool ?? "agent session");
        this.hit("agent_abandoned", kind, where, id, typeof p.reason === "string" ? p.reason : "unknown");
        return;
      }
    }
  }

  finish(visitorsByKind: Record<VisitorKind, number>): FrictionSignal[] {
    for (const [id, s] of this.visitors) {
      if (s.leftProductPages && !s.added) {
        for (const page of s.leftProductPages) this.hit("dead_end", s.kind, page, id, "left product page without adding to cart");
      }
      if (s.shippingAt !== undefined && (s.abandonedAfterShipping || !s.completedAfterShipping)) {
        const detail = s.shippingFee !== undefined ? `abandoned after £${(s.shippingFee / 100).toFixed(2)} shipping was revealed` : "abandoned after shipping cost was revealed";
        this.hit("shipping_shock", s.kind, s.shippingAt, id, detail);
      }
    }
    const out: FrictionSignal[] = [];
    for (const a of this.signals.values()) {
      const total = visitorsByKind[a.audience];
      out.push({
        kind: a.kind,
        audience: a.audience,
        location: a.location,
        count: a.visitors.size,
        share: total ? Math.min(1, a.visitors.size / total) : 0,
        ...(a.detail !== undefined ? { detail: a.detail } : {}),
      });
    }
    out.sort((x, y) => y.count - x.count || y.share - x.share || x.location.localeCompare(y.location));
    return out.slice(0, MAX_FRICTION_SIGNALS);
  }
}

/* ------------------------------------------------------------------ summary */

/** Summarize events (defaults to the whole store). One pass; see file header. */
export function summarize(events: readonly AnalyticsEvent[], filter: AnalyticsFilter = {}): AnalyticsSummary {
  const cf = compileFilter(filter);
  const seg: Record<VisitorKind, SegmentAcc> = { human: new SegmentAcc(), agent: new SegmentAcc() };
  const friction = new FrictionTracker();
  let total = 0;
  let from: string | undefined;
  let to: string | undefined;

  for (const e of events) {
    if (!matches(e, cf)) continue;
    total++;
    if (from === undefined || e.timestamp < from) from = e.timestamp;
    if (to === undefined || e.timestamp > to) to = e.timestamp;
    const kind = kindOf(e.properties);
    seg[kind].add(e);
    friction.add(e, kind);
  }

  const now = new Date().toISOString();
  const byKind = { human: segmentKpis(seg.human), agent: segmentKpis(seg.agent) };
  return {
    from: from ?? now,
    to: to ?? now,
    totalEvents: total,
    overall: mergedKpis(seg.human, seg.agent),
    byKind,
    friction: friction.finish({ human: byKind.human.visitors, agent: byKind.agent.visitors }),
    agentTools: [...friction.tools.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
    filter,
  };
}

export function getAnalyticsSummary(filter: AnalyticsFilter = {}): AnalyticsSummary {
  return summarize(eventStore().all(), filter);
}

/* ------------------------------------------------------------------ experiments */

export interface VariantKindStats {
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}

/** `VariantStats` (contracts/loop.ts) plus revenue per kind. Assignable to `VariantStats`. */
export interface VariantComparison extends VariantStats {
  byKind: Record<VisitorKind, VariantKindStats>;
}

export type VariantComparisonResult = { control: VariantComparison; treatment: VariantComparison } & Record<
  string,
  VariantComparison
>;

/**
 * Per-variant results for one experiment, overall and by visitor kind.
 * A visitor belongs to the first variant they were seen in (sticky); conversions are distinct
 * visitors with `order_completed` after exposure (attributed via the event or their exposure).
 */
export function compareVariants(
  experimentId: string,
  filter: Pick<AnalyticsFilter, "from" | "to" | "includeSynthetic"> = {},
  events: readonly AnalyticsEvent[] = eventStore().all(),
): VariantComparisonResult {
  const cf = compileFilter(filter);
  const variantOf = new Map<string, string>();
  type Acc = Record<VisitorKind, { visitors: Set<string>; buyers: Set<string>; revenue: number }>;
  const arms = new Map<string, Acc>();
  const arm = (v: string) => {
    let a = arms.get(v);
    if (!a) {
      const mk = () => ({ visitors: new Set<string>(), buyers: new Set<string>(), revenue: 0 });
      arms.set(v, (a = { human: mk(), agent: mk() }));
    }
    return a;
  };
  arm("control");
  arm("treatment");

  for (const e of events) {
    if (!matches(e, cf)) continue;
    const p = e.properties;
    const id = e.distinct_id;
    const kind = kindOf(p);
    let variant = variantOf.get(id);
    if (p.experiment_id === experimentId && typeof p.variant === "string" && p.variant) {
      if (!variant) variantOf.set(id, (variant = p.variant));
      arm(variant)[kind].visitors.add(id);
    }
    if (e.event === EVENTS.orderCompleted && variant) {
      if (p.experiment_id !== undefined && p.experiment_id !== experimentId) continue;
      const a = arm(variant)[kind];
      a.visitors.add(id);
      a.buyers.add(id);
      a.revenue += Number(p.revenue ?? 0) || 0;
    }
  }

  const out = {} as VariantComparisonResult;
  for (const [variant, a] of arms) {
    const k = (kind: VisitorKind): VariantKindStats => {
      const visitors = a[kind].visitors.size;
      const conversions = a[kind].buyers.size;
      return { visitors, conversions, conversionRate: visitors ? conversions / visitors : 0, revenue: a[kind].revenue };
    };
    const human = k("human");
    const agent = k("agent");
    const visitors = unionSize(a.human.visitors, a.agent.visitors);
    const conversions = unionSize(a.human.buyers, a.agent.buyers);
    out[variant] = {
      variant,
      visitors,
      conversions,
      revenue: human.revenue + agent.revenue,
      conversionRate: visitors ? conversions / visitors : 0,
      byKind: { human, agent },
    };
  }
  return out;
}
