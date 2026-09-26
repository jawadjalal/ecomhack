/**
 * Synthetic AI-shopper traffic.
 *
 * Each simulated agent gets a `ShoppingGoal` drawn from a goal mix and is run through
 * `runBuyerAgent` (agent-commerce module), which calls the real agent tools and tracks events.
 * Until that module is implemented (it returns `reason: "not implemented"`), `simulateAgentVisit`
 * below plays the same role with a transparent built-in policy, emitting equivalent events.
 *
 * Agent behaviour model (built-in policy)
 * ---------------------------------------
 * Agents are literal: they need specific fields to satisfy their principal's brief. When the store's
 * `agentSurface` hides a field an agent needs, it abandons with a reason — unless it is one of the
 * few "lenient" agents that proceed on assumptions (AGENT_LENIENCY). When the field IS exposed, the
 * agent checks the real catalog (delivery days, returns, stock, landed price), so some goals are
 * honestly unsatisfiable (e.g. trail shoes by tomorrow) and still abandon on a perfect surface.
 *
 *   goal            needs                 surface knob
 *   deadline        deliveryEtaDays       agentSurface.exposeDeliveryEta
 *   free-returns    returnPolicy          agentSurface.exposeReturnPolicy
 *   size-in-stock   sizes (+stock)        agentSurface.exposeStock
 *   landed-price    landedPrice           agentSurface.exposeLandedPrice
 *   negotiator      negotiate tool        agentSurface.negotiation
 *   web-browsing agents also need schema.org data   agentSurface.structuredData
 *
 * Two things the merchant does NOT control cap agent conversion well below 100%, as in real agentic
 * commerce: (1) the agent hands the cart to its principal (the human) to confirm, and many decline,
 * defer or buy elsewhere; brands differ in how often they run with pre-authorised spend
 * (AGENT_NAMES[].approval); (2) web-browsing agents misread pages without schema.org data
 * (WEB_PARSE_FAIL). `agentGate` applies both to the default driver (agent-commerce `runBuyerAgent`) too,
 * so every simulated agent visit is subject to the same hand-off.
 *
 * Calibration (default driver, measured by the scratch loop script, 1,500 agents): DEFAULT_SPEC
 * ~15–20% of agents buy; full agent surface ~48–53%; brands ~40–58% on the full surface.
 * Built-in policy (simulator.test.ts bands): DEFAULT_SPEC ~8–16%; full surface + negotiation ~38–52%.
 */
import type { AnalyticsEventInput, EventProperties, PageSpec, ShoppingGoal } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import { PROCEED_ANYWAY } from "@/lib/agent-commerce";
import { SHOE_SIZES, shippingFor } from "./behavior-model";
import { placeSession, type SimClock } from "./clock";
import { createRng, deriveSeed, type Rng } from "./rng";

/* ------------------------------------------------------------------ model constants */

export const AGENT_GOAL_KINDS = ["deadline", "free-returns", "size-in-stock", "landed-price", "negotiator"] as const;
export type AgentGoalKind = (typeof AGENT_GOAL_KINDS)[number];

/** Share of agent traffic per goal. */
export const AGENT_GOAL_MIX: Record<AgentGoalKind, number> = {
  deadline: 0.25,
  "free-returns": 0.15,
  "size-in-stock": 0.2,
  "landed-price": 0.2,
  negotiator: 0.2,
};

/**
 * Agent names, how they reach the store, their traffic share, and `approval`: P(the principal confirms
 * the purchase once the agent has found an item that meets the brief). Agents present the cart for
 * confirmation; principals decline, defer ("ask me tomorrow") or buy elsewhere after comparing. Brands
 * whose users more often pre-authorise spend check out more. This caps agent conversion around 50% on a
 * perfect store, whatever the merchant does, and makes brands differ for reasons outside the page.
 */
export const AGENT_NAMES: { name: string; channel: "mcp" | "rest" | "web"; share: number; approval: number }[] = [
  { name: "grok-shopper", channel: "mcp", share: 0.26, approval: 0.62 },
  { name: "gpt-shopping-agent", channel: "rest", share: 0.26, approval: 0.58 },
  { name: "claude-buyer", channel: "mcp", share: 0.2, approval: 0.66 },
  { name: "perplexity-shop", channel: "web", share: 0.16, approval: 0.56 },
  { name: "gemini-agent", channel: "web", share: 0.12, approval: 0.5 },
];

/** Fallback approval for an agent name not in AGENT_NAMES. */
export const AGENT_APPROVAL = 0.58;

export function agentApproval(agentName: string): number {
  return AGENT_NAMES.find((a) => a.name === agentName)?.approval ?? AGENT_APPROVAL;
}

export type AgentField = "deliveryEtaDays" | "returnPolicy" | "sizes" | "landedPrice";

/**
 * P(agent proceeds on an assumption when a field it needs is hidden). Low: agents are literal.
 * Mirrors the real buyer policy's `PROCEED_ANYWAY` (agent-commerce), so both drivers gamble alike.
 */
export const AGENT_LENIENCY: Record<AgentField, number> = {
  deliveryEtaDays: PROCEED_ANYWAY.deliveryEtaDays,
  returnPolicy: PROCEED_ANYWAY.returnPolicy,
  sizes: PROCEED_ANYWAY.stock,
  landedPrice: PROCEED_ANYWAY.landedPrice,
};

/** Human-readable abandon reasons for a hidden field. */
const HIDDEN_FIELD_REASON: Record<AgentField, string> = {
  deliveryEtaDays: "no delivery ETA exposed",
  returnPolicy: "no return policy exposed",
  sizes: "no per-size stock exposed",
  landedPrice: "no landed price (incl. shipping) exposed",
};

/** P(an agent also asks for a nice-to-have field it does not strictly need). Feeds `missing` stats. */
export const NICE_TO_HAVE_ASK = 0.3;

/** P(web-browsing agent fails to verify product attributes) without / with schema.org structured data. */
export const WEB_PARSE_FAIL = { without: 0.3, with: 0.02 };
/** API/MCP agents get structured JSON regardless; small residual failure rate. */
export const API_PARSE_FAIL = 0.03;

/** Why a principal did not confirm a cart the agent had built. */
export const DECLINE_REASONS = ["principal declined purchase", "found a better offer elsewhere", "principal asked to wait"] as const;

export const PARSE_FAIL_REASON = {
  without: "could not verify product attributes (no structured data)",
  with: "could not verify product attributes",
} as const;

/**
 * Outside-the-page outcomes for one agent visit, drawn from the visit's own seed before it sees the
 * store (so the same seed on two specs is the same agent and the same principal):
 *   - `parseFail`: set when the agent cannot read product data on this spec (web agents without
 *     structured data fail far more often). Applied after it opens a product.
 *   - `decline`: set when the principal will not confirm the cart. Applied at add-to-cart.
 */
export interface AgentGate {
  parseFail?: string;
  decline?: string;
}

export function agentGate(seed: number, who: { agentName: string; channel: "mcp" | "rest" | "web" }, spec: PageSpec): AgentGate {
  const r = createRng(seed);
  const uParse = r.next();
  const uApproval = r.next();
  const reason = DECLINE_REASONS[Math.floor(r.next() * DECLINE_REASONS.length)];
  const structured = spec.agentSurface.structuredData;
  const pParse = who.channel === "web" ? (structured ? WEB_PARSE_FAIL.with : WEB_PARSE_FAIL.without) : API_PARSE_FAIL;
  return {
    ...(uParse < pParse ? { parseFail: who.channel === "web" && !structured ? PARSE_FAIL_REASON.without : PARSE_FAIL_REASON.with } : {}),
    ...(uApproval < agentApproval(who.agentName) ? {} : { decline: reason }),
  };
}

/** Negotiators: P(buy at list price when the merchant can't negotiate). */
export const NEGOTIATOR_BUYS_AT_LIST = 0.4;

/* ------------------------------------------------------------------ goals */

export interface SimGoal extends ShoppingGoal {
  kind: AgentGoalKind;
  /** Negotiators walk away below this discount (percent), with some tolerance. */
  desiredDiscountPct?: number;
  /** Also needs per-size stock (secondary requirement). */
  needsStock: boolean;
}

const CATEGORY_LABEL: Record<Product["category"], string> = {
  road: "Road running shoes",
  trail: "Trail shoes",
  racing: "Carbon racing shoes",
  accessories: "Running accessories",
};

const DEADLINE_TEXT: Record<number, string> = { 1: "by tomorrow", 2: "within 2 days", 3: "by Friday", 5: "within a week" };

export function generateGoal(rng: Rng): SimGoal {
  const kind = rng.weighted(AGENT_GOAL_KINDS.map((k) => [k, AGENT_GOAL_MIX[k]] as const));
  const shoeCats: Product["category"][] = ["road", "trail", "racing"];
  const category: Product["category"] =
    kind === "size-in-stock"
      ? rng.weighted(shoeCats.map((c, i) => [c, [0.5, 0.3, 0.2][i]] as const))
      : rng.weighted([["road", 0.45], ["trail", 0.28], ["racing", 0.15], ["accessories", 0.12]] as const);
  const size = category === "accessories" ? undefined : rng.weighted(SHOE_SIZES);
  const label = CATEGORY_LABEL[category];
  const sizeText = size ? `, UK ${size}` : "";
  const needsStock = kind === "size-in-stock" || (size !== undefined && rng.chance(0.3));
  const inCat = PRODUCTS.filter((p) => p.category === category);

  switch (kind) {
    case "deadline": {
      const deadlineDays = rng.weighted([[1, 0.12], [2, 0.3], [3, 0.4], [5, 0.18]] as const);
      return { kind, needsStock, category, size, deadlineDays, brief: `${label}${sizeText}, delivered ${DEADLINE_TEXT[deadlineDays]}` };
    }
    case "free-returns":
      return { kind, needsStock, category, size, requiresFreeReturns: true, brief: `${label}${sizeText}, free returns only` };
    case "size-in-stock":
      return { kind, needsStock, category, size, brief: `${label} in UK ${size}, must be in stock now` };
    case "landed-price": {
      const ref = rng.pick(inCat);
      const maxBudget = Math.round((ref.price * rng.range(0.92, 1.25)) / 500) * 500;
      return { kind, needsStock, category, size, maxBudget, brief: `${label}${sizeText}, under £${maxBudget / 100} delivered` };
    }
    case "negotiator": {
      const desiredDiscountPct = Math.round(rng.range(4, 14));
      // A hard budget a little under list price (plus delivery): these buyers only convert if the
      // merchant will haggle, which is what makes `agentSurface.negotiation` worth testing.
      const ref = rng.pick(inCat);
      const maxBudget = Math.round((ref.price * (1 - desiredDiscountPct / 100) + SHIPPING_FEE) / 100) * 100;
      return {
        kind,
        needsStock,
        category,
        size,
        maxBudget,
        negotiates: true,
        desiredDiscountPct,
        brief: `${label}${sizeText}, best price, max £${maxBudget / 100} delivered`,
      };
    }
  }
}

/** The contract-level goal handed to `runBuyerAgent` (strips simulator-only fields). */
export function toShoppingGoal(g: SimGoal): ShoppingGoal {
  const { brief, category, maxBudget, size, deadlineDays, requiresFreeReturns, negotiates } = g;
  return { brief, category, maxBudget, size, deadlineDays, requiresFreeReturns, negotiates };
}

/* ------------------------------------------------------------------ built-in visit */

export interface AgentIdentity {
  agentId: string;
  agentName: string;
  channel: "mcp" | "rest" | "web";
  sessionId: string;
}

export interface AgentVisitResult {
  /** Events with ISO timestamps, in session order. */
  events: AnalyticsEventInput[];
  outcome: "purchased" | "abandoned";
  reason?: string;
  revenue: number;
}

const TOOL_PATH: Record<string, string> = {
  search_products: "/api/agent/products",
  get_product: "/api/agent/products/:id",
  check_availability: "/api/agent/products/:id",
  add_to_cart: "/api/agent/cart",
  negotiate: "/api/agent/negotiate",
  checkout: "/api/agent/checkout",
};

/**
 * Built-in buyer-agent policy (used only while `runBuyerAgent` is not implemented).
 * Emits the same event vocabulary the agent-commerce module uses: `agent_request` per tool call,
 * funnel events (`product_viewed`, `product_added`, `checkout_started`, `order_completed`),
 * `agent_negotiation` per turn and `agent_abandoned` with a reason.
 *
 * Like humans, each agent draws its latent propensities (leniency, approval, …) from its own seed
 * before seeing the store, so the same seed on two specs is the same agent.
 */
export function simulateAgentVisit(
  goal: SimGoal,
  who: AgentIdentity,
  spec: PageSpec,
  baseProps: EventProperties,
  seed: number,
  clock: SimClock,
): AgentVisitResult {
  const d = createRng(seed);
  const fx = createRng(deriveSeed(seed, 2));
  const u = {
    parse: d.next(),
    lenient: { deliveryEtaDays: d.next(), returnPolicy: d.next(), sizes: d.next(), landedPrice: d.next() } as Record<AgentField, number>,
    asks: { deliveryEtaDays: d.next(), returnPolicy: d.next(), sizes: d.next(), landedPrice: d.next() } as Record<AgentField, number>,
    inspect: d.int(1, 3),
    atList: d.next(),
    accept: d.next(),
    approval: d.next(),
  };
  const surface = spec.agentSurface;
  const events: AnalyticsEventInput[] = [];
  const offsets: number[] = [];
  let t = 0;

  const emit = (event: string, props: EventProperties = {}) => {
    events.push({ event, distinct_id: who.agentId, properties: { ...baseProps, ...props } });
    offsets.push(Math.round(t));
    t += fx.duration(900, 1.8); // model latency between calls
  };
  const finish = (r: Omit<AgentVisitResult, "events">): AgentVisitResult => {
    const stamps = placeSession(offsets, fx, clock);
    events.forEach((e, i) => (e.timestamp = stamps[i]));
    return { events, ...r };
  };
  const request = (tool: string, props: EventProperties = {}) =>
    emit("agent_request", {
      tool,
      ok: true,
      channel: who.channel,
      $pathname: who.channel === "mcp" ? "/api/mcp" : TOOL_PATH[tool],
      ...props,
    });
  const abandon = (reason: string, missing?: string[]): AgentVisitResult => {
    emit("agent_abandoned", { reason, goal: goal.brief, ...(missing?.length ? { missing } : {}) });
    return finish({ outcome: "abandoned", reason, revenue: 0 });
  };

  /* 1. search */
  const candidates = PRODUCTS.filter((p) => p.category === goal.category);
  request("search_products", { query: goal.brief, category: goal.category, results: candidates.length });

  /* 2. inspect the top candidates */
  const exposed: Record<AgentField, boolean> = {
    deliveryEtaDays: surface.exposeDeliveryEta,
    returnPolicy: surface.exposeReturnPolicy,
    sizes: surface.exposeStock,
    landedPrice: surface.exposeLandedPrice,
  };
  const needs: AgentField[] = [];
  if (goal.deadlineDays !== undefined) needs.push("deliveryEtaDays");
  if (goal.requiresFreeReturns) needs.push("returnPolicy");
  if (goal.needsStock) needs.push("sizes");
  if (goal.maxBudget !== undefined) needs.push("landedPrice");
  const asks = new Set<AgentField>(needs);
  for (const f of Object.keys(exposed) as AgentField[]) if (u.asks[f] < NICE_TO_HAVE_ASK) asks.add(f);
  const missing = [...asks].filter((f) => !exposed[f]);

  const ranked = [...candidates].sort((a, b) => b.rating - a.rating || a.price - b.price);
  const inspected = ranked.slice(0, Math.min(ranked.length, u.inspect));
  for (const p of inspected) {
    request("get_product", { product_id: p.id, ...(missing.length ? { missing } : {}) });
    emit("product_viewed", { product_id: p.id, price: p.price, name: p.name, category: p.category });
  }

  /* 3. can it read the product data at all? */
  const parseFail =
    who.channel === "web" ? (surface.structuredData ? WEB_PARSE_FAIL.with : WEB_PARSE_FAIL.without) : API_PARSE_FAIL;
  if (u.parse < parseFail) {
    return abandon(
      who.channel === "web" && !surface.structuredData ? PARSE_FAIL_REASON.without : PARSE_FAIL_REASON.with,
      who.channel === "web" && !surface.structuredData ? ["structuredData"] : undefined,
    );
  }

  /* 4. required fields hidden → abandon unless lenient */
  const assumed = new Set<AgentField>();
  for (const f of needs) {
    if (exposed[f]) continue;
    if (!(u.lenient[f] < AGENT_LENIENCY[f])) return abandon(HIDDEN_FIELD_REASON[f], [f]);
    assumed.add(f);
  }

  /* 5. filter the category on the facts the store exposed */
  const sizeFor = (p: Product) => goal.size ?? Object.keys(p.stock).find((k) => p.stock[k] > 0) ?? "One size";
  const landed = (p: Product) => p.price + shippingFor(spec, p.price);
  let pool = [...ranked];
  if (goal.deadlineDays !== undefined && exposed.deliveryEtaDays) {
    pool = pool.filter((p) => p.deliveryDays <= goal.deadlineDays!);
    if (!pool.length) {
      const fastest = Math.min(...candidates.map((p) => p.deliveryDays));
      return abandon(`nothing arrives in ${goal.deadlineDays} day(s) (fastest: ${fastest})`);
    }
  }
  if (goal.requiresFreeReturns && exposed.returnPolicy) {
    pool = pool.filter((p) => p.freeReturns);
    if (!pool.length) return abandon("no free-returns option in this category");
  }
  if (goal.needsStock && exposed.sizes) {
    request("check_availability", { product_id: pool[0].id, size: sizeFor(pool[0]) });
    pool = pool.filter((p) => (p.stock[sizeFor(p)] ?? 0) > 0);
    if (!pool.length) return abandon(`UK ${goal.size} out of stock`);
  } else if (goal.needsStock) {
    request("check_availability", { product_id: pool[0].id, size: sizeFor(pool[0]), missing: ["sizes"] });
  }
  if (goal.maxBudget !== undefined) {
    // Without a landed price the agent guesses shipping at the standard UK fee.
    pool = pool.filter((p) => (exposed.landedPrice ? landed(p) : p.price + 495) <= goal.maxBudget!);
    if (!pool.length) return abandon(`over budget after shipping (max £${goal.maxBudget / 100})`);
  }
  const product = pool[0];

  /* 6. negotiate */
  let discountPct = 0;
  if (goal.negotiates) {
    if (!surface.negotiation.enabled) {
      request("negotiate", { product_id: product.id, ok: false, error: "negotiation not supported", missing: ["negotiation"] });
      if (!(u.atList < NEGOTIATOR_BUYS_AT_LIST)) return abandon("merchant does not negotiate", ["negotiation"]);
    } else {
      const desired = goal.desiredDiscountPct ?? 8;
      const room = Math.max(0, Math.min(surface.negotiation.maxDiscountPct, ((product.price - product.floorPrice) / product.price) * 100));
      const ask = Math.round(desired * 1.6);
      const counter = Math.floor(room / 2);
      const final = Math.floor(Math.min(room, desired));
      const offer = (pct: number) => Math.round(product.price * (1 - pct / 100));
      request("negotiate", { product_id: product.id });
      emit("agent_negotiation", { product_id: product.id, round: 1, from: "buyer", discount_pct: ask, offer: offer(ask) });
      emit("agent_negotiation", { product_id: product.id, round: 1, from: "merchant", discount_pct: counter, offer: offer(counter) });
      request("negotiate", { product_id: product.id });
      emit("agent_negotiation", { product_id: product.id, round: 2, from: "buyer", discount_pct: desired, offer: offer(desired) });
      emit("agent_negotiation", { product_id: product.id, round: 2, from: "merchant", discount_pct: final, offer: offer(final) });
      const accept = final >= desired ? 0.95 : 0.3 + 0.5 * (final / desired);
      if (!(u.accept < accept)) return abandon(`discount too small (${final}% offered, wanted ${desired}%)`);
      discountPct = final;
    }
  }

  /* 7. principal approval (per brand, see AGENT_NAMES) */
  if (!(u.approval < agentApproval(who.agentName))) {
    return abandon(fx.pick([...DECLINE_REASONS]));
  }

  /* 8. cart + checkout (blind assumptions can still fail here) */
  const price = Math.round(product.price * (1 - discountPct / 100));
  const size = sizeFor(product);
  const inStockNow = (product.stock[size] ?? 0) > 0;
  if (!inStockNow) {
    request("add_to_cart", { product_id: product.id, size, ok: false, error: "size out of stock" });
    return abandon(`size ${size} out of stock at add to cart`);
  }
  request("add_to_cart", { product_id: product.id, size, quantity: 1 });
  emit("product_added", { product_id: product.id, price, quantity: 1, size, discount_pct: discountPct || undefined });
  const shipping = shippingFor(spec, price);
  request("checkout", {});
  emit("checkout_started", { subtotal: price, items: 1 });
  const revenue = price + shipping;
  emit("order_completed", {
    order_id: `ord_${fx.token(10)}`,
    revenue,
    subtotal: price,
    shipping,
    items: 1,
    product_id: product.id,
    price,
    quantity: 1,
    discount_pct: discountPct || undefined,
    assumed: assumed.size ? [...assumed] : undefined,
  });
  return finish({ outcome: "purchased", revenue });
}
