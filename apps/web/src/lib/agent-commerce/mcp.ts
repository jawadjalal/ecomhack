/**
 * Minimal MCP server (Streamable HTTP transport, JSON responses only — no SSE).
 *
 * JSON-RPC 2.0 over POST /api/mcp: initialize, notifications/initialized, ping, tools/list, tools/call.
 * Batches (arrays) are accepted. `initialize` issues an `Mcp-Session-Id`; that id is the agent's
 * commerce session (cart, negotiation, orders). Unknown/missing session ids are tolerated so curl
 * and simple clients work without a handshake.
 */
import { dispatchAgentTool } from "./dispatcher";
import { hashId, identityFromHeaders, syntheticFromHeaders } from "./http";
import { TOOL_META, toolInputSchema } from "./tools";
import { AGENT_TOOL_NAMES, type AgentContext, type AgentToolName } from "./types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_SERVER_INFO = { name: "pace-store", title: "PACE Running store (merchant agent)", version: "0.1.0" } as const;

const INSTRUCTIONS =
  "PACE is a London running store (road, trail and racing shoes, accessories). Prices are integer pence (GBP). " +
  "Typical flow: search_products (pass `want` with the fields you need) → get_product → check_availability → " +
  "negotiate (if enabled) → add_to_cart → checkout (pass maxTotal). If you decide not to buy, call abandon with the reason. " +
  "`missing` in a result lists data the store does not expose yet.";

/* ------------------------------------------------------------------ sessions */

interface McpSession {
  id: string;
  agentId: string;
  agentName: string;
  client?: { name?: string; version?: string };
  protocolVersion: string;
  createdAt: string;
}

const MAX_MCP_SESSIONS = 1000;
const g = globalThis as unknown as { __darwinMcpSessions?: Map<string, McpSession> };
const sessions = (): Map<string, McpSession> => (g.__darwinMcpSessions ??= new Map());

export function getMcpSession(id: string): McpSession | undefined {
  return sessions().get(id);
}

export function deleteMcpSession(id: string): boolean {
  return sessions().delete(id);
}

export function resetMcpSessions() {
  sessions().clear();
}

/* ------------------------------------------------------------------ JSON-RPC */

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

let toolListCache: unknown[] | undefined;
export function mcpToolList() {
  return (toolListCache ??= AGENT_TOOL_NAMES.map((name) => {
    const meta = TOOL_META[name];
    return {
      name,
      title: meta.title,
      description: meta.description,
      inputSchema: toolInputSchema(name),
      annotations: {
        title: meta.title,
        readOnlyHint: meta.readOnly,
        destructiveHint: false,
        idempotentHint: meta.readOnly,
        openWorldHint: false,
      },
    };
  }));
}

export interface McpRequestMeta {
  headers: Headers;
}

interface CallState {
  /** Session id from the Mcp-Session-Id request header. */
  sessionId?: string;
  /** Set when this request created a session (sent back as Mcp-Session-Id). */
  newSessionId?: string;
  headers: Headers;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function contextFor(state: CallState): AgentContext {
  const current = state.sessionId ?? state.newSessionId;
  const known = current ? getMcpSession(current) : undefined;
  const who = identityFromHeaders(state.headers, known?.agentName);
  const sessionId = current ?? who.sessionId ?? `mcp_${hashId(who.agentId)}`;
  return {
    agentId: known && !state.headers.get("x-agent-id") ? known.agentId : who.agentId,
    agentName: who.agentName,
    sessionId,
    channel: "mcp",
    synthetic: syntheticFromHeaders(state.headers),
  };
}

function initialize(id: JsonRpcId, params: Record<string, unknown>, state: CallState): JsonRpcResponse {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
  const protocolVersion = requested && SUPPORTED_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSION;
  const clientInfo = isRecord(params.clientInfo) ? params.clientInfo : {};
  const clientName = typeof clientInfo.name === "string" ? clientInfo.name : undefined;
  const who = identityFromHeaders(state.headers, clientName);

  const sessionId = `mcp_${crypto.randomUUID()}`;
  const store = sessions();
  store.set(sessionId, {
    id: sessionId,
    agentId: who.agentId,
    agentName: who.agentName,
    client: { name: clientName, version: typeof clientInfo.version === "string" ? clientInfo.version : undefined },
    protocolVersion,
    createdAt: new Date().toISOString(),
  });
  if (store.size > MAX_MCP_SESSIONS) store.delete(store.keys().next().value!);
  state.newSessionId = sessionId;

  return ok(id, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: MCP_SERVER_INFO,
    instructions: INSTRUCTIONS,
  });
}

async function toolsCall(id: JsonRpcId, params: Record<string, unknown>, state: CallState): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string") return err(id, RPC.invalidParams, "tools/call requires params.name");
  if (!AGENT_TOOL_NAMES.includes(name as AgentToolName)) {
    return err(id, RPC.invalidParams, `Unknown tool: ${name}`, { available: AGENT_TOOL_NAMES });
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(args)) return err(id, RPC.invalidParams, "params.arguments must be an object");

  const result = await dispatchAgentTool(name as AgentToolName, args, contextFor(state));
  return ok(id, {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  });
}

/** Handle one JSON-RPC message. Returns null for notifications and client responses. */
async function handleMessage(msg: unknown, state: CallState): Promise<JsonRpcResponse | null> {
  if (!isRecord(msg)) return err(null, RPC.invalidRequest, "Invalid Request: expected a JSON-RPC object");
  const hasId = "id" in msg && msg.id !== undefined;
  const rawId = msg.id;
  if (hasId && rawId !== null && typeof rawId !== "string" && typeof rawId !== "number") {
    return err(null, RPC.invalidRequest, "Invalid Request: id must be a string or number");
  }
  const id = (hasId ? rawId : null) as JsonRpcId;

  if (typeof msg.method !== "string") {
    // A response to a server→client request (we never send any) — ignore.
    if ("result" in msg || "error" in msg) return null;
    return err(id, RPC.invalidRequest, "Invalid Request: missing method");
  }
  if (msg.jsonrpc !== undefined && msg.jsonrpc !== "2.0") return err(id, RPC.invalidRequest, 'Invalid Request: jsonrpc must be "2.0"');
  const params = msg.params === undefined ? {} : msg.params;
  if (!isRecord(params)) return hasId ? err(id, RPC.invalidParams, "params must be an object") : null;

  // Notifications (no id): notifications/initialized, notifications/cancelled, … → no response.
  if (!hasId) return null;

  try {
    switch (msg.method) {
      case "initialize":
        return initialize(id, params, state);
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: mcpToolList() });
      case "tools/call":
        return await toolsCall(id, params, state);
      default:
        return err(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error("[mcp] internal error", e);
    return err(id, RPC.internal, "Internal error");
  }
}

export interface McpHttpResult {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}

/**
 * Handle the body of a POST /api/mcp. `rawBody` is the request text.
 * 200 + JSON for requests, 202 (no body) when the message(s) were only notifications/responses.
 */
export async function handleMcpPost(rawBody: string, headers: Headers): Promise<McpHttpResult> {
  const state: CallState = { sessionId: headers.get("mcp-session-id")?.trim() || undefined, headers };
  const out = (status: number, body?: unknown): McpHttpResult => ({
    status,
    body,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(state.newSessionId ? { "Mcp-Session-Id": state.newSessionId } : {}),
    },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return out(400, err(null, RPC.parseError, "Parse error: body is not valid JSON"));
  }

  if (Array.isArray(parsed)) {
    if (!parsed.length) return out(400, err(null, RPC.invalidRequest, "Invalid Request: empty batch"));
    const responses: JsonRpcResponse[] = [];
    // Sequential on purpose: tool calls share a cart.
    for (const msg of parsed) {
      const r = await handleMessage(msg, state);
      if (r) responses.push(r);
    }
    return responses.length ? out(200, responses) : out(202);
  }

  const r = await handleMessage(parsed, state);
  return r ? out(200, r) : out(202);
}

/** Short self-description for GET /api/mcp (humans and curious agents). */
export function mcpDescription(origin: string) {
  return {
    name: MCP_SERVER_INFO.name,
    title: MCP_SERVER_INFO.title,
    version: MCP_SERVER_INFO.version,
    transport: "streamable-http (JSON responses, no SSE)",
    endpoint: `${origin}/api/mcp`,
    protocolVersion: MCP_PROTOCOL_VERSION,
    usage: "POST JSON-RPC 2.0: initialize → notifications/initialized → tools/list → tools/call. Send back the Mcp-Session-Id header.",
    tools: AGENT_TOOL_NAMES,
    docs: `${origin}/llms.txt`,
  };
}
