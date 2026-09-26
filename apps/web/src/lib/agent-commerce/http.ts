/**
 * HTTP helpers for the agent REST routes and the MCP endpoint: identity, CORS, responses.
 */
import { classifyVisitor } from "@/lib/analytics/classify";
import { dispatchAgentTool } from "./dispatcher";
import type { AgentContext, AgentToolErrorCode, AgentToolName, AgentToolResult } from "./types";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, X-Agent-Id, X-Agent-Name, X-Agent-Session, X-Darwin-Synthetic, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "X-Agent-Id, X-Agent-Session, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** OPTIONS handler for every agent-facing route. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { ...CORS_HEADERS, ...init.headers } });
}

/** Short stable id from a string (FNV-1a, base36). */
export function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface AgentIdentity {
  agentId: string;
  agentName: string;
  /** From `x-agent-session`, when the agent sent one. */
  sessionId?: string;
}

const clip = (v: string | null | undefined, n: number) => v?.trim().slice(0, n) || undefined;

/**
 * Who is calling: `x-agent-id` (else a hash of user-agent + IP), `x-agent-name` (else the MCP
 * client name, else a user-agent classification), `x-agent-session`.
 */
export function identityFromHeaders(headers: Headers, fallbackName?: string): AgentIdentity {
  const ua = headers.get("user-agent") ?? "";
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
  const agentName =
    clip(headers.get("x-agent-name"), 64) ??
    clip(fallbackName, 64) ??
    classifyVisitor({ userAgent: ua }).agentName ??
    "anonymous-agent";
  return {
    agentId: clip(headers.get("x-agent-id"), 128) ?? `agt_${hashId(`${ua}|${ip}`)}`,
    agentName,
    sessionId: clip(headers.get("x-agent-session"), 128),
  };
}

/** Scripted clients we run ourselves (e.g. `scripts/grok-shopper.ts --scripted`) send `x-darwin-synthetic: 1`. */
export function syntheticFromHeaders(headers: Headers): boolean {
  return headers.get("x-darwin-synthetic") === "1";
}

/** Context for a REST call. Without `x-agent-session` the session is stable per agent id. */
export function restContext(req: Request): AgentContext {
  const who = identityFromHeaders(req.headers);
  const fromQuery = clip(new URL(req.url).searchParams.get("session"), 128);
  return {
    agentId: who.agentId,
    agentName: who.agentName,
    sessionId: who.sessionId ?? fromQuery ?? `ses_${hashId(who.agentId)}`,
    channel: "rest",
    synthetic: syntheticFromHeaders(req.headers),
  };
}

const STATUS: Partial<Record<AgentToolErrorCode, number>> = { invalid_args: 400, not_found: 404, unknown_tool: 404 };

/**
 * Tool results map to HTTP: 200 for success and business-level refusals (read `ok`/`missing`),
 * 400 bad args, 404 unknown product, 500 internal errors.
 */
export function toolResponse(result: AgentToolResult, ctx: AgentContext): Response {
  const status = result.ok ? 200 : result.code ? (STATUS[result.code] ?? 200) : 500;
  return json(result, { status, headers: { "X-Agent-Id": ctx.agentId, "X-Agent-Session": ctx.sessionId } });
}

/** Parse a JSON object body. Empty body → {}. Invalid JSON → null. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Run a tool for a REST request and shape the HTTP response. */
export async function runRestTool(req: Request, tool: AgentToolName, args: Record<string, unknown>): Promise<Response> {
  const ctx = restContext(req);
  return toolResponse(await dispatchAgentTool(tool, args, ctx), ctx);
}

/** REST POST helper: parse the body, then run the tool. */
export async function runRestToolFromBody(req: Request, tool: AgentToolName): Promise<Response> {
  const body = await readJsonObject(req);
  if (body === null) return json({ ok: false, code: "invalid_args", error: "Body must be a JSON object." }, { status: 400 });
  return runRestTool(req, tool, body);
}

/** Origin for absolute URLs in discovery docs (respects proxies). */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
