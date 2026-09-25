/**
 * callAgentTool: the single entry point for REST, MCP and in-process (simulated) shoppers.
 *
 * Every call:
 *   1. resolves the PageSpec this agent sees (experiment-aware, sticky on agentId),
 *   2. validates args and runs the tool against the catalog, shaped by `spec.agentSurface`,
 *   3. tracks an `agent_request` event (+ funnel events) with full attribution,
 *   4. updates the agent's session summary (tool calls, negotiation, outcome).
 */
import { z } from "zod";
import type { AgentSessionSummary, AnalyticsEventInput, EventProperties, NegotiationTurn, PageSpec } from "@/lib/contracts";
import { track } from "@/lib/analytics/store";
import { attributionProps, resolveSpecForVisitor, type ResolvedSpec } from "@/lib/spec/resolve";
import { id } from "@/lib/ids";
import { formatGBP } from "@/lib/money";
import type { Product } from "@/lib/catalog/products";
import { negotiateRound, phraseMerchantMessage } from "./negotiation";
import { appendNegotiation, getCommerceState, saveCommerceState, upsertAgentSession, type SessionCommerceState } from "./state";
import {
  findProduct,
  missingFields,
  normaliseMoney,
  normaliseSize,
  searchCatalog,
  shippingFor,
  toAgentProduct,
  toAgentProductDetail,
} from "./surface";
import { TOOL_SCHEMAS, type ToolArgs } from "./tools";
import type {
  AgentContext,
  AgentOrder,
  AgentToolName,
  AgentToolResult,
  AvailabilityView,
  CartView,
  NegotiationOutcome,
} from "./types";

interface ToolEnv {
  ctx: AgentContext;
  resolved: ResolvedSpec;
  spec: PageSpec;
  now: string;
}

interface HandlerOutput {
  result: AgentToolResult;
  /** Extra funnel events (base attribution props are added by the dispatcher). */
  events?: { event: string; properties: EventProperties }[];
  productId?: string;
  /** Extra session-summary updates (outcome, negotiation transcript…). */
  session?: (s: AgentSessionSummary) => void;
}

type Handler<T extends AgentToolName> = (args: ToolArgs<T>, env: ToolEnv) => HandlerOutput | Promise<HandlerOutput>;

/* ------------------------------------------------------------------ helpers */

const fail = (code: AgentToolResult["code"], error: string, extra: Partial<AgentToolResult> = {}): HandlerOutput => ({
  result: { ok: false, code, error, ...extra },
});

function notFound(ref: string): HandlerOutput {
  return fail("not_found", `No product "${ref}". Use search_products to find product ids.`);
}

function sizeList(p: Product) {
  return Object.keys(p.stock).join(", ");
}

function cartView(state: SessionCommerceState, spec: PageSpec): CartView {
  const subtotal = state.cart.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const view: CartView = { items: state.cart, subtotal, currency: "GBP" };
  if (spec.agentSurface.exposeLandedPrice) {
    view.shipping = state.cart.length ? shippingFor(subtotal, spec) : 0;
    view.total = subtotal + view.shipping;
  } else if (state.cart.length) {
    view.note = "Shipping is calculated at checkout.";
  }
  return view;
}

/* ------------------------------------------------------------------ handlers */

const handlers: { [T in AgentToolName]: Handler<T> } = {
  search_products(args, { spec }) {
    const products = searchCatalog({
      query: args.query,
      category: args.category,
      maxPrice: args.maxPrice !== undefined ? normaliseMoney(args.maxPrice) : undefined,
      size: args.size !== undefined ? String(args.size) : undefined,
      terrain: args.terrain,
    }).map((p) => toAgentProduct(p, spec));
    const missing = missingFields(spec, args.want);
    return { result: { ok: true, data: products, ...(missing.length ? { missing } : {}) } };
  },

  get_product(args, { spec }) {
    const p = findProduct(args.id);
    if (!p) return notFound(args.id);
    const missing = missingFields(spec, args.want);
    return {
      result: { ok: true, data: toAgentProductDetail(p, spec), ...(missing.length ? { missing } : {}) },
      productId: p.id,
      events: [{ event: "product_viewed", properties: { product_id: p.id, price: p.price } }],
    };
  },

  check_availability(args, { spec }) {
    const p = findProduct(args.id);
    if (!p) return notFound(args.id);
    if (!spec.agentSurface.exposeStock) {
      return {
        ...fail("not_exposed", "This store does not expose stock levels to agents. add_to_cart will fail if the size is sold out.", {
          missing: ["stock"],
        }),
        productId: p.id,
      };
    }
    const size = normaliseSize(String(args.size), p)!;
    if (!(size in p.stock)) return { ...fail("invalid_args", `${p.name} has no size "${args.size}". Sizes: ${sizeList(p)}.`), productId: p.id };
    const quantity = p.stock[size];
    const data: AvailabilityView = {
      productId: p.id,
      size,
      inStock: quantity > 0,
      quantity,
      ...(spec.agentSurface.exposeDeliveryEta ? { deliveryEtaDays: p.deliveryDays } : {}),
    };
    return { result: { ok: true, data }, productId: p.id };
  },

  add_to_cart(args, { ctx, spec }) {
    const p = findProduct(args.id);
    if (!p) return notFound(args.id);
    const sizes = Object.keys(p.stock);
    const size = args.size !== undefined ? normaliseSize(String(args.size), p) : sizes.length === 1 ? sizes[0] : undefined;
    if (!size) return { ...fail("invalid_args", `size is required for ${p.name}. Sizes: ${sizeList(p)}.`), productId: p.id };
    if (!(size in p.stock)) return { ...fail("invalid_args", `${p.name} has no size "${args.size}". Sizes: ${sizeList(p)}.`), productId: p.id };

    const state = getCommerceState(ctx.sessionId);
    const existing = state.cart.find((l) => l.productId === p.id && l.size === size);
    const quantity = args.quantity;
    if (p.stock[size] < quantity + (existing?.quantity ?? 0)) {
      return { ...fail("out_of_stock", `${p.name} in size ${size} is out of stock.`), productId: p.id };
    }
    const unitPrice = state.deals[p.id] ?? p.price;
    if (existing) {
      existing.quantity += quantity;
      existing.unitPrice = unitPrice;
    } else {
      state.cart.push({ productId: p.id, name: p.name, size, quantity, unitPrice, listPrice: p.price });
    }
    saveCommerceState(ctx.sessionId, { ...state, updatedAt: new Date().toISOString() });
    return {
      result: { ok: true, data: cartView(state, spec) },
      productId: p.id,
      events: [{ event: "product_added", properties: { product_id: p.id, price: unitPrice, quantity, size } }],
    };
  },

  get_cart(_args, { ctx, spec }) {
    return { result: { ok: true, data: cartView(getCommerceState(ctx.sessionId), spec) } };
  },

  async negotiate(args, { ctx, spec }) {
    const p = findProduct(args.id);
    if (!p) return notFound(args.id);
    if (!spec.agentSurface.negotiation.enabled) {
      return {
        ...fail("not_exposed", `This store does not negotiate. ${p.name} is ${formatGBP(p.price)}.`, { missing: ["negotiation"] }),
        productId: p.id,
      };
    }
    const offer = normaliseMoney(args.offer);
    const state = getCommerceState(ctx.sessionId);
    const round = negotiateRound(p, offer, state.negotiations[p.id] ?? { round: 0 }, spec.agentSurface.negotiation.maxDiscountPct);
    const outcome: NegotiationOutcome = { ...round.outcome };
    outcome.message = await phraseMerchantMessage(outcome, p, args.message);

    state.negotiations[p.id] = round.state;
    if (outcome.status === "accepted" && outcome.agreedPrice !== undefined) {
      state.deals[p.id] = outcome.agreedPrice;
      for (const line of state.cart) if (line.productId === p.id) line.unitPrice = outcome.agreedPrice;
      if (outcome.bundle) {
        const b = outcome.bundle;
        state.deals[b.productId] = Math.min(state.deals[b.productId] ?? b.price, b.price);
        for (const line of state.cart) if (line.productId === b.productId) line.unitPrice = state.deals[b.productId];
      }
    }
    saveCommerceState(ctx.sessionId, { ...state, updatedAt: new Date().toISOString() });

    const turns: NegotiationTurn[] = [
      { from: "buyer", message: args.message?.trim() || `Offer ${formatGBP(offer)} for ${p.name}.`, offer },
      { from: "merchant", message: outcome.message, offer: outcome.agreedPrice ?? outcome.counterOffer },
    ];
    return {
      result: { ok: true, data: outcome },
      productId: p.id,
      events: [
        {
          event: "agent_negotiation",
          properties: {
            product_id: p.id,
            price: p.price,
            offer,
            status: outcome.status,
            round: outcome.round,
            ...(outcome.counterOffer !== undefined ? { counter_offer: outcome.counterOffer } : {}),
            ...(outcome.agreedPrice !== undefined
              ? { agreed_price: outcome.agreedPrice, discount_pct: Math.round((1 - outcome.agreedPrice / p.price) * 1000) / 10 }
              : {}),
          },
        },
      ],
      session: (s) => appendNegotiation(s, turns),
    };
  },

  checkout(args, { ctx, spec, now }) {
    const state = getCommerceState(ctx.sessionId);
    if (!state.cart.length) return fail("empty_cart", "Your cart is empty. Call add_to_cart first.");
    const items = state.cart.map((l) => ({ ...l, unitPrice: Math.min(l.unitPrice, state.deals[l.productId] ?? l.unitPrice) }));
    const subtotal = items.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    const listSubtotal = items.reduce((n, l) => n + l.listPrice * l.quantity, 0);
    const shipping = shippingFor(subtotal, spec);
    const total = subtotal + shipping;
    const quantity = items.reduce((n, l) => n + l.quantity, 0);
    const started = { event: "checkout_started", properties: { value: total, quantity, product_id: items[0].productId } };

    const maxTotal = args.maxTotal !== undefined ? normaliseMoney(args.maxTotal) : undefined;
    if (maxTotal !== undefined && total > maxTotal) {
      return {
        result: {
          ok: false,
          code: "over_budget",
          error: `Order total ${formatGBP(total)} (incl. ${formatGBP(shipping)} shipping) is above your maxTotal of ${formatGBP(maxTotal)}. Nothing was charged.`,
          data: { subtotal, shipping, total, currency: "GBP" },
        },
        productId: items[0].productId,
        events: [started],
      };
    }

    const order: AgentOrder = {
      orderId: id("ord"),
      items,
      subtotal,
      discount: listSubtotal - subtotal,
      shipping,
      total,
      currency: "GBP",
      deliveryEtaDays: Math.max(...items.map((l) => findProduct(l.productId)?.deliveryDays ?? 3)),
      createdAt: now,
    };
    for (const l of items) {
      delete state.deals[l.productId];
      delete state.negotiations[l.productId];
    }
    saveCommerceState(ctx.sessionId, {
      ...state,
      cart: [],
      orders: [...state.orders, order].slice(-5),
      updatedAt: new Date().toISOString(),
    });
    return {
      result: { ok: true, data: order },
      productId: items[0].productId,
      events: [
        started,
        {
          event: "order_completed",
          properties: {
            order_id: order.orderId,
            revenue: total,
            subtotal,
            shipping,
            discount: order.discount,
            quantity,
            product_id: items[0].productId,
            product_ids: items.map((l) => l.productId),
          },
        },
      ],
      session: (s) => {
        s.outcome = "purchased";
        s.reason = undefined;
        s.orderTotal = (s.orderTotal ?? 0) + total;
      },
    };
  },

  abandon(args) {
    const reason = args.reason.trim();
    return {
      result: { ok: true, data: { acknowledged: true, message: "Thanks. We've logged why you're leaving so we can fix it." } },
      events: [{ event: "agent_abandoned", properties: { reason } }],
      session: (s) => {
        if (s.outcome === "purchased") return;
        s.outcome = "abandoned";
        s.reason = reason;
      },
    };
  },
};

/* ------------------------------------------------------------------ dispatcher */

function isToolName(tool: string): tool is AgentToolName {
  return Object.prototype.hasOwnProperty.call(handlers, tool);
}

/** Accept `want: "a,b"` from query strings as well as arrays. */
function preprocessArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.want === "string") return { ...args, want: args.want.split(",").map((s) => s.trim()).filter(Boolean) };
  return args;
}

async function runTool(tool: string, rawArgs: Record<string, unknown>, env: ToolEnv): Promise<HandlerOutput> {
  if (!isToolName(tool)) {
    return fail("unknown_tool", `Unknown tool "${tool}". Available: ${Object.keys(handlers).join(", ")}.`);
  }
  const parsed = TOOL_SCHEMAS[tool].safeParse(preprocessArgs(rawArgs));
  if (!parsed.success) return fail("invalid_args", `Invalid arguments for ${tool}: ${z.prettifyError(parsed.error)}`);
  try {
    return await (handlers[tool] as Handler<typeof tool>)(parsed.data as never, env);
  } catch (err) {
    console.error(`[agent-commerce] ${tool} failed`, err);
    return fail(undefined, `Internal error in ${tool}.`);
  }
}

export function baseEventProps(ctx: AgentContext, resolved: ResolvedSpec): EventProperties {
  return {
    visitor_kind: "agent",
    agent_name: ctx.agentName,
    $session_id: ctx.sessionId,
    synthetic: ctx.synthetic ?? false,
    ...(ctx.persona ? { persona: ctx.persona } : {}),
    channel: ctx.channel ?? "in-process",
    ...attributionProps(resolved),
  };
}

export function newSessionSummary(ctx: AgentContext, resolved: ResolvedSpec, now: string): AgentSessionSummary {
  return {
    sessionId: ctx.sessionId,
    agentName: ctx.agentName,
    startedAt: now,
    outcome: "in_progress",
    toolCalls: [],
    synthetic: ctx.synthetic ?? false,
    ...(resolved.experimentId ? { experimentId: resolved.experimentId, variant: resolved.variant } : {}),
  };
}

export async function dispatchAgentTool(
  tool: AgentToolName,
  args: Record<string, unknown> | undefined | null,
  ctx: AgentContext,
): Promise<AgentToolResult> {
  const now = ctx.now?.() ?? new Date().toISOString();
  const resolved = resolveSpecForVisitor(ctx.agentId);
  const env: ToolEnv = { ctx, resolved, spec: resolved.spec, now };
  const out = await runTool(String(tool), args && typeof args === "object" ? args : {}, env);
  const { result } = out;
  const toolLabel = String(tool).slice(0, 64);

  const base = baseEventProps(ctx, resolved);
  const events: AnalyticsEventInput[] = [
    {
      event: "agent_request",
      distinct_id: ctx.agentId,
      timestamp: now,
      properties: {
        ...base,
        tool: toolLabel,
        ok: result.ok,
        missing: result.missing ?? [],
        ...(result.error ? { error: result.error } : {}),
        ...(result.code ? { error_code: result.code } : {}),
        ...(out.productId ? { product_id: out.productId } : {}),
      },
    },
    ...(out.events ?? []).map((e) => ({
      event: e.event,
      distinct_id: ctx.agentId,
      timestamp: now,
      properties: { ...base, ...e.properties },
    })),
  ];
  track(events);

  upsertAgentSession(
    ctx.sessionId,
    () => newSessionSummary(ctx, resolved, now),
    (s) => {
      s.toolCalls.push({ tool: toolLabel, ok: result.ok, ...(result.missing?.length ? { missing: result.missing } : {}), at: now });
      if (resolved.experimentId) {
        s.experimentId = resolved.experimentId;
        s.variant = resolved.variant;
      }
      out.session?.(s);
    },
  );
  return result;
}
