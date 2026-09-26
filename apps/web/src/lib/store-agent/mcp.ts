/**
 * MCP server for the Whop store (Streamable HTTP transport, JSON responses only, no SSE): the same store
 * agent as /a2a/whop, as tools, for agents that speak MCP (Claude Desktop, Cursor, Grok…).
 *
 * JSON-RPC 2.0 over POST /api/store-agent/mcp: initialize, notifications/initialized, ping, tools/list,
 * tools/call. Batches are accepted. `initialize` issues an `Mcp-Session-Id`, which is the conversation's
 * darwin_ref (clients without a session get one per agent per day), so a search and the checkout it leads to
 * are one conversation in the agent funnel (channel "mcp").
 *
 * Tools: search_offers { query, max_price? } · get_offer { id } · create_checkout { offer_id, quantity? } ·
 * store_info. create_checkout opens an ACP checkout session (lib/store-agent/acp.ts) and returns its payment
 * link: the same tagged link the chat gives (Whop checkout with darwin_ref, or the demo checkout page).
 */
import { createHash } from "node:crypto";
import { track } from "@/lib/analytics/store";
import { budgetOf, rankOffers } from "./agent";
import { agentNameFrom, conversationEvent, openCheckoutLink, startConversation, type Conversation } from "./acp";
import { formatPrice, getCatalog, type Offer } from "./catalog";

export const STORE_MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const STORE_MCP_SERVER_INFO = { name: "whop-store-agent", title: "Whop store agent (Darwin)", version: "1.0.0" } as const;
const MAX_SESSIONS = 1000;
const MAX_BATCH = 20;
const MAX_QUANTITY = 10;

/* ------------------------------------------------------------------ sessions */

interface StoreMcpSession {
  id: string;
  clientName?: string;
  protocolVersion: string;
  createdAt: string;
}

const g = globalThis as unknown as { __darwinStoreMcpSessions?: Map<string, StoreMcpSession> };
const sessions = () => (g.__darwinStoreMcpSessions ??= new Map());

export function endStoreMcpSession(sessionId: string): boolean {
  return sessions().delete(sessionId);
}

export function resetStoreMcp() {
  sessions().clear();
}

/* ------------------------------------------------------------------ tools */

export const STORE_MCP_TOOLS = [
  {
    name: "search_offers",
    title: "Search offers",
    description:
      "Search the store by need, budget and one-off vs membership (e.g. 'trail running coaching under £40 a month'). Returns up to 5 offers with id, price (minor units) and billing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the buyer wants, in plain words. Budgets like 'under £40' are understood." },
        max_price: { type: "integer", minimum: 0, description: "Optional price cap in minor units (pence/cents)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { title: "Search offers", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_offer",
    title: "Get offer",
    description: "One offer by id: title, description, price (minor units), currency and billing (one_time, month, year…).",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Offer id (a Whop plan id) from search_offers." } }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get offer", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_checkout",
    title: "Create checkout",
    description:
      "A checkout link for an offer, credited to your agent. The buyer pays on Whop's checkout (or the demo checkout, with no real charge, while the store is in demo mode). Also returns the ACP checkout session, which shows 'completed' once paid.",
    inputSchema: {
      type: "object",
      properties: {
        offer_id: { type: "string", description: "Offer id (a Whop plan id) from search_offers." },
        quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY, description: "Defaults to 1." },
      },
      required: ["offer_id"],
      additionalProperties: false,
    },
    annotations: { title: "Create checkout", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "store_info",
    title: "Store info",
    description: "Who the store is, what it sells, how payment works, and its other agent endpoints (A2A chat, ACP checkout).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Store info", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const;

type ToolName = (typeof STORE_MCP_TOOLS)[number]["name"];
const TOOL_NAMES = STORE_MCP_TOOLS.map((t) => t.name) as readonly string[];

const offerData = (o: Offer) => ({ id: o.id, title: o.title, description: o.description, price: o.price, currency: o.currency, billing: o.billing, priceLabel: formatPrice(o) });

interface ToolOutput {
  text: string;
  data: Record<string, unknown>;
  isError?: boolean;
}

const toolError = (text: string, data: Record<string, unknown> = {}): ToolOutput => ({ text, data: { error: text, ...data }, isError: true });

async function runTool(name: ToolName, args: Record<string, unknown>, c: Conversation, origin: string): Promise<ToolOutput> {
  const catalog = await getCatalog();
  const base = { business: catalog.business, catalog: catalog.source };
  const events = startConversation(c);
  try {
    switch (name) {
      case "search_offers": {
        const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
        if (!query) return toolError("query is required: describe what the buyer wants.");
        const max = args.max_price;
        if (max !== undefined && (typeof max !== "number" || !Number.isInteger(max) || max < 0)) return toolError("max_price must be a whole number of minor units (pence/cents).");
        const cap = Math.min(max ?? Infinity, budgetOf(query) ?? Infinity);
        const pool = catalog.offers.filter((o) => o.price <= cap);
        const ranked = rankOffers(pool, query);
        const exact = ranked.length > 0;
        const offers = (exact ? ranked : [...pool].sort((a, b) => a.price - b.price)).slice(0, 5);
        for (const o of offers) events.push(conversationEvent("product_viewed", c, { product_id: o.id, price: o.price, currency: o.currency }));
        const text = offers.length
          ? [`${exact ? "Offers that fit" : "Nothing matches that exactly; here's what's in budget"} at ${catalog.business}:`, ...offers.map((o, i) => `${i + 1}. ${o.title} (${o.id}): ${formatPrice(o)}${o.description ? `. ${o.description}` : ""}`), "Call create_checkout with an offer id to get a checkout link."].join("\n")
          : `Nothing at ${catalog.business} is within that budget.`;
        return { text, data: { ...base, query, exact, offers: offers.map(offerData) } };
      }
      case "get_offer": {
        const offerId = typeof args.id === "string" ? args.id : "";
        const offer = catalog.offers.find((o) => o.id === offerId);
        if (!offer) return toolError(`No offer with id ${offerId.slice(0, 80) || "(missing)"}.`, { available: catalog.offers.map((o) => o.id) });
        events.push(conversationEvent("product_viewed", c, { product_id: offer.id, price: offer.price, currency: offer.currency }));
        return { text: `${offer.title} (${offer.id}): ${formatPrice(offer)}${offer.description ? `. ${offer.description}` : ""}`, data: { ...base, offer: offerData(offer) } };
      }
      case "create_checkout": {
        const offerId = typeof args.offer_id === "string" ? args.offer_id : "";
        if (!offerId) return toolError("offer_id is required (an id from search_offers).");
        const quantity = args.quantity === undefined ? 1 : args.quantity;
        if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return toolError(`quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
        // The conversation-start event must land before the checkout's events.
        track(events.splice(0));
        const out = await openCheckoutLink(offerId, quantity, { origin, agentName: c.agentName, channel: "mcp", ref: c.ref, synthetic: c.synthetic });
        if (!("line_items" in out.body)) return toolError(out.body.message, { code: out.body.code });
        const offer = catalog.offers.find((o) => o.id === offerId)!;
        const link = out.link!;
        const session = out.body;
        const where = catalog.source === "demo" ? "the demo checkout (no real charge)" : "Whop";
        return {
          text: `${offer.title}, ${formatPrice(offer)}${quantity > 1 ? ` × ${quantity}` : ""}. Checkout: ${link.url} . Payment happens on ${where}; access is instant once it goes through.`,
          data: {
            ...base,
            checkout_url: link.url,
            tagged: link.tagged,
            ref: c.ref,
            offer: offerData(offer),
            checkout_session: { id: session.id, status: session.status, url: `${origin}/acp/checkout_sessions/${session.id}`, total: session.totals.find((t) => t.type === "total")?.amount, currency: session.currency },
          },
        };
      }
      case "store_info": {
        const text = [
          `I'm the store agent for ${catalog.business}${catalog.source === "demo" ? " (demo catalog: no real charges)" : ""}. ${catalog.offers.length} offer${catalog.offers.length === 1 ? "" : "s"} for sale.`,
          "Use search_offers to find one, then create_checkout for a checkout link. Payment happens on Whop's checkout; access is instant once it goes through.",
          "Memberships can be cancelled any time from your Whop account; for refunds, contact the seller through Whop.",
        ].join("\n");
        return {
          text,
          data: {
            ...base,
            ...(catalog.note ? { note: catalog.note } : {}),
            offers: catalog.offers.length,
            currencies: [...new Set(catalog.offers.map((o) => o.currency))],
            payment: "Whop checkout (checkout links are tagged so the payment is credited to your agent).",
            endpoints: { a2a: `${origin}/a2a/whop`, acp: `${origin}/acp/checkout_sessions`, mcp: `${origin}/api/store-agent/mcp` },
          },
        };
      }
      default:
        return toolError(`Unknown tool: ${name satisfies never}`);
    }
  } finally {
    if (events.length) track(events);
  }
}

/* ------------------------------------------------------------------ JSON-RPC */

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;
const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface CallState {
  sessionId?: string;
  newSessionId?: string;
  headers: Headers;
  origin: string;
}

/** The conversation behind a call: the MCP session, or (no session) one per agent + client per day. */
function conversationFor(state: CallState): Conversation {
  const sid = state.sessionId ?? state.newSessionId;
  const known = sid ? sessions().get(sid) : undefined;
  const agentName = agentNameFrom(state.headers, known?.clientName);
  let ref = sid && /^mcp_[\w-]{4,76}$/.test(sid) ? sid : undefined;
  if (!ref) {
    const ip = (state.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || state.headers.get("x-real-ip") || "local";
    const who = [agentName, state.headers.get("user-agent") ?? "", ip, new Date().toISOString().slice(0, 10)].join("|");
    ref = `mcp_${createHash("sha256").update(who).digest("hex").slice(0, 20)}`;
  }
  return { ref, channel: "mcp", agentName, synthetic: false };
}

async function instructions(): Promise<string> {
  const catalog = await getCatalog();
  return (
    `The store agent for ${catalog.business}${catalog.source === "demo" ? " (demo catalog: no real charges)" : ""}. Prices are minor units (pence/cents). ` +
    "Flow: search_offers → get_offer (optional) → create_checkout, which returns a checkout link to give the buyer. Payment happens on Whop's checkout."
  );
}

async function initialize(id: JsonRpcId, params: Record<string, unknown>, state: CallState): Promise<JsonRpcResponse> {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
  const protocolVersion = requested && SUPPORTED_VERSIONS.includes(requested) ? requested : STORE_MCP_PROTOCOL_VERSION;
  const clientInfo = isRecord(params.clientInfo) ? params.clientInfo : {};
  const sessionId = `mcp_${crypto.randomUUID()}`;
  const store = sessions();
  store.set(sessionId, { id: sessionId, clientName: typeof clientInfo.name === "string" ? clientInfo.name.slice(0, 60) : undefined, protocolVersion, createdAt: new Date().toISOString() });
  if (store.size > MAX_SESSIONS) store.delete(store.keys().next().value!);
  state.newSessionId = sessionId;
  return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: STORE_MCP_SERVER_INFO, instructions: await instructions() });
}

async function toolsCall(id: JsonRpcId, params: Record<string, unknown>, state: CallState): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string") return err(id, RPC.invalidParams, "tools/call requires params.name");
  if (!TOOL_NAMES.includes(name)) return err(id, RPC.invalidParams, `Unknown tool: ${name}`, { available: TOOL_NAMES });
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(args)) return err(id, RPC.invalidParams, "params.arguments must be an object");
  const out = await runTool(name as ToolName, args, conversationFor(state), state.origin);
  return ok(id, { content: [{ type: "text", text: `${out.text}\n\n${JSON.stringify(out.data)}` }], structuredContent: out.data, isError: !!out.isError });
}

/** One JSON-RPC message → response (null for notifications and client responses). */
async function handleMessage(msg: unknown, state: CallState): Promise<JsonRpcResponse | null> {
  if (!isRecord(msg)) return err(null, RPC.invalidRequest, "Invalid Request: expected a JSON-RPC object");
  const hasId = "id" in msg && msg.id !== undefined;
  const rawId = msg.id;
  if (hasId && rawId !== null && typeof rawId !== "string" && typeof rawId !== "number") return err(null, RPC.invalidRequest, "Invalid Request: id must be a string or number");
  const id = (hasId ? rawId : null) as JsonRpcId;
  if (typeof msg.method !== "string") {
    if ("result" in msg || "error" in msg) return null;
    return err(id, RPC.invalidRequest, "Invalid Request: missing method");
  }
  if (msg.jsonrpc !== undefined && msg.jsonrpc !== "2.0") return err(id, RPC.invalidRequest, 'Invalid Request: jsonrpc must be "2.0"');
  const params = msg.params === undefined ? {} : msg.params;
  if (!isRecord(params)) return hasId ? err(id, RPC.invalidParams, "params must be an object") : null;
  if (!hasId) return null; // notifications/initialized, notifications/cancelled…

  try {
    switch (msg.method) {
      case "initialize":
        return await initialize(id, params, state);
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: STORE_MCP_TOOLS });
      case "tools/call":
        return await toolsCall(id, params, state);
      default:
        return err(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error("[store-agent mcp] internal error", e);
    return err(id, RPC.internal, "Internal error");
  }
}

export interface StoreMcpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}

/** POST /api/store-agent/mcp body → 200 + JSON for requests, 202 (no body) for notifications only. */
export async function handleStoreMcpPost(rawBody: string, headers: Headers, origin: string): Promise<StoreMcpResult> {
  const state: CallState = { sessionId: headers.get("mcp-session-id")?.trim() || undefined, headers, origin };
  const out = (status: number, body?: unknown): StoreMcpResult => ({
    status,
    body,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(state.newSessionId ? { "Mcp-Session-Id": state.newSessionId } : {}) },
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return out(400, err(null, RPC.parseError, "Parse error: body is not valid JSON"));
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return out(400, err(null, RPC.invalidRequest, "Invalid Request: empty batch"));
    if (parsed.length > MAX_BATCH) return out(400, err(null, RPC.invalidRequest, `Invalid Request: batch too large (max ${MAX_BATCH})`));
    const responses: JsonRpcResponse[] = [];
    for (const msg of parsed) {
      const r = await handleMessage(msg, state);
      if (r) responses.push(r);
    }
    return responses.length ? out(200, responses) : out(202);
  }
  const r = await handleMessage(parsed, state);
  return r ? out(200, r) : out(202);
}

/** GET /api/store-agent/mcp: a short self-description. */
export function storeMcpDescription(origin: string) {
  return {
    name: STORE_MCP_SERVER_INFO.name,
    title: STORE_MCP_SERVER_INFO.title,
    version: STORE_MCP_SERVER_INFO.version,
    transport: "streamable-http (JSON responses, no SSE)",
    endpoint: `${origin}/api/store-agent/mcp`,
    protocolVersion: STORE_MCP_PROTOCOL_VERSION,
    usage: "POST JSON-RPC 2.0: initialize → notifications/initialized → tools/list → tools/call. Send back the Mcp-Session-Id header.",
    tools: TOOL_NAMES,
    alsoAvailable: { a2a: `${origin}/a2a/whop`, acp: `${origin}/acp/checkout_sessions` },
  };
}
