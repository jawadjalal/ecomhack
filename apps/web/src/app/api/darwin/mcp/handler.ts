/**
 * Darwin control MCP server (Streamable HTTP, JSON-RPC 2.0, JSON responses, stateless): every console command
 * as a `darwin_<name>` tool, plus read-only views (darwin_state, darwin_pages). Tools run headlessly through
 * lib/commands/server-run.ts against the origin the request arrived on, forwarding its Authorization / Cookie.
 *
 * Admin-only: the proxy gates /api/darwin (lib/auth/admin.ts) and this handler checks the credential again.
 */
import { bearer, isAdminCredential, ADMIN_COOKIE } from "@/lib/auth/admin";
import { darwinPages, darwinState, headlessInputSchema, runCommandHeadless, type HeadlessOptions } from "@/lib/commands/server-run";
import { COMMAND_NAMES, resolveCommand, specOf } from "@/lib/commands/specs";
import type { CommandName, CommandResult } from "@/lib/commands/types";

export const DARWIN_MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const DARWIN_MCP_SERVER_INFO = { name: "darwin", title: "Darwin mission control", version: "0.1.0" } as const;

const INSTRUCTIONS =
  "Darwin is a storefront that improves itself: it watches humans and AI shopping agents, finds conversion issues, " +
  "A/B tests page changes and ships winners. These tools drive the Darwin console. Start with darwin_state (loop, KPIs, " +
  "running tests) and darwin_pages (every page with its URL). Simulated traffic is always labelled synthetic. " +
  "Tools marked destructive (darwin_rollback, darwin_act_on_briefing) change what shoppers see: call them once without " +
  "`confirm` to get the question, ask the merchant, then call again with confirm: true. Money is in pounds in text, pence in data.";

const MAX_BATCH = 20;

type JsonRpcId = string | number | null;
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unauthorized: -32001 } as const;

const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/* ------------------------------------------------------------------ tools */

export const TOOL_PREFIX = "darwin_";
const VIEW_TOOLS = ["darwin_state", "darwin_pages"] as const;

export interface DarwinMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

function commandTool(name: CommandName): DarwinMcpTool {
  const s = specOf(name);
  const confirm = s.risk === "confirm";
  let description = s.description;
  if (name === "whats_left") description += " Omit area for the whole roadmap (every area, its status and what's left).";
  if (confirm) description += " Needs the merchant's approval: without confirm: true it only returns the question to ask.";
  if (name === "navigate") description += " Headless: returns the page's absolute URL to open.";
  return {
    name: `${TOOL_PREFIX}${name}`,
    title: s.title,
    description,
    inputSchema: headlessInputSchema(name),
    annotations: { title: s.title, readOnlyHint: !!s.readOnly, destructiveHint: confirm, idempotentHint: !!s.readOnly, openWorldHint: false },
  };
}

const VIEW_META: Record<(typeof VIEW_TOOLS)[number], Omit<DarwinMcpTool, "name">> = {
  darwin_state: {
    title: "Darwin state",
    description:
      "Read-only snapshot: the self-improvement loop (live generation, phase, autopilot, top issues), KPIs for all traffic and real-only traffic (visitors, orders, revenue, conversion for humans vs AI agents) and every running A/B test (store page, darwin.js sites, store agent). Call it first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Darwin state", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  darwin_pages: {
    title: "Darwin pages",
    description: "Read-only: every page of Darwin (console, storefront, onboarding, agent endpoints) with its absolute URL and what it's for.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Darwin pages", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
};

let toolCache: DarwinMcpTool[] | undefined;
export function darwinMcpTools(): DarwinMcpTool[] {
  return (toolCache ??= [...VIEW_TOOLS.map((name) => ({ name, ...VIEW_META[name] })), ...COMMAND_NAMES.map(commandTool)]);
}

function toolResult(r: CommandResult) {
  const text = r.href && !r.text.includes(r.href) ? `${r.text}\n${r.linkLabel ?? "Open"}: ${r.href}` : r.text;
  return { content: [{ type: "text", text: r.synthetic ? `${text}\n(Includes simulated traffic, labelled synthetic.)` : text }], structuredContent: r, isError: !r.ok };
}

async function toolsCall(id: JsonRpcId, params: Record<string, unknown>, opts: HeadlessOptions): Promise<JsonRpcResponse> {
  const name = params.name;
  if (typeof name !== "string") return err(id, RPC.invalidParams, "tools/call requires params.name");
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isRecord(args)) return err(id, RPC.invalidParams, "params.arguments must be an object");

  if (name === "darwin_state") return ok(id, toolResult(await darwinState(opts)));
  if (name === "darwin_pages") {
    const pages = darwinPages(opts.origin);
    return ok(id, toolResult({ ok: true, text: pages.map((p) => `${p.label}: ${p.url} (${p.purpose})`).join("\n"), data: { pages } }));
  }
  const command = resolveCommand(name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name);
  if (!command) return err(id, RPC.invalidParams, `Unknown tool: ${name}`, { available: darwinMcpTools().map((t) => t.name) });
  return ok(id, toolResult(await runCommandHeadless(command, args, opts)));
}

function initialize(id: JsonRpcId, params: Record<string, unknown>): JsonRpcResponse {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
  const protocolVersion = requested && SUPPORTED_VERSIONS.includes(requested) ? requested : DARWIN_MCP_PROTOCOL_VERSION;
  return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: DARWIN_MCP_SERVER_INFO, instructions: INSTRUCTIONS });
}

async function handleMessage(msg: unknown, opts: HeadlessOptions): Promise<JsonRpcResponse | null> {
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
  if (!hasId) return null; // notifications

  try {
    switch (msg.method) {
      case "initialize":
        return initialize(id, params);
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: darwinMcpTools() });
      case "tools/call":
        return await toolsCall(id, params, opts);
      default:
        return err(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error("[darwin-mcp] internal error", e);
    return err(id, RPC.internal, "Internal error");
  }
}

/** Admin credential from the request: the console cookie or `Authorization: Bearer <DARWIN_ADMIN_TOKEN>`. */
export function isAdminRequest(headers: Headers): boolean {
  const cookie = headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  return isAdminCredential(cookie ? decodeURIComponent(cookie) : bearer(headers.get("authorization")));
}

export interface DarwinMcpHttpResult {
  status: number;
  body?: unknown;
}

/** Handle a POST body. 200 + JSON for requests, 202 (no body) for notifications only, 401 without admin. */
export async function handleDarwinMcpPost(rawBody: string, headers: Headers, origin: string, fetchImpl?: typeof fetch): Promise<DarwinMcpHttpResult> {
  if (!isAdminRequest(headers)) {
    return { status: 401, body: err(null, RPC.unauthorized, "Unauthorized: send Authorization: Bearer <DARWIN_ADMIN_TOKEN>.") };
  }
  const opts: HeadlessOptions = { origin, headers, fetch: fetchImpl };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: err(null, RPC.parseError, "Parse error: body is not valid JSON") };
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: err(null, RPC.invalidRequest, "Invalid Request: empty batch") };
    if (parsed.length > MAX_BATCH) return { status: 400, body: err(null, RPC.invalidRequest, `Invalid Request: batch too large (max ${MAX_BATCH})`) };
    const responses: JsonRpcResponse[] = [];
    for (const msg of parsed) {
      const r = await handleMessage(msg, opts);
      if (r) responses.push(r);
    }
    return responses.length ? { status: 200, body: responses } : { status: 202 };
  }
  const r = await handleMessage(parsed, opts);
  return r ? { status: 200, body: r } : { status: 202 };
}

/** GET /api/darwin/mcp: a short description for humans and curious agents. */
export function darwinMcpDescription(origin: string) {
  return {
    name: DARWIN_MCP_SERVER_INFO.name,
    title: DARWIN_MCP_SERVER_INFO.title,
    version: DARWIN_MCP_SERVER_INFO.version,
    transport: "streamable-http (JSON responses, no SSE, stateless)",
    endpoint: `${origin}/api/darwin/mcp`,
    protocolVersion: DARWIN_MCP_PROTOCOL_VERSION,
    auth: "Admin: Authorization: Bearer <DARWIN_ADMIN_TOKEN> when a token is set.",
    usage: "POST JSON-RPC 2.0: initialize → tools/list → tools/call.",
    tools: darwinMcpTools().map((t) => t.name),
  };
}
