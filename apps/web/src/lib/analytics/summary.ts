/**
 * Analytics summary: KPIs + funnel per visitor kind, friction signals, agent tool stats, and
 * per-variant experiment comparison.
 *
 * Everything is computed in ONE pass over the event store (200k events in well under 500ms): one
 * visitor map holds funnel steps as bitmasks plus the little state the ordered signals need (rage
 * clicks, shipping shock, dead ends). Funnel semantics: a visitor "reached" a step if they ever fired
 * that event (agents enter the funnel via `agent_request` instead of `$pageview`).
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

// Event names as module-local constants: imported bindings are getter calls under some transforms
// (vitest, tsx, dev bundles), which is measurable in a 200k-iteration loop.
const PAGELEAVE: string = EVENTS.pageleave;
const AUTOCAPTURE: string = EVENTS.autocapture;
const RAGECLICK: string = EVENTS.rageclick;
const PRODUCT_VIEWED: string = EVENTS.productViewed;
const PRODUCT_ADDED: string = EVENTS.productAdded;
const SHIPPING_REVEALED: string = EVENTS.shippingRevealed;
const CHECKOUT_ABANDONED: string = EVENTS.checkoutAbandoned;
const ORDER_COMPLETED: string = EVENTS.orderCompleted;
const AGENT_REQUEST: string = EVENTS.agentRequest;
const AGENT_ABANDONED: string = EVENTS.agentAbandoned;

const STEP_COUNT = FUNNEL_STEPS.length;
const STEP_INDEX = new Map<string, number>(FUNNEL_STEPS.map((s, i) => [s, i]));
STEP_INDEX.set(AGENT_REQUEST, 0);

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
  /** False when the filter is empty, so the hot loop can skip it. */
  active: boolean;
}

const isoOrRaw = (s: string | undefined) => {
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
};

function compileFilter(f: AnalyticsFilter): CompiledFilter {
  const cf = {
    from: isoOrRaw(f.from),
    to: isoOrRaw(f.to),
    visitorKind: f.visitorKind,
    experimentId: f.experimentId,
    variant: f.variant,
    specVersion: f.specVersion,
    excludeSynthetic: f.includeSynthetic === false,
  };
  const active = Boolean(cf.from || cf.to || cf.visitorKind || cf.experimentId || cf.variant || cf.excludeSynthetic || cf.specVersion !== undefined);
  return { ...cf, active };
}

function matches(e: AnalyticsEvent, f: CompiledFilter): boolean {
  if (!f.active) return true;
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

const HUMAN_BIT = 1;
const AGENT_BIT = 2;

/** Everything tracked per visitor, in one map: one hash lookup per event. */
interface VisitorRec {
  /** First-seen kind: the audience friction is attributed to. */
  kind: VisitorKind;
  kinds: number;
  /** Funnel steps reached, as bitmasks per kind. */
  humanSteps: number;
  agentSteps: number;
  lastSession?: string;
  lastSessionKind?: VisitorKind;
  /* friction state */
  added?: boolean;
  /** Raw pathnames where this visitor fired product_viewed. */
  productPaths?: string[];
  /** Normalized product pages this visitor left (dead-end candidates). */
  leftProductPages?: string[];
  shippingAt?: string;
  shippingFee?: number;
  abandonedAfterShipping?: boolean;
  completedAfterShipping?: boolean;
  clickKey?: string;
  clickTimes?: number[];
  lastTool?: string;
}

class KpiAcc {
  readonly visitors = new Map<string, VisitorRec>();
  private sessions: Record<VisitorKind, Set<string>> = { human: new Set(), agent: new Set() };
  private orders = { human: 0, agent: 0 };
  private revenue = { human: 0, agent: 0 };

  add(e: AnalyticsEvent, kind: VisitorKind): VisitorRec {
    let r = this.visitors.get(e.distinct_id);
    if (!r) this.visitors.set(e.distinct_id, (r = { kind, kinds: 0, humanSteps: 0, agentSteps: 0 }));
    const agent = kind === "agent";
    r.kinds |= agent ? AGENT_BIT : HUMAN_BIT;
    const sid = e.properties.$session_id;
    if (sid && (sid !== r.lastSession || kind !== r.lastSessionKind)) {
      this.sessions[kind].add(sid);
      r.lastSession = sid;
      r.lastSessionKind = kind;
    }
    const step = STEP_INDEX.get(e.event);
    if (step !== undefined) {
      if (agent) r.agentSteps |= 1 << step;
      else r.humanSteps |= 1 << step;
    }
    if (e.event === ORDER_COMPLETED) {
      this.orders[kind]++;
      this.revenue[kind] += Number(e.properties.revenue ?? 0) || 0;
    }
    return r;
  }

  finish(): { overall: SegmentKpis; byKind: Record<VisitorKind, SegmentKpis> } {
    const zero = () => new Array<number>(STEP_COUNT).fill(0);
    const steps = { human: zero(), agent: zero(), overall: zero() };
    const visitors = { human: 0, agent: 0 };
    for (const r of this.visitors.values()) {
      if (r.kinds & HUMAN_BIT) visitors.human++;
      if (r.kinds & AGENT_BIT) visitors.agent++;
      const any = r.humanSteps | r.agentSteps;
      for (let i = 0; any && i < STEP_COUNT; i++) {
        const bit = 1 << i;
        if (r.humanSteps & bit) steps.human[i]++;
        if (r.agentSteps & bit) steps.agent[i]++;
        if (any & bit) steps.overall[i]++;
      }
    }
    const { sessions, orders, revenue } = this;
    return {
      overall: kpisFrom(
        this.visitors.size,
        unionSize(sessions.human, sessions.agent),
        steps.overall,
        orders.human + orders.agent,
        revenue.human + revenue.agent,
      ),
      byKind: {
        human: kpisFrom(visitors.human, sessions.human.size, steps.human, orders.human, revenue.human),
        agent: kpisFrom(visitors.agent, sessions.agent.size, steps.agent, orders.agent, revenue.agent),
      },
    };
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

/** KPIs for one segment of events (kept from the scaffold API). */
export function computeKpis(events: readonly AnalyticsEvent[]): SegmentKpis {
  const acc = new KpiAcc();
  for (const e of events) acc.add(e, kindOf(e.properties));
  return acc.finish().overall;
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

const locationCache = new Map<string, Map<string, string>>();

/** Where a click happened: `<normalized path> <selector>`. */
function clickLocation(p: EventProperties): string {
  const chain = p.$elements_chain;
  if (typeof chain === "string" && chain) {
    // Hot path (autocapture): memoized per (path, chain) so the steady state allocates nothing.
    const path = rawPath(p) ?? "";
    let byChain = locationCache.get(path);
    if (!byChain) {
      if (locationCache.size > 2000) locationCache.clear();
      locationCache.set(path, (byChain = new Map()));
    }
    let loc = byChain.get(chain);
    if (loc === undefined) {
      loc = [path ? normalizePath(path) : undefined, selectorFromChain(chain)].filter(Boolean).join(" ");
      if (byChain.size > 2000) byChain.clear();
      byChain.set(chain, loc);
    }
    return loc;
  }
  let selector: string | undefined;
  if (Array.isArray(p.$elements) && p.$elements[0] && typeof p.$elements[0] === "object") {
    const el = p.$elements[0] as Record<string, unknown>;
    const classes = Array.isArray(el.attr__class) ? (el.attr__class as string[]) : String(el.attr__class ?? "").split(" ").filter(Boolean);
    selector = buildSelector(el.tag_name as string, el.attr__id as string, el, el.$el_text, classes);
  } else {
    const explicit = p.selector ?? p.element ?? p.$el_text;
    if (typeof explicit === "string" && explicit) selector = p.$el_text === explicit ? `"${explicit.slice(0, 40)}"` : explicit;
  }
  const path = rawPath(p);
  return [path ? normalizePath(path) : undefined, selector].filter(Boolean).join(" ") || "unknown element";
}

/* ------------------------------------------------------------------ friction */

interface FrictionAcc {
  kind: FrictionSignal["kind"];
  audience: VisitorKind;
  visitors: Set<string>;
  /** Hit counts per location / detail; the most common one is reported. */
  locations: Map<string, number>;
  details: Map<string, number>;
}

/**
 * What a signal is grouped by. Agent abandons and missing fields group by reason/field (the fix is the
 * same whichever tool surfaced it, e.g. "no delivery ETA"); everything else groups by location.
 */
const GROUP_BY_DETAIL = new Set<FrictionSignal["kind"]>(["agent_missing_field", "agent_abandoned"]);

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
function mostCommon(m: Map<string, number>): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const [k, c] of m) if (c > n) [best, n] = [k, c];
  return best;
}

class FrictionTracker {
  /** kind → audience → group → accumulator (nested maps: no key strings allocated per hit). */
  private signals = new Map<FrictionSignal["kind"], Record<VisitorKind, Map<string, FrictionAcc>>>();
  readonly tools = new Map<string, AgentToolStat>();

  private hit(kind: FrictionSignal["kind"], audience: VisitorKind, location: string, visitor: string, detail?: string) {
    const group = GROUP_BY_DETAIL.has(kind) ? (detail ?? "") : location;
    let byAudience = this.signals.get(kind);
    if (!byAudience) this.signals.set(kind, (byAudience = { human: new Map(), agent: new Map() }));
    const groups = byAudience[audience];
    let acc = groups.get(group);
    if (!acc) groups.set(group, (acc = { kind, audience, visitors: new Set(), locations: new Map(), details: new Map() }));
    acc.visitors.add(visitor);
    bump(acc.locations, location);
    if (detail !== undefined) bump(acc.details, detail);
  }

  /** Called for every filtered event with its visitor record. Cheap for events it doesn't care about. */
  add(e: AnalyticsEvent, kind: VisitorKind, s: VisitorRec) {
    const p = e.properties;
    const id = e.distinct_id;
    switch (e.event) {
      case PRODUCT_VIEWED: {
        const path = rawPath(p);
        if (!path) return;
        const paths = (s.productPaths ??= []);
        if (!paths.includes(path)) paths.push(path);
        return;
      }
      case PRODUCT_ADDED:
        s.added = true;
        return;
      case PAGELEAVE: {
        const path = rawPath(p);
        if (!path) return;
        const norm = normalizePath(path);
        if (s.productPaths?.includes(path) || PRODUCT_PATH.test(norm)) {
          if (!s.leftProductPages?.includes(norm)) (s.leftProductPages ??= []).push(norm);
        }
        return;
      }
      case SHIPPING_REVEALED: {
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
      case CHECKOUT_ABANDONED:
        if (s.shippingAt !== undefined) s.abandonedAfterShipping = true;
        return;
      case ORDER_COMPLETED:
        if (s.shippingAt !== undefined) s.completedAfterShipping = true;
        return;
      case RAGECLICK:
        this.hit("rage_click", kind, clickLocation(p), id);
        return;
      case AUTOCAPTURE: {
        if (p.$event_type !== undefined && p.$event_type !== "click") return;
        const t = Date.parse(e.timestamp);
        if (!Number.isFinite(t)) return;
        const loc = clickLocation(p);
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
      case AGENT_REQUEST: {
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
        s.lastTool = tool;
        return;
      }
      case AGENT_ABANDONED: {
        const where = typeof p.tool === "string" && p.tool ? p.tool : (s.lastTool ?? "agent session");
        this.hit("agent_abandoned", kind, where, id, typeof p.reason === "string" ? p.reason : "unknown");
        return;
      }
    }
  }

  finish(visitors: Map<string, VisitorRec>, visitorsByKind: Record<VisitorKind, number>): FrictionSignal[] {
    for (const [id, s] of visitors) {
      if (s.leftProductPages && !s.added) {
        for (const page of s.leftProductPages) this.hit("dead_end", s.kind, page, id, "left product page without adding to cart");
      }
      if (s.shippingAt !== undefined && (s.abandonedAfterShipping || !s.completedAfterShipping)) {
        const detail =
          s.shippingFee !== undefined
            ? `abandoned after £${(s.shippingFee / 100).toFixed(2)} shipping was revealed`
            : "abandoned after shipping cost was revealed";
        this.hit("shipping_shock", s.kind, s.shippingAt, id, detail);
      }
    }
    const out: FrictionSignal[] = [];
    for (const byAudience of this.signals.values()) {
      for (const a of [...byAudience.human.values(), ...byAudience.agent.values()]) {
        const total = visitorsByKind[a.audience];
        const detail = mostCommon(a.details);
        out.push({
          kind: a.kind,
          audience: a.audience,
          location: mostCommon(a.locations) ?? "unknown",
          count: a.visitors.size,
          share: total ? Math.min(1, a.visitors.size / total) : 0,
          ...(detail !== undefined ? { detail } : {}),
        });
      }
    }
    out.sort((x, y) => y.count - x.count || y.share - x.share || x.location.localeCompare(y.location));
    return out.slice(0, MAX_FRICTION_SIGNALS);
  }
}

/* ------------------------------------------------------------------ summary */

/** Summarize a list of events. One pass; see file header. */
export function summarize(events: readonly AnalyticsEvent[], filter: AnalyticsFilter = {}): AnalyticsSummary {
  const cf = compileFilter(filter);
  const kpis = new KpiAcc();
  const friction = new FrictionTracker();
  let total = 0;
  let from: string | undefined;
  let to: string | undefined;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (cf.active && !matches(e, cf)) continue;
    total++;
    const ts = e.timestamp;
    if (from === undefined || ts < from) from = ts;
    if (to === undefined || ts > to) to = ts;
    const kind = kindOf(e.properties);
    friction.add(e, kind, kpis.add(e, kind));
  }

  const now = new Date().toISOString();
  const { overall, byKind } = kpis.finish();
  return {
    from: from ?? now,
    to: to ?? now,
    totalEvents: total,
    overall,
    byKind,
    friction: friction.finish(kpis.visitors, { human: byKind.human.visitors, agent: byKind.agent.visitors }),
    agentTools: [...friction.tools.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool)),
    filter,
  };
}

/** The summary the console and optimizer read (whole store, filtered). */
export function getAnalyticsSummary(filter: AnalyticsFilter = {}): AnalyticsSummary {
  return summarize(eventStore().all(), filter);
}

const lastSummaries = new Map<string, { events: readonly AnalyticsEvent[]; length: number; newest?: string; summary: AnalyticsSummary }>();

/**
 * getAnalyticsSummary for polled, read-only endpoints: the last summary for the same filter is reused
 * until an event is added or the store is reset (same array, same length, same newest event), so
 * repeated polls between events cost nothing. The result is shared: don't mutate it.
 */
export function getAnalyticsSummaryShared(filter: AnalyticsFilter = {}): AnalyticsSummary {
  const events = eventStore().all();
  const key = JSON.stringify(filter);
  const newest = events[events.length - 1]?.uuid;
  const hit = lastSummaries.get(key);
  if (hit && hit.events === events && hit.length === events.length && hit.newest === newest) return hit.summary;
  const summary = summarize(events, filter);
  if (lastSummaries.size >= 32) lastSummaries.clear();
  lastSummaries.set(key, { events, length: events.length, newest, summary });
  return summary;
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

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (cf.active && !matches(e, cf)) continue;
    const p = e.properties;
    const id = e.distinct_id;
    let variant = variantOf.get(id);
    if (p.experiment_id === experimentId && typeof p.variant === "string" && p.variant) {
      if (!variant) variantOf.set(id, (variant = p.variant));
      arm(variant)[kindOf(p)].visitors.add(id);
    }
    if (variant && e.event === ORDER_COMPLETED && (p.experiment_id === undefined || p.experiment_id === experimentId)) {
      const a = arm(variant)[kindOf(p)];
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
