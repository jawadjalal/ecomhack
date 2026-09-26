/**
 * MCP server for Darwin's team (JSON-RPC 2.0, JSON responses, no SSE). OWNED BY: team.
 *
 * Tools: team_ask, team_inbox, team_decide. Admin token only — this is the merchant's team, not the shop.
 * The shopper MCP at /api/mcp stays public and is not given these tools.
 */
import { teamAsk, teamDecide, teamInbox } from "./remote";

export const TEAM_MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const TEAM_MCP_SERVER_INFO = { name: "darwin-team", title: "Darwin's team", version: "1.0.0" } as const;

export const TEAM_MCP_TOOLS = [
  {
    name: "team_ask",
    title: "Ask Darwin",
    description: "Ask the merchant's Darwin team something about the store. Darwin may delegate to Iris, Pixel, Fizz or Dash. Returns his reply. Side effects still wait for team_decide.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "What the merchant wants to ask." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "team_inbox",
    title: "Darwin's inbox",
    description: "Proactive messages Darwin sent the merchant, newest last, with one-tap action tokens that are still open.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Only messages after this ISO timestamp." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "team_decide",
    title: "Decide a one-tap action",
    description: "Spend one action token from team_inbox (single use, bound to the action Darwin proposed, expires in 24h). approved=false records a no.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "The action token from team_inbox." },
        approved: { type: "boolean", description: "True to run it, false to decline." },
      },
      required: ["token", "approved"],
      additionalProperties: false,
    },
  },
] as const;

const TOOL_NAMES: string[] = TEAM_MCP_TOOLS.map((t) => t.name);
const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602 } as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Rpc {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const ok = (id: Rpc["id"], result: unknown): Rpc => ({ jsonrpc: "2.0", id, result });
const err = (id: Rpc["id"], code: number, message: string): Rpc => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(name: string, args: Record<string, unknown>, origin: string): Promise<{ text: string; data: unknown; isError?: boolean }> {
  if (name === "team_ask") {
    const text = typeof args.text === "string" ? args.text.trim() : "";
    if (!text) return { text: "text is required.", data: {}, isError: true };
    const reply = await teamAsk(text.slice(0, 2000), origin);
    return { text: reply.text, data: reply };
  }
  if (name === "team_inbox") {
    const since = typeof args.since === "string" ? args.since : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const inbox = teamInbox({ since, limit });
    const lines = inbox.messages.slice(-5).map((m) => m.text);
    return { text: lines.length ? lines.join("\n\n") : "Darwin's inbox is empty.", data: inbox };
  }
  if (name === "team_decide") {
    const token = typeof args.token === "string" ? args.token.trim() : "";
    if (!token || typeof args.approved !== "boolean") return { text: "token and approved are required.", data: {}, isError: true };
    const res = await teamDecide(token, args.approved, origin);
    return { text: res.text, data: res, isError: !res.ok && args.approved };
  }
  return { text: `Unknown tool ${name}.`, data: {}, isError: true };
}

async function handleMessage(msg: unknown, origin: string): Promise<Rpc | null> {
  if (!isRecord(msg)) return err(null, RPC.invalidRequest, "Invalid Request");
  const id = (typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null) as Rpc["id"];
  if (typeof msg.method !== "string") return err(id, RPC.invalidRequest, "Invalid Request: missing method");
  const params = isRecord(msg.params) ? msg.params : {};
  if (msg.method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    return ok(id, {
      protocolVersion: SUPPORTED.includes(requested) ? requested : TEAM_MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: TEAM_MCP_SERVER_INFO,
      instructions: "You are remoting the merchant's Darwin team. team_inbox to see what Darwin noticed, team_decide to approve an action token, team_ask to talk to him. Never invent numbers he didn't give you.",
    });
  }
  if (msg.method === "notifications/initialized" || msg.method === "ping") return msg.method === "ping" ? ok(id, {}) : null;
  if (msg.method === "tools/list") {
    return ok(id, { tools: TEAM_MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (msg.method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string" || !TOOL_NAMES.includes(name)) return err(id, RPC.invalidParams, `Unknown tool: ${String(name)}`);
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isRecord(args)) return err(id, RPC.invalidParams, "arguments must be an object");
    const out = await callTool(name, args, origin);
    return ok(id, { content: [{ type: "text", text: out.text }], structuredContent: out.data, isError: !!out.isError });
  }
  return err(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
}

export async function handleTeamMcpPost(text: string, origin: string): Promise<{ status: number; body: unknown }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 400, body: err(null, RPC.parseError, "Parse error") };
  }
  if (Array.isArray(parsed)) {
    const replies = (await Promise.all(parsed.slice(0, 10).map((m) => handleMessage(m, origin)))).filter((r): r is Rpc => r !== null);
    return { status: 200, body: replies };
  }
  const reply = await handleMessage(parsed, origin);
  return { status: 200, body: reply ?? { jsonrpc: "2.0", id: null, result: {} } };
}

export function teamMcpDescription(origin: string) {
  return { name: TEAM_MCP_SERVER_INFO.name, url: `${origin}/api/team/mcp`, tools: TOOL_NAMES, auth: "Authorization: Bearer <DARWIN_ADMIN_TOKEN>" };
}
