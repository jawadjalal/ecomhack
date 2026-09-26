/**
 * A2A (Agent2Agent protocol) endpoint for PACE's merchant agent: POST /api/a2a, JSON-RPC 2.0.
 * Speaks v1.0 (`SendMessage`, proto-JSON parts) and v0.3 (`message/send`, `kind` parts) on the same URL.
 *
 * A message is a buyer agent's text in plain English (plus optional data parts); the reply is an agent
 * message with the answer as text and the products, deal or order as data. The conversation (`contextId`) is the commerce session: shortlist, cart, deals
 * and orders. Every step runs through `dispatchAgentTool`, so it is tracked like MCP/REST traffic,
 * shows up in experiments, and only reveals what the live PageSpec's agentSurface exposes.
 *
 * No tasks are created (every reply is immediate), so tasks/* answer TaskNotFound and streaming is
 * unsupported, as the agent card declares.
 */
import type { AgentProduct, NegotiationTurn, ShoppingGoal } from "@/lib/contracts";
import { PRODUCTS, type Product } from "@/lib/catalog/products";
import { uuid } from "@/lib/ids";
import { formatGBP } from "@/lib/money";
import { resolveSpecForVisitor } from "@/lib/spec/resolve";
import { parseGoalBrief, wantFromGoal } from "./buyer";
import { dispatchAgentTool } from "./dispatcher";
import { identityFromHeaders, syntheticFromHeaders } from "./http";
import { appendNegotiation, upsertAgentSession } from "./state";
import { normaliseSize } from "./surface";
import type { AgentContext, AgentOrder, AgentProductDetail, AgentToolName, AgentToolResult, CartView, NegotiationOutcome } from "./types";

/** Versions served on /api/a2a, newest first. */
export const A2A_PROTOCOL_VERSIONS = ["1.0", "0.3"] as const;

/* ------------------------------------------------------------------ protocol types (subset) */

export type A2aPart =
  | { kind: "text"; text: string; metadata?: Record<string, unknown> }
  | { kind: "data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
  | { kind: "file"; file: Record<string, unknown>; metadata?: Record<string, unknown> };

export interface A2aMessage {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  parts: A2aPart[];
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

type JsonRpcId = string | number | null;
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC and A2A error codes. */
export const A2A_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  pushNotSupported: -32003,
  unsupportedOperation: -32004,
  extendedCardNotConfigured: -32007,
} as const;

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/* ------------------------------------------------------------------ conversations */

interface Conversation {
  contextId: string;
  agentId: string;
  agentName: string;
  goal?: ShoppingGoal;
  /** Product ids from the last shortlist, best first. */
  shortlist: string[];
  /** The product we're talking about. */
  focus?: string;
  size?: string;
}

const MAX_CONVERSATIONS = 1000;
const g = globalThis as unknown as { __darwinA2a?: Map<string, Conversation> };
const conversations = (): Map<string, Conversation> => (g.__darwinA2a ??= new Map());

export function resetA2aConversations() {
  conversations().clear();
}

/* ------------------------------------------------------------------ reading the buyer */

const LEAVE = /\b(no thanks|not interested|goodbye|bye|never ?mind|forget it|i'?ll pass|leave it)\b/;
const BUY = /\b(buy|order|check ?out|purchase|i'?ll take|go ahead|place (?:the|an|my) order|yes please|it'?s a deal)\b/;
/** A question about the product we're discussing ("what sizes?", "when would it arrive?"). */
const ASK_ABOUT = /\b(sizes?|stock|in stock|deliver\w*|arriv\w*|returns?|refund|price|cost|shipping|more about|details|tell me|what about|is it|does it)\b/;
const HAGGLE = /\b(offer|would you (?:take|do|accept)|how about|can you do|could you do|discount|cheaper|lower|best price|knock|haggle)\b/;
const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|#1|number one|option (?:1|one))\b/, 0],
  [/\b(second|2nd|#2|number two|option (?:2|two))\b/, 1],
  [/\b(third|3rd|#3|number three|option (?:3|three))\b/, 2],
];

function textOf(message: A2aMessage): string {
  return message.parts
    .filter((p): p is Extract<A2aPart, { kind: "text" }> => p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim()
    .slice(0, 1000);
}

function dataOf(message: A2aMessage): Record<string, unknown> {
  return Object.assign({}, ...message.parts.filter((p) => p.kind === "data" && isRecord(p.data)).map((p) => (p as { data: object }).data));
}

function mentionedProduct(text: string, conv: Conversation): Product | undefined {
  const t = text.toLowerCase();
  const named = PRODUCTS.find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.slug) || t.includes(p.id));
  if (named) return named;
  // Distinctive first word ("the Ridge", "Velocity") counts too.
  const byWord = PRODUCTS.find((p) => new RegExp(`\\b${p.name.split(" ")[0].toLowerCase()}\\b`).test(t));
  if (byWord) return byWord;
  for (const [re, i] of ORDINALS) if (re.test(t) && conv.shortlist[i]) return PRODUCTS.find((p) => p.id === conv.shortlist[i]);
  return undefined;
}

function sizeIn(text: string): string | undefined {
  const m = text.toLowerCase().match(/\b(?:uk|size)\s*(\d{1,2}(?:\.5)?)\b/) ?? text.toLowerCase().match(/\b(s\/m|l\/xl|one size)\b/);
  return m?.[1];
}

function poundsIn(text: string): number | undefined {
  const m = text.match(/£\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Math.round(Number(m[1]) * 100) : undefined;
}

function looksLikeBrief(text: string): boolean {
  return /\b(looking for|need|want|after|find|recommend|shoes?|trainers?|socks?|vest|trail|road|racing|carbon|marathon|ultra|under £|budget)\b/i.test(text);
}

/* ------------------------------------------------------------------ talking back */

const FIELD_WORDS: Record<string, string> = {
  sizes: "stock levels",
  stock: "stock levels",
  deliveryEtaDays: "delivery times",
  returnPolicy: "the returns policy",
  landedPrice: "prices including delivery",
};

function joinWords(words: string[]): string {
  const unique = [...new Set(words)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

function hiddenNote(missing: string[] | undefined): string {
  const words = (missing ?? []).map((m) => FIELD_WORDS[m]).filter(Boolean);
  return words.length ? `I'm not able to share ${joinWords(words)} with agents yet.` : "";
}

function productLine(p: AgentProduct, size?: string): string {
  const bits = [formatGBP(p.price.amount)];
  if (p.rating) bits.push(`${p.rating.value}★ (${p.rating.count})`);
  if (size && p.sizes) {
    const s = p.sizes.find((x) => x.size === size);
    bits.push(s?.inStock ? `UK ${size} in stock` : `UK ${size} sold out`);
  }
  if (p.deliveryEtaDays !== undefined) bits.push(`arrives in ${p.deliveryEtaDays} day${p.deliveryEtaDays === 1 ? "" : "s"}`);
  if (p.returnPolicy) bits.push(`${p.returnPolicy.free ? "free" : "paid"} ${p.returnPolicy.days}-day returns`);
  if (p.landedPrice) bits.push(`${formatGBP(p.landedPrice.amount)} delivered`);
  return `${p.name}: ${bits.join(" · ")}`;
}

interface Reply {
  text: string;
  data?: Record<string, unknown>;
  /** One line for the console's conversation view (the full text can be long). */
  short?: string;
  /** The negotiate tool already recorded this exchange on the session. */
  recorded?: boolean;
}

/* ------------------------------------------------------------------ the merchant agent */

type Call = <T>(tool: AgentToolName, args: Record<string, unknown>) => Promise<AgentToolResult<T>>;

async function shortlist(conv: Conversation, text: string, call: Call, negotiates: boolean): Promise<Reply> {
  // A follow-up brief refines the last one ("actually, under £120"): new details win, old ones stay.
  const goal = (conv.goal = { ...conv.goal, ...parseGoalBrief(text) });
  if (goal.size) conv.size = goal.size;
  const want = wantFromGoal(goal);
  const search = await call<AgentProduct[]>("search_products", {
    query: text.slice(0, 200),
    ...(goal.category ? { category: goal.category } : {}),
    ...(goal.maxBudget ? { maxPrice: goal.maxBudget } : {}),
    ...(goal.size ? { size: goal.size } : {}),
    ...(want.length ? { want } : {}),
  });
  let products = (search.data ?? []).slice(0, 3);
  let lead: string;
  if (products.length) {
    lead = `I found ${products.length} option${products.length === 1 ? "" : "s"}${goal.maxBudget ? ` under ${formatGBP(goal.maxBudget)}` : ""}${goal.size ? ` in UK ${goal.size}` : ""}:`;
  } else {
    const wider = await call<AgentProduct[]>("search_products", { ...(goal.category ? { category: goal.category } : {}), ...(want.length ? { want } : {}) });
    products = (wider.data ?? []).slice(0, 3);
    lead = products.length ? "Nothing matches all of that. The closest we have:" : "We don't have anything like that, sorry.";
  }
  conv.shortlist = products.map((p) => p.id);
  conv.focus = products[0]?.id;
  const lines = products.map((p, i) => `${i + 1}. ${productLine(p, goal.size)}`);
  const next = products.length
    ? `Want me to order one? Say "buy the first one${goal.size ? "" : " in UK 10"}"${negotiates ? ", or make me an offer" : ""}.`
    : "";
  const note = hiddenNote(search.missing);
  return {
    text: [lead, ...lines, note, next].filter(Boolean).join("\n"),
    data: { products, ...(search.missing?.length ? { missing: search.missing } : {}) },
    short: products.length
      ? `${products.length} option${products.length === 1 ? "" : "s"}: ${products.map((p) => `${p.name} ${formatGBP(p.price.amount)}`).join(", ")}.${note ? ` ${note}` : ""}`
      : lead,
  };
}

async function describe(conv: Conversation, product: Product, call: Call): Promise<Reply> {
  conv.focus = product.id;
  // Only ask for what this buyer cares about, so analytics count real demand for each field.
  const want = [...new Set([...wantFromGoal(conv.goal ?? { brief: "" }), ...(conv.size ? ["sizes"] : [])])];
  const res = await call<AgentProductDetail>("get_product", { id: product.id, ...(want.length ? { want } : {}) });
  if (!res.ok || !res.data) return { text: res.error ?? `I couldn't find ${product.name}.` };
  const p = res.data;
  const inStock = p.sizes?.filter((s) => s.inStock).map((s) => s.size);
  const lines = [
    `${p.name}: ${p.tagline}`,
    productLine(p, conv.size),
    p.features.slice(0, 3).join(" · "),
    inStock && !conv.size ? `In stock: ${inStock.map((s) => `UK ${s}`).join(", ")}.` : "",
    hiddenNote(res.missing),
    `Say "buy it${conv.size ? "" : " in UK 10"}" to order.`,
  ];
  return { text: lines.filter(Boolean).join("\n"), data: { product: p }, short: productLine(p, conv.size) };
}

async function haggle(conv: Conversation, product: Product, offer: number, text: string, call: Call): Promise<Reply> {
  conv.focus = product.id;
  const res = await call<NegotiationOutcome>("negotiate", { id: product.id, offer, message: text.slice(0, 500) });
  if (!res.ok || !res.data) {
    return { text: `${res.error ?? "I can't negotiate right now."} Want me to order it at that price?`, short: res.error };
  }
  const o = res.data;
  const tail = o.status === "accepted" ? ` Say "buy it" and I'll place the order at ${formatGBP(o.agreedPrice!)}.` : "";
  return { text: `${o.message}${tail}`, data: { negotiation: o }, recorded: true };
}

async function purchase(conv: Conversation, product: Product, call: Call): Promise<Reply> {
  conv.focus = product.id;
  const sized = Object.keys(product.stock).length > 1;
  const size = normaliseSize(conv.size ?? (sized ? undefined : Object.keys(product.stock)[0]), product);
  if (!size) {
    const sizes = Object.keys(product.stock).map((s) => `UK ${s}`).join(", ");
    return { text: `Happy to. Which size for the ${product.name}? It comes in ${sizes}.`, short: `Which size? (${sizes})` };
  }
  const cart = await call<CartView>("get_cart", {});
  if (!cart.data?.items.some((l) => l.productId === product.id && l.size === size)) {
    const added = await call<CartView>("add_to_cart", { id: product.id, size, quantity: 1 });
    if (!added.ok) return { text: `${added.error ?? "I couldn't add that to your bag."} Want a different size or product?`, short: added.error };
  }
  const order = await call<AgentOrder>("checkout", conv.goal?.maxBudget ? { maxTotal: conv.goal.maxBudget } : {});
  if (!order.ok || !order.data) return { text: order.error ?? "Checkout failed.", short: order.error };
  const o = order.data;
  const items = o.items.map((l) => `${l.name} (UK ${l.size})`).join(" + ");
  const saved = o.discount > 0 ? `, you saved ${formatGBP(o.discount)}` : "";
  const text = `Done: order ${o.orderId} for ${items}, ${formatGBP(o.total)} including ${o.shipping ? `${formatGBP(o.shipping)} delivery` : "free delivery"}${saved}. It arrives in ${o.deliveryEtaDays} day${o.deliveryEtaDays === 1 ? "" : "s"}.`;
  return { text, data: { order: o }, short: `Ordered ${items} for ${formatGBP(o.total)}.` };
}

async function merchantReply(conv: Conversation, text: string, data: Record<string, unknown>, ctx: AgentContext, negotiates: boolean): Promise<Reply> {
  const call: Call = async <T,>(tool: AgentToolName, args: Record<string, unknown>) => (await dispatchAgentTool(tool, args, ctx)) as AgentToolResult<T>;
  const lower = text.toLowerCase();
  const action = typeof data.action === "string" ? data.action : undefined;
  const named =
    (typeof data.productId === "string" && PRODUCTS.find((p) => p.id === data.productId || p.slug === data.productId)) ||
    mentionedProduct(text, conv);
  const size = typeof data.size === "string" || typeof data.size === "number" ? String(data.size) : sizeIn(text);
  if (size) conv.size = size.toUpperCase() === "ONE SIZE" ? "One size" : size.toUpperCase();
  const focus = named || PRODUCTS.find((p) => p.id === conv.focus);
  const offer = typeof data.offer === "number" ? data.offer : HAGGLE.test(lower) ? poundsIn(text) : undefined;

  if (action === "abandon" || (!action && LEAVE.test(lower))) {
    await call("abandon", { reason: text.slice(0, 300) || "left the conversation" });
    return { text: "No problem, thanks for stopping by. I've passed on why, so we can do better next time.", short: "Thanks for stopping by." };
  }
  if ((action === "negotiate" || (!action && offer !== undefined)) && focus && offer !== undefined) {
    return haggle(conv, focus, offer, text, call);
  }
  if (action === "buy" || (!action && BUY.test(lower) && (focus || conv.shortlist.length))) {
    const target = focus ?? PRODUCTS.find((p) => p.id === conv.shortlist[0]);
    if (target) return purchase(conv, target, call);
  }
  // A question about the product on the table, not a new brief.
  const question = /\?\s*$|^(what|when|how|is|does|do|can|could|will|would)\b/.test(lower.trim());
  if (!action && focus && question && ASK_ABOUT.test(lower) && !parseGoalBrief(text).category) return describe(conv, focus, call);
  if (action === "search" || !conv.shortlist.length || (!named && looksLikeBrief(text))) {
    return shortlist(conv, text || "running shoes", call, negotiates);
  }
  if (named) return describe(conv, named, call);
  return {
    text: 'Tell me what you\'re after (e.g. "trail shoes, UK 10, under £150, by Friday"), ask about one of the options, or say "buy the first one".',
    short: "How can I help?",
  };
}

/* ------------------------------------------------------------------ JSON-RPC */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A buyer message, whichever protocol version it arrived in. */
interface Incoming {
  text: string;
  data: Record<string, unknown>;
  contextId?: string;
  metadata: Record<string, unknown>;
}

interface Outgoing {
  messageId: string;
  contextId: string;
  text: string;
  data?: Record<string, unknown>;
}

function checkContextId(v: unknown): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || v.length > 128) throw new InvalidParams("message.contextId must be a string of at most 128 characters");
  return v;
}

class InvalidParams extends Error {}

/** v0.3: { kind: "message", role: "user", parts: [{ kind: "text", text } | { kind: "data", data }] }. */
function incomingV03(v: unknown): Incoming {
  if (!isRecord(v)) throw new InvalidParams("params.message is required");
  if (v.role !== "user") throw new InvalidParams('params.message.role must be "user"');
  if (!Array.isArray(v.parts) || !v.parts.length) throw new InvalidParams("params.message.parts must be a non-empty array");
  if (!v.parts.every((p) => isRecord(p) && typeof p.kind === "string")) throw new InvalidParams("every part needs a kind");
  const message = { ...(v as unknown as A2aMessage), kind: "message" as const };
  return { text: textOf(message), data: dataOf(message), contextId: checkContextId(v.contextId), metadata: isRecord(v.metadata) ? v.metadata : {} };
}

/** v1.0 (proto JSON): { role: "ROLE_USER", parts: [{ text } | { data }] }. */
function incomingV1(v: unknown): Incoming {
  if (!isRecord(v)) throw new InvalidParams("params.message is required");
  if (v.role !== "ROLE_USER" && v.role !== 1 && v.role !== "user") throw new InvalidParams('params.message.role must be "ROLE_USER"');
  if (!Array.isArray(v.parts) || !v.parts.length) throw new InvalidParams("params.message.parts must be a non-empty array");
  const parts = v.parts.filter(isRecord);
  const text = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("\n")
    .trim()
    .slice(0, 1000);
  const data = Object.assign({}, ...parts.filter((p) => isRecord(p.data)).map((p) => p.data as object));
  return { text, data, contextId: checkContextId(v.contextId), metadata: isRecord(v.metadata) ? v.metadata : {} };
}

async function converse(input: Incoming, headers: Headers): Promise<Outgoing> {
  const { text, data } = input;
  if (!text && !Object.keys(data).length) throw new InvalidParams("Send a text part (plain English) or a data part.");

  const store = conversations();
  const contextId = input.contextId ?? `ctx_${uuid()}`;
  let conv = store.get(contextId);
  if (!conv) {
    const name = typeof input.metadata.agentName === "string" ? input.metadata.agentName.slice(0, 64) : undefined;
    const who = identityFromHeaders(headers, name);
    conv = { contextId, agentId: who.agentId, agentName: who.agentName, shortlist: [] };
    store.set(contextId, conv);
    if (store.size > MAX_CONVERSATIONS) store.delete(store.keys().next().value!);
  }
  const ctx: AgentContext = {
    agentId: conv.agentId,
    agentName: conv.agentName,
    sessionId: `a2a_${contextId}`.slice(0, 140),
    channel: "a2a",
    synthetic: syntheticFromHeaders(headers),
  };

  // The merchant only offers to haggle when the spec this buyer is served has negotiation on.
  const negotiates = resolveSpecForVisitor(conv.agentId).spec.agentSurface.negotiation.enabled;
  const reply = await merchantReply(conv, text, data, ctx, negotiates);

  // Show the conversation in the console's agent-to-agent panel.
  const turns: NegotiationTurn[] = reply.recorded
    ? []
    : [
        { from: "buyer", message: (text || JSON.stringify(data)).slice(0, 240) },
        { from: "merchant", message: (reply.short ?? reply.text).slice(0, 240) },
      ];
  const goal = conv.goal;
  upsertAgentSession(
    ctx.sessionId,
    () => ({ sessionId: ctx.sessionId, agentName: ctx.agentName, startedAt: new Date().toISOString(), outcome: "in_progress", toolCalls: [], synthetic: ctx.synthetic ?? false }),
    (s) => {
      if (goal && !s.goal) s.goal = goal;
      if (turns.length) appendNegotiation(s, turns);
    },
  );
  return { messageId: uuid(), contextId, text: reply.text, data: reply.data };
}

/** Identity of an in-process A2A caller (the console's shopper, tests). */
export interface A2aCaller {
  agentId: string;
  agentName: string;
  synthetic: boolean;
}

/** One buyer message to the merchant agent, in process (no HTTP). Same path as POST /api/a2a. */
export async function a2aSend(text: string, caller: A2aCaller, contextId?: string): Promise<{ contextId: string; text: string; data: Record<string, unknown> }> {
  const headers = new Headers({ "x-agent-id": caller.agentId, "x-agent-name": caller.agentName, ...(caller.synthetic ? { "x-darwin-synthetic": "1" } : {}) });
  const out = await converse({ text, data: {}, contextId, metadata: {} }, headers);
  return { contextId: out.contextId, text: out.text, data: out.data ?? {} };
}

function outgoingV03(o: Outgoing): A2aMessage {
  const parts: A2aPart[] = [{ kind: "text", text: o.text }];
  if (o.data) parts.push({ kind: "data", data: o.data });
  return { kind: "message", messageId: o.messageId, role: "agent", contextId: o.contextId, parts };
}

function outgoingV1(o: Outgoing) {
  const parts: Record<string, unknown>[] = [{ text: o.text }];
  if (o.data) parts.push({ data: o.data });
  return { message: { messageId: o.messageId, contextId: o.contextId, role: "ROLE_AGENT", parts } };
}

async function handle(msg: unknown, headers: Headers): Promise<JsonRpcResponse> {
  if (!isRecord(msg)) return err(null, A2A_ERRORS.invalidRequest, "Invalid Request: expected a JSON-RPC object");
  const id = (typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null) as JsonRpcId;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(id, A2A_ERRORS.invalidRequest, 'Invalid Request: need jsonrpc "2.0" and a method');
  const params = msg.params === undefined ? {} : msg.params;
  if (!isRecord(params)) return err(id, A2A_ERRORS.invalidParams, "params must be an object");
  try {
    switch (msg.method) {
      // v0.3 method names
      case "message/send":
        return ok(id, outgoingV03(await converse(incomingV03(params.message), headers)));
      // v1.0 method names
      case "SendMessage":
        return ok(id, outgoingV1(await converse(incomingV1(params.message), headers)));
      case "ListTasks":
        return ok(id, { tasks: [], nextPageToken: "", pageSize: 0, totalSize: 0 });
      case "message/stream":
      case "tasks/resubscribe":
      case "SendStreamingMessage":
      case "SubscribeToTask":
        return err(id, A2A_ERRORS.unsupportedOperation, "Streaming is not supported: send a message instead (replies are immediate).");
      case "tasks/get":
      case "tasks/cancel":
      case "GetTask":
      case "CancelTask":
        return err(id, A2A_ERRORS.taskNotFound, "Task not found: this agent answers every message immediately and creates no tasks.");
      case "tasks/pushNotificationConfig/set":
      case "tasks/pushNotificationConfig/get":
      case "tasks/pushNotificationConfig/list":
      case "tasks/pushNotificationConfig/delete":
      case "CreateTaskPushNotificationConfig":
      case "GetTaskPushNotificationConfig":
      case "ListTaskPushNotificationConfigs":
      case "DeleteTaskPushNotificationConfig":
        return err(id, A2A_ERRORS.pushNotSupported, "Push notifications are not supported.");
      case "agent/getAuthenticatedExtendedCard":
      case "GetExtendedAgentCard":
        return err(id, A2A_ERRORS.extendedCardNotConfigured, "No authenticated extended card.");
      default:
        return err(id, A2A_ERRORS.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    if (e instanceof InvalidParams) return err(id, A2A_ERRORS.invalidParams, e.message);
    console.error("[a2a] internal error", e);
    return err(id, A2A_ERRORS.internal, "Internal error");
  }
}

/** Handle the body of a POST /api/a2a. Always answers JSON-RPC (errors are in the body). */
export async function handleA2aPost(rawBody: string, headers: Headers): Promise<JsonRpcResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return err(null, A2A_ERRORS.parseError, "Parse error: body is not valid JSON");
  }
  return handle(parsed, headers);
}
