/**
 * Minimal MCP client over Streamable HTTP (JSON-RPC 2.0, JSON or one-shot SSE responses).
 *
 *   const mcp = await connectMcp("https://store.example/api/mcp", { headers: { "x-agent-name": "me" } });
 *   mcp.tools;                                   // from tools/list
 *   await mcp.call("search_products", { query: "trail" });
 *
 * Used by scripts/grok-shopper.ts and the readiness certificate trial (which passes an SSRF-safe
 * `fetch`). Tool results are normalised to AgentToolResult: `{ ok, data?, error? }`.
 */
import type { AgentToolResult } from "./types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpConnectOptions {
  /** Extra headers on every request (x-agent-name, user-agent, …). */
  headers?: Record<string, string>;
  /** Swap in a guarded fetch (e.g. the readiness SSRF-safe one). Default: global fetch. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Per-request timeout. Default 15s. */
  timeoutMs?: number;
  clientName?: string;
}

export interface McpConnection {
  readonly sessionId?: string;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  tools: McpTool[];
  /** tools/call, normalised to AgentToolResult. Throws on transport or JSON-RPC errors. */
  call(name: string, args: Record<string, unknown>): Promise<AgentToolResult>;
  /** Raw JSON-RPC request (returns `result`). */
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** End the session (DELETE with Mcp-Session-Id). Never throws. */
  close(): Promise<void>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Turn a tools/call result into AgentToolResult (PACE-style results pass through unchanged). */
export function normaliseToolResult(result: Record<string, unknown>): AgentToolResult {
  const isError = result.isError === true;
  const structured = result.structuredContent;
  if (isObj(structured)) return typeof structured.ok === "boolean" ? (structured as unknown as AgentToolResult) : { ok: !isError, data: structured };
  const text = (result.content as { type: string; text?: string }[] | undefined)?.find((b) => b?.type === "text")?.text;
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    /* plain text */
  }
  if (isObj(parsed) && typeof parsed.ok === "boolean") return parsed as unknown as AgentToolResult;
  return isError ? { ok: false, error: typeof parsed === "string" ? parsed.slice(0, 500) : "tool error", data: parsed } : { ok: true, data: parsed };
}

export async function connectMcp(endpoint: string, opts: McpConnectOptions = {}): Promise<McpConnection> {
  const doFetch = opts.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const headers = opts.headers ?? {};
  let sessionId: string | undefined;
  let nextId = 1;

  const post = async (message: Record<string, unknown>): Promise<Response> => {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...headers,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    return res;
  };

  const request = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const res = await post({ jsonrpc: "2.0", id: nextId++, method, params });
    const text = await res.text();
    // Servers may answer with a one-shot SSE stream; take the first data line.
    const payload = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? (text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "")
      : text;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(payload);
    } catch {
      throw new Error(`${method}: HTTP ${res.status}, non-JSON response`);
    }
    if (msg.error) throw new Error(`${method}: ${msg.error.message} (${msg.error.code})`);
    return msg.result ?? {};
  };

  const init = await request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: opts.clientName ?? headers["x-agent-name"] ?? "darwin-mcp-client", version: "1.0.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }).then((r) => r.body?.cancel().catch(() => undefined));
  const listed = await request("tools/list");
  const tools = (Array.isArray(listed.tools) ? listed.tools : [])
    .filter((t): t is McpTool => isObj(t) && typeof t.name === "string")
    .map((t) => ({ name: t.name, description: typeof t.description === "string" ? t.description : undefined, inputSchema: t.inputSchema }));

  return {
    get sessionId() {
      return sessionId;
    },
    serverInfo: isObj(init.serverInfo) ? (init.serverInfo as McpConnection["serverInfo"]) : undefined,
    protocolVersion: typeof init.protocolVersion === "string" ? init.protocolVersion : undefined,
    tools,
    request,
    call: async (name, args) => normaliseToolResult(await request("tools/call", { name, arguments: args })),
    close: async () => {
      if (!sessionId) return;
      await doFetch(endpoint, { method: "DELETE", headers: { "mcp-session-id": sessionId, ...headers }, signal: AbortSignal.timeout(timeoutMs) })
        .then((r) => r.body?.cancel().catch(() => undefined))
        .catch(() => undefined);
    },
  };
}
