/**
 * Overview data model: pure functions from the console's real data (loop, experiments, summary, agent
 * sessions, analytics events) to what the Overview cards and the Live shoppers / Journey panel show.
 */
import type { AgentSessionSummary, AnalyticsEvent, AnalyticsSummary, Experiment, GenerationRecord, Insight, LoopState } from "@/lib/contracts";
import { describeEvent, money, productName } from "@/lib/console/format";
import { agentBrand, type AgentBrand } from "../agent-tile";
import type { MascotKind } from "../mascot";

/** Mirrors the optimizer (lib/optimizer/loop.ts loopConfigFromEnv): B ships at P(B beats A) ≥ 97.5%. */
export const SHIP_AT = 0.975;

export const FUNNEL = ["Visit", "View", "Cart", "Checkout", "Buy"] as const;
export const STEP_LABELS = ["Visit → view", "View → cart", "Cart → checkout", "Checkout → buy"] as const;

/* ------------------------------------------------------------------ formatting */

/** 0.052 → "5.2%", 0.27 → "27%". */
export function pctSmart(x: number | undefined | null): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return "–";
  const v = x * 100;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

/** Relative change: +67% / −3%. */
export function liftText(x: number | undefined | null): string {
  if (x === undefined || x === null || !Number.isFinite(x)) return "–";
  const v = Math.round(x * 100);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v)}%`;
}

export const countText = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));

/** mm:ss since a start time. */
export function clock(fromIso: string, atIso: string): string {
  const s = Math.max(0, Math.round((Date.parse(atIso) - Date.parse(fromIso)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------------ the running test */

export interface TestView {
  experiment: Experiment;
  running: boolean;
  audience: "all" | "human" | "agent";
  a: number;
  b: number;
  aShoppers: number;
  bShoppers: number;
  lift?: number;
  chance?: number;
}

/** The experiment the loop is running, else the latest one. Rates on the audience the decision uses. */
export function testView(loop: LoopState | undefined, experiments: Experiment[] | undefined): TestView | undefined {
  if (!experiments?.length) return undefined;
  const exp =
    experiments.find((e) => e.id === loop?.experimentId && e.status === "running") ??
    experiments.find((e) => e.status === "running") ??
    [...experiments].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))[0];
  const r = exp?.result;
  if (!exp || !r) return exp ? { experiment: exp, running: exp.status === "running", audience: "all", a: 0, b: 0, aShoppers: 0, bShoppers: 0 } : undefined;
  const audience = r.audience ?? "all";
  const rate = (v: typeof r.control) => (audience === "all" ? v.conversionRate : (v.byKind[audience]?.conversionRate ?? 0));
  const shoppers = (v: typeof r.control) => (audience === "all" ? v.visitors : (v.byKind[audience]?.visitors ?? 0));
  return {
    experiment: exp,
    running: exp.status === "running",
    audience,
    a: rate(r.control),
    b: rate(r.treatment),
    aShoppers: shoppers(r.control),
    bShoppers: shoppers(r.treatment),
    lift: Number.isFinite(r.lift) ? r.lift : undefined,
    chance: r.probabilityToBeat,
  };
}

export const whom = (a: TestView["audience"]) => (a === "human" ? "people" : a === "agent" ? "agents" : "shoppers");

/**
 * The live store's conversion if B ships: B's measured lift applied to the audience it was measured on,
 * using the latest generation's people/agent mix.
 */
export function projectIfShipped(live: GenerationRecord | undefined, t: TestView | undefined): number | undefined {
  if (!live || !t || t.lift === undefined) return undefined;
  const hv = live.humanVisitors ?? 0;
  const av = live.agentVisitors ?? 0;
  if (t.audience === "all" || !(hv + av)) return live.overallConversionRate * (1 + t.lift);
  const h = live.humanConversionRate * (t.audience === "human" ? 1 + t.lift : 1);
  const a = live.agentConversionRate * (t.audience === "agent" ? 1 + t.lift : 1);
  return (h * hv + a * av) / (hv + av);
}

/* ------------------------------------------------------------------ conversion chart */

export type ChartTab = "converts" | "shoppers" | "bought" | "better";

export interface ChartPoint {
  label: string;
  title: string;
  shoppers: number;
  bought: number;
  rate: number;
  people: number;
  agents: number;
  /** Conversion relative to where Darwin started. */
  multiple: number;
}

export function chartPoints(history: GenerationRecord[] | undefined): ChartPoint[] {
  if (!history?.length) return [];
  const base = history[0].overallConversionRate || undefined;
  return history.map((h) => {
    const shoppers = (h.humanVisitors ?? 0) + (h.agentVisitors ?? 0);
    return {
      label: h.generation === 0 ? "Start" : `Gen ${h.generation}`,
      title: h.generation === 0 ? "Your original store" : h.label.replace(/^Gen \d+:\s*/, ""),
      shoppers,
      bought: Math.round(h.overallConversionRate * shoppers),
      rate: h.overallConversionRate,
      people: h.humanConversionRate,
      agents: h.agentConversionRate,
      multiple: base ? h.overallConversionRate / base : 1,
    };
  });
}

export function seriesValue(p: ChartPoint, tab: ChartTab): number {
  return tab === "shoppers" ? p.shoppers : tab === "bought" ? p.bought : tab === "better" ? p.multiple : p.rate;
}

export function seriesText(v: number, tab: ChartTab): string {
  return tab === "shoppers" || tab === "bought" ? countText(v) : tab === "better" ? `${v.toFixed(1)}×` : pctSmart(v);
}

/** Smooth midpoint-bézier path through points (the handoff's `line` builder). */
export function smoothPath(pts: [number, number][]): string {
  if (!pts.length) return "";
  const n2 = (v: number) => Math.round(v * 100) / 100;
  let d = `M${n2(pts[0][0])},${n2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${n2(mx)},${n2(y0)} ${n2(mx)},${n2(y1)} ${n2(x1)},${n2(y1)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ agent leaderboard */

export interface BoardRow {
  brand: AgentBrand;
  shoppers: number;
  bought: number;
  rate: number;
}

export function agentBoard(sessions: AgentSessionSummary[] | undefined): BoardRow[] {
  const map = new Map<string, BoardRow>();
  for (const s of sessions ?? []) {
    if (s.outcome === "in_progress") continue;
    const brand = agentBrand(s.agentName);
    const key = brand.key === "other" ? `other:${brand.name}` : brand.key;
    const row = map.get(key) ?? { brand, shoppers: 0, bought: 0, rate: 0 };
    row.shoppers += 1;
    if (s.outcome === "purchased") row.bought += 1;
    row.rate = row.bought / row.shoppers;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.rate - a.rate || b.shoppers - a.shoppers);
}

/* ------------------------------------------------------------------ funnel */

export interface FunnelStep {
  label: string;
  people?: number;
  agents?: number;
}

export function funnelSteps(summary: AnalyticsSummary | undefined): FunnelStep[] {
  const h = summary?.byKind.human;
  const a = summary?.byKind.agent;
  // Visitors can reach a later step without the previous one (an agent adds to cart straight from
  // search), so a step-to-step rate can top 100%: cap it, it reads "everyone moved on".
  const rate = (k: typeof h, i: number) => {
    const v = k?.visitors ? k.funnel[i + 1]?.rateFromPrevious : undefined;
    return v === undefined || !Number.isFinite(v) ? undefined : Math.min(1, Math.max(0, v));
  };
  return STEP_LABELS.map((label, i) => ({ label, people: rate(h, i), agents: rate(a, i) }));
}

/* ------------------------------------------------------------------ shoppers */

export type ShopperStatus = "live" | "bought" | "left";
export type KeyTone = "warn" | "live" | "won" | "fail";

export interface ShopperStep {
  t: string;
  text: string;
  tool: string;
  tone: "ok" | "warn" | "fail" | "live";
}

export interface MockRow {
  k: string;
  v: string;
  tone?: "bad" | "good" | "live";
}

export interface KeyMoment {
  tool: string;
  pill: string;
  tone: KeyTone;
  text: string;
  mockTitle: string;
  rows: MockRow[];
}

export interface Shopper {
  id: string;
  kind: "agent" | "human";
  name: string;
  brand: AgentBrand;
  mascot: MascotKind;
  arm?: "A" | "B";
  experimentId?: string;
  synthetic: boolean;
  startedAt: string;
  lastAt: string;
  status: ShopperStatus;
  /** Furthest funnel step reached, 0..4 (Visit … Buy). */
  reach: number;
  sub: string;
  outcome: string;
  brief?: string;
  steps: ShopperStep[];
  key: KeyMoment;
  /** Brand for agents, device for people. */
  model: string;
  missing: string[];
  reason?: string;
  orderTotal?: number;
  /** Where a person entered (for insight matching). */
  path?: string;
}

const LIVE_MS = 45_000;

export const FIELD_LABEL: Record<string, string> = {
  deliveryEtaDays: "Delivery date",
  returnPolicy: "Returns policy",
  landedPrice: "Price with delivery",
  sizes: "Stock by size",
  stock: "Stock by size",
  negotiation: "Price talks",
};
const FIELD_WORDS: Record<string, string> = {
  deliveryEtaDays: "a delivery date",
  returnPolicy: "the returns policy",
  landedPrice: "the price with delivery",
  sizes: "stock by size",
  stock: "stock by size",
  negotiation: "a better price",
};
/** Which spec switch fixes a missing field (mirrors agent-commerce MISSING_FIELD_SURFACE). */
export const FIELD_SURFACE: Record<string, string> = {
  sizes: "agentSurface.exposeStock",
  stock: "agentSurface.exposeStock",
  deliveryEtaDays: "agentSurface.exposeDeliveryEta",
  returnPolicy: "agentSurface.exposeReturnPolicy",
  landedPrice: "agentSurface.exposeLandedPrice",
  negotiation: "agentSurface.negotiation",
};
const FIELD_ISSUE: Record<string, RegExp> = {
  deliveryEtaDays: /deliver|eta/i,
  returnPolicy: /return/i,
  landedPrice: /landed|incl\. delivery|shipping/i,
  sizes: /stock|size/i,
  stock: /stock|size/i,
  negotiation: /negotiat/i,
};

const CATEGORY: Record<string, string> = { trail: "Trail shoes", road: "Road running shoes", racing: "Carbon racing shoes", carbon: "Carbon racing shoes", accessories: "Running accessories" };

const armOf = (variant: string | undefined): "A" | "B" | undefined =>
  variant === "control" || variant === "A" ? "A" : variant ? "B" : undefined;

const TOOL_STAGE: Record<string, number> = {
  search_products: 0,
  get_product: 1,
  check_availability: 1,
  add_to_cart: 2,
  get_cart: 2,
  negotiate: 2,
  checkout: 3,
};

function agentStepText(tool: string, s: AgentSessionSummary, last: boolean): string {
  const goal = s.goal;
  const cat = goal?.category ? (CATEGORY[goal.category] ?? `${goal.category} items`).toLowerCase() : undefined;
  switch (tool) {
    case "search_products":
      return cat ? `Searched for ${cat}` : "Searched the catalogue";
    case "get_product":
      return "Read a product page";
    case "check_availability":
      return goal?.size ? `Checked stock in UK ${goal.size}` : "Checked stock";
    case "add_to_cart":
      return goal?.size ? `Added UK ${goal.size} to the bag` : "Added to the bag";
    case "get_cart":
      return "Looked at the bag";
    case "negotiate":
      return "Asked for a better price";
    case "checkout":
      return last && s.outcome === "purchased" ? "Paid and got an order number" : "Went to checkout";
    case "abandon":
      return "Gave up";
    default:
      return capitalise(tool.replace(/_/g, " "));
  }
}

/** Agent session → shopper. */
export function agentShopper(s: AgentSessionSummary, now: number): Shopper {
  const brand = agentBrand(s.agentName);
  const calls = s.toolCalls;
  const lastAt = calls.at(-1)?.at ?? s.startedAt;
  const missing = [...new Set(calls.flatMap((c) => c.missing ?? []))];
  let reach = 0;
  for (const c of calls) reach = Math.max(reach, TOOL_STAGE[c.tool] ?? 0);
  if (s.outcome === "purchased") reach = 4;
  const status: ShopperStatus =
    s.outcome === "purchased" ? "bought" : s.outcome === "abandoned" ? "left" : now - Date.parse(lastAt) < LIVE_MS ? "live" : "left";

  const steps: ShopperStep[] = calls.map((c, i) => {
    const miss = c.missing?.length ? `, no ${c.missing.map((m) => (FIELD_LABEL[m] ?? m).toLowerCase()).join(" or ")}` : "";
    return {
      t: clock(s.startedAt, c.at),
      text: agentStepText(c.tool, s, i === calls.length - 1) + miss,
      tool: c.tool,
      tone: !c.ok ? "fail" : c.missing?.length ? "warn" : status === "live" && i === calls.length - 1 ? "live" : "ok",
    };
  });

  // The key moment: where it bought, where data went missing before it left, or where it is now.
  const firstMissing = calls.find((c) => c.missing?.length);
  const failed = calls.find((c) => !c.ok);
  const keyCall = status === "bought" ? (calls.findLast((c) => c.tool === "checkout") ?? calls.at(-1)) : status === "left" ? (failed ?? firstMissing ?? calls.at(-1)) : calls.at(-1);
  const goal = s.goal;
  const rows: MockRow[] = [];
  if (goal?.size) rows.push({ k: `Size UK ${goal.size}`, v: calls.some((c) => c.tool === "check_availability" && c.ok) ? "In stock" : "Asked" });
  if (goal?.maxBudget) rows.push({ k: "Budget", v: money(goal.maxBudget) });
  if (goal?.deadlineDays) rows.push({ k: "Needs it in", v: `${goal.deadlineDays} day${goal.deadlineDays === 1 ? "" : "s"}` });
  for (const m of missing.slice(0, 2)) rows.push({ k: FIELD_LABEL[m] ?? m, v: "missing", tone: "bad" });
  if (status === "bought" && s.orderTotal) rows.push({ k: "Order total", v: money(s.orderTotal), tone: "good" });
  if (status === "live") rows.push({ k: "Status", v: "working", tone: "live" });
  const keyTool = keyCall?.tool ?? "search_products";
  const mockTitle =
    keyTool === "checkout" || keyTool === "add_to_cart" || keyTool === "get_cart"
      ? status === "bought"
        ? "Order confirmed"
        : "Your bag"
      : (CATEGORY[goal?.category ?? ""] ?? "Product page");

  const reason = s.reason ? s.reason.replace(/\s+—\s+/g, ": ") : undefined;
  let key: KeyMoment;
  if (status === "bought") {
    key = { tool: keyTool, pill: "Bought", tone: "won", text: s.orderTotal ? `Paid ${money(s.orderTotal)} and got an order number back.` : "Paid and got an order number back.", mockTitle, rows: rows.slice(-3) };
  } else if (status === "live") {
    key = { tool: keyTool, pill: "Working", tone: "live", text: `${steps.at(-1)?.text ?? "Shopping"} right now.`, mockTitle, rows: rows.slice(-3) };
  } else if (missing.length) {
    key = {
      tool: keyTool,
      pill: "Missing data",
      tone: "warn",
      text: `Asked for ${missing.map((m) => FIELD_WORDS[m] ?? m).join(" and ")}. The store didn’t say${s.outcome === "abandoned" ? ", so it left" : ""}.`,
      mockTitle,
      rows: rows.slice(-3),
    };
  } else {
    key = { tool: keyTool, pill: "Left", tone: "fail", text: reason ? `${capitalise(reason)}.` : "Stopped without buying.", mockTitle, rows: rows.slice(-3) };
  }

  const at = FUNNEL[Math.min(reach, 3)].toLowerCase();
  const sub =
    status === "bought"
      ? `Bought${s.orderTotal ? ` · ${money(s.orderTotal)}` : ""}`
      : status === "live"
        ? `${steps.at(-1)?.text ?? "Shopping"}`
        : missing.length
          ? `Left at ${at}: no ${(FIELD_LABEL[missing[0]] ?? missing[0]).toLowerCase()}`
          : reason
            ? `Left: ${reason}`
            : `Left at ${at}`;

  return {
    id: `a:${s.sessionId}`,
    kind: "agent",
    name: s.agentName,
    brand,
    mascot: brand.mascot,
    arm: armOf(s.variant),
    experimentId: s.experimentId,
    synthetic: s.synthetic,
    startedAt: s.startedAt,
    lastAt,
    status,
    reach,
    sub,
    outcome: status === "bought" ? `Bought${s.orderTotal ? ` · ${money(s.orderTotal)}` : ""}` : status === "live" ? "Still shopping" : "Left, no order",
    brief: goal?.brief,
    steps,
    key,
    model: brand.name,
    missing,
    reason,
    orderTotal: s.orderTotal,
  };
}

const EVENT_STAGE: Record<string, number> = {
  $pageview: 0,
  product_viewed: 1,
  product_added: 2,
  cart_viewed: 2,
  checkout_started: 3,
  shipping_cost_revealed: 3,
  checkout_step_completed: 3,
  checkout_abandoned: 3,
  order_completed: 4,
};

/** Events from the Darwin demo store (not a darwin.js site's simulated traffic). */
export function isStoreEvent(e: AnalyticsEvent): boolean {
  const p = e.properties;
  return typeof p.spec_version === "number" || String(p.$pathname ?? "").startsWith("/store");
}

function personName(e: AnalyticsEvent): string {
  const p = e.properties;
  if (typeof p.persona === "string" && p.persona && !p.persona.includes(":")) return p.persona;
  const id = e.distinct_id.replace(/^(sim_h_|v_|h_)/, "").slice(0, 4);
  return `${p.$device_type === "Mobile" ? "mobile" : "desktop"}-visitor-${id}`;
}

/** "/store/products/ridge-trail-pro" → "Opened Ridge Trail Pro". */
function landedText(path: unknown): string {
  const p = typeof path === "string" ? path.replace(/\/+$/, "") : "";
  const product = /\/products\/([^/?#]+)/.exec(p)?.[1];
  if (product) return `Opened ${productName(product) ?? capitalise(product.replace(/-/g, " "))}`;
  if (/\/(cart|bag)$/.test(p)) return "Opened the bag";
  if (/\/checkout/.test(p)) return "Reached checkout";
  if (/\/store$/.test(p) || !p) return "Landed on the home page";
  return `Landed on ${p}`;
}

/** One person's events (oldest first) → shopper. */
export function personShopper(id: string, events: AnalyticsEvent[], now: number): Shopper {
  const first = events[0];
  const last = events.at(-1) ?? first;
  const p0 = first.properties;
  let reach = 0;
  let product: string | undefined;
  let price: number | undefined;
  let shipping: number | undefined;
  let total: number | undefined;
  let revenue: number | undefined;
  for (const e of events) {
    reach = Math.max(reach, EVENT_STAGE[e.event] ?? 0);
    const p = e.properties;
    if (p.product_id) product = productName(p.product_id) ?? product;
    if (typeof p.price === "number") price = p.price;
    if (typeof p.shipping === "number") shipping = p.shipping;
    if (typeof p.value === "number") total = p.value;
    if (typeof p.revenue === "number") revenue = p.revenue;
  }
  const bought = events.some((e) => e.event === "order_completed");
  const abandoned = events.find((e) => e.event === "checkout_abandoned");
  const shock = events.find((e) => e.event === "shipping_cost_revealed");
  const rage = events.find((e) => e.event === "$rageclick");
  const leftPage = last.event === "$pageleave";
  const status: ShopperStatus = bought ? "bought" : abandoned || leftPage || now - Date.parse(last.timestamp) > LIVE_MS ? "left" : "live";

  const shown = events.filter((e) => e.event !== "$autocapture" && e.event !== "$pageleave");
  const steps: ShopperStep[] = shown.map((e, i) => {
    const row = describeEvent(e);
    return {
      t: clock(first.timestamp, e.timestamp),
      text: e.event === "$pageview" ? landedText(e.properties.$pathname) : capitalise(row.text),
      tool: e.event,
      tone: row.tone === "bad" ? "fail" : row.tone === "warn" ? "warn" : status === "live" && i === shown.length - 1 ? "live" : "ok",
    };
  });

  const rows: MockRow[] = [];
  // On a product page the product is the mock's title, so the row is its price.
  if (product) rows.push({ k: reach <= 1 ? "Price" : product, v: price ? money(price) : "viewed" });
  if (shock) rows.push({ k: "Delivery", v: shipping ? `+${money(shipping)}` : "added late", tone: "bad" });
  else if (reach >= 2) rows.push({ k: "Delivery", v: "shown in the bag", tone: "good" });
  if (abandoned) rows.push({ k: "Checkout", v: typeof abandoned.properties.reason === "string" ? String(abandoned.properties.reason) : "left", tone: "bad" });
  if (bought) rows.push({ k: "Paid", v: revenue ? money(revenue) : "yes", tone: "good" });
  else if (total && !abandoned) rows.push({ k: "Total", v: money(total) });

  const keyEvent = bought ? events.findLast((e) => e.event === "order_completed") : abandoned ?? shock ?? rage ?? shown.at(-1) ?? last;
  const tool = keyEvent?.event ?? "$pageview";
  const mockTitle = reach >= 3 ? (bought ? "Order confirmed" : "Checkout") : reach === 2 ? "Your bag" : (product ?? "Home page");
  const at = FUNNEL[Math.min(reach, 3)].toLowerCase();
  let key: KeyMoment;
  if (bought) key = { tool, pill: "Bought", tone: "won", text: `Bought ${product ?? "their order"}${revenue ? ` for ${money(revenue)}` : ""}.`, mockTitle, rows: rows.slice(-3) };
  else if (status === "live") key = { tool, pill: "Working", tone: "live", text: `${steps.at(-1)?.text ?? "Browsing"} right now.`, mockTitle, rows: rows.slice(-3) };
  else if (shock || rage) key = { tool, pill: shock ? "Surprise cost" : "Rage click", tone: "warn", text: `${capitalise(describeEvent(keyEvent ?? last).text)}, then left.`, mockTitle, rows: rows.slice(-3) };
  else key = { tool, pill: "Left", tone: "fail", text: abandoned ? `${capitalise(describeEvent(abandoned).text)}.` : `Left at the ${at === "visit" ? "home page" : at === "view" ? "product page" : at} without buying.`, mockTitle, rows: rows.slice(-3) };

  const device = typeof p0.$device_type === "string" ? p0.$device_type : "Desktop";
  return {
    id: `h:${id}`,
    kind: "human",
    name: personName(first),
    brand: agentBrand(undefined, "human"),
    // People are the pink drop (agents use their brand's crew member), buyers the green diamond.
    mascot: bought ? "shipper" : "experimenter",
    arm: armOf(typeof last.properties.variant === "string" ? last.properties.variant : undefined),
    experimentId: typeof last.properties.experiment_id === "string" ? last.properties.experiment_id : undefined,
    synthetic: Boolean(p0.synthetic),
    startedAt: first.timestamp,
    lastAt: last.timestamp,
    status,
    reach,
    sub: bought ? `Bought ${product ?? ""}`.trim() : status === "live" ? (steps.at(-1)?.text ?? "Browsing") : shock ? "Left after surprise shipping" : `Left at ${at === "visit" ? "the home page" : at === "view" ? "the product page" : at}`,
    outcome: bought ? `Bought${revenue ? ` · ${money(revenue)}` : ""}` : status === "live" ? "Still shopping" : "Left, no order",
    steps,
    key,
    model: device,
    missing: [],
    orderTotal: revenue,
    path: typeof p0.$pathname === "string" ? p0.$pathname : undefined,
  };
}

export function peopleFromEvents(events: AnalyticsEvent[] | undefined, now: number, max = 60): Shopper[] {
  const by = new Map<string, AnalyticsEvent[]>();
  for (const e of events ?? []) {
    if ((e.properties.visitor_kind ?? "human") !== "human" || !isStoreEvent(e)) continue;
    const list = by.get(e.distinct_id);
    if (list) list.push(e);
    else by.set(e.distinct_id, [e]);
  }
  const out: Shopper[] = [];
  for (const [id, list] of by) {
    list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    if (!list.some((e) => e.event !== "$autocapture" && e.event !== "$pageleave")) continue;
    out.push(personShopper(id, list, now));
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).slice(0, max);
}

/* ------------------------------------------------------------------ Darwin's read of a shopper */

export interface Linked {
  label: string;
  href: string;
}

function issueNumber(loop: LoopState, insight: Insight): number {
  return [...loop.insights].sort((a, b) => b.impactScore - a.impactScore).findIndex((i) => i.id === insight.id) + 1;
}

const HUMAN_STAGE = [/home|landing/i, /product/i, /cart|bag/i, /checkout|shipping/i];

/** The insight this shopper ran into, if Darwin has one. */
export function matchInsight(s: Shopper, loop: LoopState | undefined): Insight | undefined {
  if (!loop || s.status === "bought") return undefined;
  const insights = [...loop.insights].sort((a, b) => b.impactScore - a.impactScore);
  if (s.kind === "agent") {
    for (const m of s.missing) {
      const re = FIELD_ISSUE[m];
      const hit = re && insights.find((i) => i.audience !== "human" && re.test(i.title));
      if (hit) return hit;
    }
    if (s.reason) {
      const r = s.reason.toLowerCase();
      return insights.find((i) => i.audience !== "human" && ((/negotiat/.test(r) && /negotiat/i.test(i.title)) || (/budget|price|over the/.test(r) && /landed|price|budget/i.test(i.title))));
    }
    return undefined;
  }
  const re = HUMAN_STAGE[Math.min(s.reach, 3)];
  return insights.find((i) => i.audience !== "agent" && re.test(i.stage));
}

export function linkFor(s: Shopper, loop: LoopState | undefined, test: TestView | undefined): Linked | undefined {
  const insight = matchInsight(s, loop);
  if (insight && loop) {
    const short = insight.title.length > 44 ? `${insight.title.slice(0, 42).trimEnd()}…` : insight.title;
    return { label: `Issue ${issueNumber(loop, insight)} · ${short}`, href: `/console/issues?id=${encodeURIComponent(insight.id)}` };
  }
  if (test && s.experimentId === test.experiment.id && s.arm === "B") return { label: `Test B · ${test.experiment.name}`, href: "/console/experiments" };
  return undefined;
}

/** Does the running test change the thing this shopper was missing? */
function testFixes(s: Shopper, loop: LoopState | undefined, test: TestView | undefined): boolean {
  if (!test?.running || !loop?.proposal) return false;
  const diff = loop.proposal.diff.join(" ");
  return s.missing.some((m) => FIELD_SURFACE[m] && diff.includes(FIELD_SURFACE[m]));
}

/** One or two sentences: why this shopper matters, from real numbers. */
export function darwinNote(s: Shopper, ctx: { loop?: LoopState; test?: TestView; board: BoardRow[]; summary?: AnalyticsSummary }): string {
  const insight = matchInsight(s, ctx.loop);
  const fixes = testFixes(s, ctx.loop, ctx.test);
  if (s.kind === "agent") {
    const row = ctx.board.find((b) => b.brand.key === s.brand.key);
    const brandLine = row && row.shoppers >= 2 ? `${row.brand.name} agents bought on ${row.bought} of their last ${row.shoppers} visits.` : "";
    if (insight) return `${insight.title}.${fixes ? " Test B fixes this step." : ` It’s issue ${issueNumber(ctx.loop!, insight)} on Darwin’s list.`}`;
    if (s.status === "bought") return `${s.arm ? `Bought in ${s.arm === "B" ? "test B" : "A, the current store"}. ` : ""}${brandLine}`.trim() || "Bought first time, no data missing.";
    if (s.status === "live") return `Still shopping. ${brandLine}`.trim();
    return `${s.reason ? `It left because ${s.reason}.` : "It left without buying."} ${brandLine}`.trim();
  }
  const f = funnelSteps(ctx.summary);
  if (s.status === "bought") {
    const rate = ctx.summary?.byKind.human.conversionRate;
    return `${s.arm === "B" ? "Bought in test B. " : ""}${rate !== undefined ? `Only ${pctSmart(rate)} of people buy, so every order like this counts.` : ""}`.trim() || "Bought.";
  }
  const step = f[Math.min(Math.max(s.reach, 0), 3)];
  const moveOn = step?.people;
  const line = moveOn !== undefined ? `${pctSmart(1 - moveOn)} of people stop at ${step.label.toLowerCase()}.` : "";
  if (insight) return `${line} ${insight.title}.`.trim();
  return line || "Darwin is still learning from people like this.";
}
