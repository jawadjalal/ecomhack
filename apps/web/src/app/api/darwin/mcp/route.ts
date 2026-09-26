import { requestOrigin } from "@/lib/github";
import { darwinMcpDescription, handleDarwinMcpPost } from "./handler";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Cache-Control": "no-store",
};

/**
 * POST /api/darwin/mcp — Darwin mission control as MCP tools (JSON-RPC 2.0, Streamable HTTP with JSON responses):
 * darwin_state, darwin_pages and every lib/commands command as darwin_<name>. Admin-gated (proxy + handler).
 */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 64_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Body too large" } }, { status: 413, headers: HEADERS });
  const res = await handleDarwinMcpPost(text, req.headers, requestOrigin(req));
  return new Response(res.body !== undefined ? JSON.stringify(res.body) : null, {
    status: res.status,
    headers: { ...HEADERS, ...(res.body !== undefined ? { "Content-Type": "application/json" } : {}) },
  });
}

/** GET: no SSE stream (405 for event-stream clients); a short description otherwise. */
export function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "POST, OPTIONS" } });
  return Response.json(darwinMcpDescription(requestOrigin(req)), { headers: HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
