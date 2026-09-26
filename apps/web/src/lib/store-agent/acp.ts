/**
 * ACP (Agentic Commerce Protocol, OpenAI + Stripe "Instant Checkout") merchant endpoints for the Whop store:
 * a faithful subset of the checkout-session API, so any ACP buyer agent can check out, not just chat.
 *
 *   POST /acp/checkout_sessions               create   { items: [{ id, quantity }], buyer? } → 201 CheckoutSession
 *   GET  /acp/checkout_sessions/:id           retrieve                                     → 200
 *   POST /acp/checkout_sessions/:id           update   { items?, buyer? }                   → 200
 *   POST /acp/checkout_sessions/:id/complete  complete { buyer?, payment_data? }           → 200
 *   POST /acp/checkout_sessions/:id/cancel    cancel                                       → 200 (405 once completed/canceled)
 *
 * Items are Whop plan ids from the catalog; amounts are minor units; goods are digital (memberships,
 * downloads), so there are no fulfillment options. Errors are ACP-style { type, code, message, param }.
 *
 * Payment, honestly: Darwin can't charge a delegated card token on the merchant's Whop account, so
 *   - demo catalog → complete records the same labelled, simulated payment the demo checkout page does,
 *     and the session is "completed" with an order;
 *   - real Whop    → complete answers "in_progress" with a `payment` link: a Whop checkout tagged with this
 *     session (metadata darwin_ref), so the Whop webhook credits it. Retrieving the session once that
 *     payment has arrived shows "completed".
 * The session id is the conversation's darwin_ref and the events are the chat's (agent_conversation_started,
 * product_viewed, checkout_started, then order_completed) with channel "acp", so the agent funnel counts it.
 */
import { createHash } from "node:crypto";
import type { AnalyticsEventInput } from "@/lib/contracts";
import { eventStore, track } from "@/lib/analytics/store";
import { allowIngest } from "@/lib/analytics/trust";
import { kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import { id } from "@/lib/ids";
import { STORE_SITE } from "./agent";
import { createCheckout, formatPrice, getCatalog, type Catalog, type Offer } from "./catalog";
import { recordDemoPayment } from "./index";

export const ACP_API_VERSION = "2025-09-29";
const MAX_SESSIONS = 2000;
const MAX_IDEMPOTENCY = 2000;
const MAX_ITEMS = 20;
const MAX_QUANTITY = 10;
const SESSIONS_KEY = "store-agent-acp-sessions";
const IDEMPOTENCY_KEY = "store-agent-acp-idempotency";
const REF = /^[\w-]{4,80}$/;

/* ------------------------------------------------------------------ ACP shapes */

export type AcpStatus = "not_ready_for_payment" | "ready_for_payment" | "in_progress" | "completed" | "canceled";
/** Where the session came from: an ACP client, or the store's MCP tools (create_checkout). */
export type AcpChannel = "acp" | "mcp";

export interface AcpBuyer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

export interface AcpLineItem {
  id: string;
  item: { id: string; quantity: number };
  base_amount: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface AcpTotal {
  type: "items_base_amount" | "items_discount" | "subtotal" | "discount" | "fulfillment" | "tax" | "fee" | "total";
  display_text: string;
  amount: number;
}

export type AcpMessage =
  | { type: "info"; param?: string; content_type: "plain"; content: string }
  | { type: "error"; code: "missing" | "invalid" | "out_of_stock" | "payment_declined" | "requires_sign_in" | "requires_3ds"; param?: string; content_type: "plain"; content: string };

export interface AcpLink {
  type: "terms_of_use" | "privacy_policy" | "seller_shop_policies" | "payment";
  url: string;
}

export interface AcpOrder {
  id: string;
  checkout_session_id: string;
  permalink_url: string;
}

export interface CheckoutSession {
  id: string;
  buyer?: AcpBuyer;
  payment_provider: { provider: string; supported_payment_methods: string[] };
  status: AcpStatus;
  currency: string;
  line_items: AcpLineItem[];
  fulfillment_options: never[];
  totals: AcpTotal[];
  messages: AcpMessage[];
  links: AcpLink[];
  order?: AcpOrder;
}

export interface AcpError {
  type: "invalid_request" | "request_not_idempotent" | "processing_error" | "service_unavailable";
  code: string;
  message: string;
  param?: string;
}

export interface AcpResult {
  status: number;
  body: CheckoutSession | AcpError;
}

/** Who is checking out. `ref` (MCP) ties the session to an existing conversation; else the session id is the ref. */
export interface AcpContext {
  origin: string;
  agentName?: string;
  channel?: AcpChannel;
  ref?: string;
  synthetic?: boolean;
}

/* ------------------------------------------------------------------ storage */

interface StoredItem {
  id: string;
  quantity: number;
  title: string;
  price: number;
  currency: string;
  billing: string;
}

interface StoredSession {
  id: string;
  /** darwin_ref: what events, checkout metadata and payments are keyed by. */
  ref: string;
  channel: AcpChannel;
  agentName: string;
  synthetic: boolean;
  origin: string;
  source: Catalog["source"];
  status: AcpStatus;
  items: StoredItem[];
  buyer?: AcpBuyer;
  /** Payment links, once payment has started (one per line item: a Whop checkout sells one plan). */
  payment?: { offerId: string; url: string; tagged: boolean }[];
  order?: AcpOrder;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

type SessionMap = Record<string, StoredSession>;

function load(sessionId: string): StoredSession | undefined {
  if (!REF.test(sessionId)) return undefined;
  const s = kvGet<SessionMap>(SESSIONS_KEY, () => ({}))[sessionId];
  return s ? structuredClone(s) : undefined;
}

function save(s: StoredSession) {
  s.updatedAt = new Date().toISOString();
  kvUpdate<SessionMap>(SESSIONS_KEY, () => ({}), (all) => {
    all[s.id] = s;
    const keys = Object.keys(all);
    for (let i = 0; i < keys.length - MAX_SESSIONS; i++) delete all[keys[i]];
    return all;
  });
}

export function resetAcp() {
  kvSet<SessionMap>(SESSIONS_KEY, {});
  kvSet<Record<string, unknown>>(IDEMPOTENCY_KEY, {});
  started().clear();
}

/* ------------------------------------------------------------------ events */

export interface Conversation {
  ref: string;
  channel: AcpChannel;
  agentName: string;
  synthetic: boolean;
}

const g = globalThis as unknown as { __darwinAcpStarted?: Set<string> };
const started = () => (g.__darwinAcpStarted ??= new Set());

/** An event on the store agent's funnel, shaped like the chat's (lib/store-agent/agent.ts). */
export function conversationEvent(name: string, c: Conversation, props: Record<string, unknown> = {}): AnalyticsEventInput {
  return {
    event: name,
    distinct_id: `agent_${c.ref}`,
    properties: { darwin_site: STORE_SITE, visitor_kind: "agent", agent_name: c.agentName, darwin_ref: c.ref, channel: c.channel, synthetic: c.synthetic, ...props },
  };
}

/** agent_conversation_started, once per conversation ref (ACP session or MCP session). */
export function startConversation(c: Conversation): AnalyticsEventInput[] {
  const set = started();
  if (set.has(c.ref)) return [];
  set.add(c.ref);
  if (set.size > 5000) set.delete(set.values().next().value!);
  return [conversationEvent("agent_conversation_started", c)];
}

const conv = (s: StoredSession): Conversation => ({ ref: s.ref, channel: s.channel, agentName: s.agentName, synthetic: s.synthetic });

/** Who the buyer agent is: X-Agent-Name, then what the body says (metadata / buyer agent_name), then the user agent. */
export function agentNameFrom(headers: Headers, declared?: string): string {
  const named = headers.get("x-agent-name")?.trim() || declared?.trim();
  if (named) return named.slice(0, 60);
  const ua = headers.get("user-agent") ?? "";
  const known = ua.match(/\b(ChatGPT-User|ChatGPT|OAI-SearchBot|OpenAI|Claude-User|Claude|Anthropic|Perplexity-User|Perplexity|Grok|xAI|Gemini|Operator|curl|python-requests|python-httpx|axios|node-fetch|undici|Go-http-client)\b/i);
  if (known) return known[1];
  return ua.split(/[\s/]/)[0]?.slice(0, 60) || "unknown-agent";
}

/* ------------------------------------------------------------------ helpers */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const acpError = (type: AcpError["type"], code: string, message: string, param?: string): AcpError => ({ type, code, message, ...(param ? { param } : {}) });
const invalid = (code: string, message: string, param?: string): AcpResult => ({ status: 400, body: acpError("invalid_request", code, message, param) });
const notFound = (sessionId: string): AcpResult => ({ status: 404, body: acpError("invalid_request", "not_found", `No checkout session ${sessionId}.`, "id") });
const notModifiable = (s: StoredSession): AcpResult => ({ status: 405, body: acpError("invalid_request", "invalid_state", `Checkout session ${s.id} is ${s.status} and can't be changed.`, "id") });
const info = (content: string, param?: string): AcpMessage => ({ type: "info", ...(param ? { param } : {}), content_type: "plain", content });
const permalink = (s: StoredSession) => `${s.origin}/acp/checkout_sessions/${s.id}`;
const newOrder = (s: StoredSession): AcpOrder => ({ id: id("ord"), checkout_session_id: s.id, permalink_url: permalink(s) });

function parseItems(raw: unknown, catalog: Catalog): { items: StoredItem[] } | AcpResult {
  if (!Array.isArray(raw) || raw.length === 0) return invalid("missing", "items must be a non-empty array of { id, quantity }.", "$.items");
  if (raw.length > MAX_ITEMS) return invalid("invalid", `At most ${MAX_ITEMS} items per checkout session.`, "$.items");
  const merged = new Map<string, StoredItem>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isRecord(r) || typeof r.id !== "string" || !r.id.trim()) return invalid("missing", "Each item needs an id (a Whop plan id from the catalog).", `$.items[${i}].id`);
    const quantity = r.quantity === undefined ? 1 : r.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return invalid("invalid", `quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, `$.items[${i}].quantity`);
    }
    const offer = catalog.offers.find((o) => o.id === r.id);
    if (!offer) {
      return invalid("unknown_item", `No offer with id ${String(r.id).slice(0, 80)}. Available: ${catalog.offers.map((o) => o.id).join(", ")}.`, `$.items[${i}].id`);
    }
    const prev = merged.get(offer.id);
    const total = (prev?.quantity ?? 0) + quantity;
    if (total > MAX_QUANTITY) return invalid("invalid", `quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, `$.items[${i}].quantity`);
    merged.set(offer.id, { id: offer.id, quantity: total, title: offer.title, price: offer.price, currency: offer.currency, billing: offer.billing });
  }
  return { items: [...merged.values()] };
}

function parseBuyer(raw: unknown): { buyer?: AcpBuyer } | AcpResult {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) return invalid("invalid", "buyer must be an object.", "$.buyer");
  const buyer: AcpBuyer = {};
  for (const k of ["first_name", "last_name", "email", "phone_number"] as const) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) buyer[k] = v.trim().slice(0, 200);
  }
  if (buyer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) return invalid("invalid", "buyer.email isn't an email address.", "$.buyer.email");
  return { buyer };
}

/** Ready unless the items can't be paid in one checkout (mixed currencies). */
function readiness(items: StoredItem[]): AcpStatus {
  return items.every((it) => it.currency === items[0].currency) ? "ready_for_payment" : "not_ready_for_payment";
}

/** A Whop payment (webhook) or demo payment for this session, after it was created. */
function paymentArrived(s: StoredSession): boolean {
  const ids = new Set(s.items.map((it) => it.id));
  // A ref shared with a conversation (MCP) may have paid for earlier checkouts: only count payments since this one.
  const since = s.ref === s.id ? -Infinity : Date.parse(s.createdAt);
  return eventStore()
    .all()
    .some((e) => {
      if (e.event !== "order_completed" || Date.parse(e.timestamp) < since) return false;
      const p = e.properties ?? {};
      const meta = (isRecord(p.whop_metadata) ? p.whop_metadata : {}) as Record<string, unknown>;
      const ref = typeof p.darwin_ref === "string" ? p.darwin_ref : meta.darwin_ref;
      if (ref !== s.ref) return false;
      // One conversation (an MCP session) can hold several checkouts: match the plan when the payment names one.
      return typeof p.product_id !== "string" || !p.product_id.startsWith("plan_") || ids.has(p.product_id);
    });
}

/** Payment confirmed since we last looked (Whop webhook, or the demo checkout page) → completed. */
function settle(s: StoredSession): boolean {
  if (s.status === "completed" || s.status === "canceled" || !paymentArrived(s)) return false;
  s.status = "completed";
  s.order ??= newOrder(s);
  s.notes.push(s.source === "demo" ? "Paid on the demo checkout (simulated payment, no real charge)." : "Payment confirmed by Whop.");
  return true;
}

/** Payment links for every line item: Whop checkouts tagged with this session (or the demo checkout page). */
async function startPayment(s: StoredSession, catalog: Catalog) {
  if (!s.payment) {
    const cat: Catalog = { ...catalog, source: s.source };
    s.payment = [];
    for (const it of s.items) {
      const offer: Offer = catalog.offers.find((o) => o.id === it.id) ?? { id: it.id, title: it.title, price: it.price, currency: it.currency, billing: it.billing, checkoutUrl: `https://whop.com/checkout/${it.id}`, available: true };
      const link = await createCheckout(offer, cat, { ref: s.ref, agentName: s.agentName, synthetic: s.synthetic }, s.origin);
      s.payment.push({ offerId: it.id, url: link.url, tagged: link.tagged });
    }
    if (s.source === "whop" && s.items.some((it) => it.quantity > 1)) s.notes.push("A Whop checkout sells one of a plan per payment: open the link once per unit.");
  }
  s.status = "in_progress";
}

function render(s: StoredSession): CheckoutSession {
  const currency = s.items[0]?.currency ?? "gbp";
  const line_items: AcpLineItem[] = s.items.map((it) => {
    const base = it.price * it.quantity;
    return { id: `li_${it.id}`, item: { id: it.id, quantity: it.quantity }, base_amount: base, discount: 0, subtotal: base, tax: 0, total: base };
  });
  const sum = (k: "base_amount" | "subtotal" | "tax" | "total") => line_items.filter((_li, i) => s.items[i].currency === currency).reduce((acc, li) => acc + li[k], 0);
  const messages: AcpMessage[] = s.items.map((it, i) =>
    info(
      `${it.title} × ${it.quantity}: ${formatPrice({ price: it.price * it.quantity, currency: it.currency, billing: it.billing })}${it.billing === "one_time" || it.price === 0 ? "" : ` (membership on Whop: renews every ${it.billing} until cancelled)`}.`,
      `$.line_items[${i}]`,
    ),
  );
  s.items.forEach((it, i) => {
    if (it.currency !== currency) messages.push({ type: "error", code: "invalid", param: `$.line_items[${i}]`, content_type: "plain", content: `${it.title} is priced in ${it.currency.toUpperCase()}, not ${currency.toUpperCase()}: check it out in a separate session.` });
  });
  messages.push(info(s.source === "demo" ? "Demo catalog: no real charges. Completing records a labelled, simulated payment." : "Payment is taken on Whop's checkout; taxes, if any, are added there."));
  if (s.status === "in_progress") {
    messages.push(
      info(
        s.source === "demo"
          ? "Complete payment on the demo checkout (payment link; no real charge)."
          : "Complete payment on Whop: open the payment link. Darwin can't charge a delegated payment token for a Whop store; this session changes to completed when Whop confirms the payment.",
      ),
    );
  }
  for (const n of s.notes) messages.push(info(n));
  return {
    id: s.id,
    ...(s.buyer && Object.keys(s.buyer).length ? { buyer: s.buyer } : {}),
    payment_provider: { provider: s.source === "demo" ? "darwin_demo" : "whop", supported_payment_methods: ["card"] },
    status: s.status,
    currency,
    line_items,
    fulfillment_options: [],
    totals: [
      { type: "items_base_amount", display_text: "Item(s) total", amount: sum("base_amount") },
      { type: "subtotal", display_text: "Subtotal", amount: sum("subtotal") },
      { type: "tax", display_text: "Tax", amount: sum("tax") },
      { type: "total", display_text: "Total", amount: sum("total") },
    ],
    messages,
    links: s.status === "in_progress" ? (s.payment ?? []).map((p) => ({ type: "payment" as const, url: p.url })) : [],
    ...(s.order ? { order: s.order } : {}),
  };
}

const totalOf = (items: StoredItem[]) => items.filter((it) => it.currency === items[0].currency).reduce((acc, it) => acc + it.price * it.quantity, 0);
const viewed = (c: Conversation, items: StoredItem[], sessionId: string) =>
  items.map((it) => conversationEvent("product_viewed", c, { product_id: it.id, price: it.price, currency: it.currency, acp_session_id: sessionId }));

/* ------------------------------------------------------------------ operations */

export async function createCheckoutSession(input: Record<string, unknown>, ctx: AcpContext): Promise<AcpResult> {
  const catalog = await getCatalog();
  const parsed = parseItems(input.items, catalog);
  if ("status" in parsed) return parsed;
  const buyer = parseBuyer(input.buyer);
  if ("status" in buyer) return buyer;
  const sessionId = id("cs");
  const now = new Date().toISOString();
  const s: StoredSession = {
    id: sessionId,
    ref: ctx.ref && REF.test(ctx.ref) ? ctx.ref : sessionId,
    channel: ctx.channel ?? "acp",
    agentName: (ctx.agentName || "unknown-agent").slice(0, 60),
    synthetic: !!ctx.synthetic,
    origin: ctx.origin,
    source: catalog.source,
    status: readiness(parsed.items),
    items: parsed.items,
    ...(buyer.buyer ? { buyer: buyer.buyer } : {}),
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
  save(s);
  const c = conv(s);
  const total = totalOf(s.items);
  track([
    ...startConversation(c),
    ...viewed(c, s.items, s.id),
    conversationEvent("checkout_started", c, {
      product_id: s.items.map((it) => it.id).join(","),
      price: total,
      value: total,
      currency: s.items[0].currency,
      quantity: s.items.reduce((acc, it) => acc + it.quantity, 0),
      acp_session_id: s.id,
    }),
  ]);
  return { status: 201, body: render(s) };
}

export async function getCheckoutSession(sessionId: string): Promise<AcpResult> {
  const s = load(sessionId);
  if (!s) return notFound(sessionId);
  if (settle(s)) save(s);
  return { status: 200, body: render(s) };
}

export async function updateCheckoutSession(sessionId: string, input: Record<string, unknown>): Promise<AcpResult> {
  const s = load(sessionId);
  if (!s) return notFound(sessionId);
  settle(s);
  if (s.status === "completed" || s.status === "canceled") {
    save(s);
    return notModifiable(s);
  }
  const buyer = parseBuyer(input.buyer);
  if ("status" in buyer) return buyer;
  if (input.items !== undefined) {
    const parsed = parseItems(input.items, await getCatalog());
    if ("status" in parsed) return parsed;
    const same = JSON.stringify(parsed.items.map((it) => [it.id, it.quantity])) === JSON.stringify(s.items.map((it) => [it.id, it.quantity]));
    const added = parsed.items.filter((it) => !s.items.some((old) => old.id === it.id));
    s.items = parsed.items;
    if (!same) {
      s.payment = undefined;
      s.status = readiness(s.items);
    }
    if (added.length) track(viewed(conv(s), added, s.id));
  }
  if (buyer.buyer) s.buyer = { ...s.buyer, ...buyer.buyer };
  save(s);
  return { status: 200, body: render(s) };
}

export async function completeCheckoutSession(sessionId: string, input: Record<string, unknown>): Promise<AcpResult> {
  const s = load(sessionId);
  if (!s) return notFound(sessionId);
  settle(s);
  if (s.status === "canceled") return notModifiable(s);
  if (s.status === "completed") {
    save(s);
    return { status: 200, body: render(s) };
  }
  if (s.status === "not_ready_for_payment") return invalid("not_ready_for_payment", "This session isn't ready for payment: fix the errors in messages first.", "$.status");
  const buyer = parseBuyer(input.buyer);
  if ("status" in buyer) return buyer;
  if (buyer.buyer) s.buyer = { ...s.buyer, ...buyer.buyer };
  // Never stored: Darwin can't use a delegated payment token for a Whop store.
  const tokenOffered = isRecord(input.payment_data) && !s.notes.some((n) => n.startsWith("The payment token"));
  if (s.source === "demo") {
    for (const it of s.items) {
      for (let q = 0; q < it.quantity; q++) {
        // This session is the checkout record: the payment is credited to its conversation (agent, channel).
        if (!recordDemoPayment(it.id, s.ref, false, { checkout: { agentName: s.agentName, channel: s.channel } }).ok) return { status: 500, body: acpError("processing_error", "payment_failed", "Couldn't record the demo payment.") };
      }
    }
    s.status = "completed";
    s.order = newOrder(s);
    s.notes.push("Paid: demo store, simulated payment, no real charge.");
  } else {
    await startPayment(s, await getCatalog());
    if (tokenOffered) s.notes.push("The payment token wasn't used: Whop takes the payment on its own checkout.");
  }
  save(s);
  return { status: 200, body: render(s) };
}

export async function cancelCheckoutSession(sessionId: string): Promise<AcpResult> {
  const s = load(sessionId);
  if (!s) return notFound(sessionId);
  settle(s);
  if (s.status === "completed" || s.status === "canceled") {
    save(s);
    return notModifiable(s);
  }
  s.status = "canceled";
  save(s);
  return { status: 200, body: render(s) };
}

/**
 * For tools (MCP create_checkout): open a checkout session for one offer and start payment straight away,
 * handing back the payment link, the same tagged link the chat gives (demo checkout page, or Whop).
 */
export async function openCheckoutLink(offerId: string, quantity: number, ctx: AcpContext): Promise<AcpResult & { link?: { offerId: string; url: string; tagged: boolean } }> {
  const created = await createCheckoutSession({ items: [{ id: offerId, quantity }] }, ctx);
  if (created.status >= 400 || !("line_items" in created.body)) return created;
  const s = load(created.body.id)!;
  await startPayment(s, await getCatalog());
  save(s);
  return { status: 201, body: render(s), link: s.payment?.[0] };
}

/* ------------------------------------------------------------------ HTTP */

export const ACP_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, Request-Id, API-Version, Accept-Language, Signature, Timestamp, User-Agent, X-Agent-Name",
  "Access-Control-Expose-Headers": "Idempotency-Key, Request-Id, API-Version, Idempotent-Replayed",
};

export const acpPreflight = () => new Response(null, { status: 204, headers: ACP_CORS });

/** The public origin the request came in on (behind a proxy too). */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export type AcpOp = "create" | "retrieve" | "update" | "complete" | "cancel";

interface Remembered {
  fingerprint: string;
  status: number;
  body: AcpResult["body"];
  at: string;
}

const gi = globalThis as unknown as { __darwinAcpInflight?: Map<string, { fingerprint: string; result: Promise<AcpResult> }> };
const inflight = () => (gi.__darwinAcpInflight ??= new Map());

function remember(scope: string, r: Remembered) {
  kvUpdate<Record<string, Remembered>>(IDEMPOTENCY_KEY, () => ({}), (all) => {
    all[scope] = r;
    const keys = Object.keys(all);
    for (let i = 0; i < keys.length - MAX_IDEMPOTENCY; i++) delete all[keys[i]];
    return all;
  });
}

/**
 * One ACP request → response: rate limit, JSON body, Idempotency-Key (same key + same body → the same
 * response, replayed; same key + different body → 409), API-Version / Request-Id echoed, CORS for agents.
 * `Authorization: Bearer …` is accepted but not required: the store is public, like /a2a/whop.
 */
export async function acpHttp(req: Request, op: AcpOp, sessionId = ""): Promise<Response> {
  const idemKey = req.headers.get("idempotency-key")?.trim().slice(0, 255) || undefined;
  const requestId = req.headers.get("request-id")?.trim().slice(0, 255) || undefined;
  const headers: Record<string, string> = {
    ...ACP_CORS,
    "API-Version": req.headers.get("api-version")?.trim().slice(0, 32) || ACP_API_VERSION,
    ...(requestId ? { "Request-Id": requestId } : {}),
    ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
  };
  const send = (status: number, body: unknown, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });

  if (!allowIngest(req, 1)) return send(429, acpError("service_unavailable", "rate_limited", "Too many requests: retry in a minute."), { "Retry-After": "60" });

  let body: Record<string, unknown> = {};
  if (op !== "retrieve") {
    const raw = await req.text();
    if (raw.length > 32_000) return send(413, acpError("invalid_request", "too_large", "Request body is too large."));
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return send(400, acpError("invalid_request", "invalid_json", "Request body isn't valid JSON."));
      }
      if (!isRecord(parsed)) return send(400, acpError("invalid_request", "invalid", "Request body must be a JSON object."));
      body = parsed;
    }
  }
  const meta = isRecord(body.metadata) ? body.metadata : {};
  const declared = typeof meta.agent_name === "string" ? meta.agent_name : isRecord(body.buyer) && typeof body.buyer.agent_name === "string" ? body.buyer.agent_name : undefined;
  const ctx: AcpContext = { origin: requestOrigin(req), agentName: agentNameFrom(req.headers, declared), channel: "acp" };
  const run = (): Promise<AcpResult> => {
    switch (op) {
      case "create":
        return createCheckoutSession(body, ctx);
      case "retrieve":
        return getCheckoutSession(sessionId);
      case "update":
        return updateCheckoutSession(sessionId, body);
      case "complete":
        return completeCheckoutSession(sessionId, body);
      case "cancel":
        return cancelCheckoutSession(sessionId);
    }
  };

  if (!idemKey || op === "retrieve") {
    const out = await run();
    return send(out.status, out.body);
  }

  const scope = `${op}:${sessionId}:${idemKey}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const conflict = () => send(409, acpError("request_not_idempotent", "idempotency_conflict", "This Idempotency-Key was already used with a different request body.", "Idempotency-Key"));
  const prior = kvGet<Record<string, Remembered>>(IDEMPOTENCY_KEY, () => ({}))[scope];
  if (prior) return prior.fingerprint === fingerprint ? send(prior.status, prior.body, { "Idempotent-Replayed": "true" }) : conflict();
  // Two requests with one key racing: the second waits for the first instead of doing the work twice.
  const running = inflight().get(scope);
  if (running) {
    if (running.fingerprint !== fingerprint) return conflict();
    const out = await running.result;
    return send(out.status, out.body, { "Idempotent-Replayed": "true" });
  }
  const pending = run();
  inflight().set(scope, { fingerprint, result: pending });
  try {
    const out = await pending;
    if (out.status < 500) remember(scope, { fingerprint, status: out.status, body: out.body, at: new Date().toISOString() });
    return send(out.status, out.body);
  } finally {
    inflight().delete(scope);
  }
}
