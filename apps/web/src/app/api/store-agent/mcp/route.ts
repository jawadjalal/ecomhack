import { allowIngest } from "@/lib/analytics/trust";
import { requestOrigin } from "@/lib/store-agent/acp";
import { endStoreMcpSession, handleStoreMcpPost, storeMcpDescription } from "@/lib/store-agent/mcp";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, X-Agent-Name",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

/**
 * POST /api/store-agent/mcp — the Whop store's agent as MCP tools (JSON-RPC 2.0, Streamable HTTP with JSON
 * responses): search_offers, get_offer, create_checkout, store_info. Public (outside agents), rate-limited.
 */
export async function POST(req: Request) {
  if (!allowIngest(req, 1)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests" } }, { status: 429, headers: CORS });
  const text = await req.text();
  if (text.length > 64_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Body too large" } }, { status: 413, headers: CORS });
  const res = await handleStoreMcpPost(text, req.headers, requestOrigin(req));
  return new Response(res.body !== undefined ? JSON.stringify(res.body) : null, { status: res.status, headers: { ...CORS, ...res.headers } });
}

/** GET: no SSE stream (405 for event-stream clients); a short description otherwise. */
export function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, DELETE, OPTIONS" } });
  return Response.json(storeMcpDescription(requestOrigin(req)), { headers: CORS });
}

/** DELETE with Mcp-Session-Id: end the session. */
export function DELETE(req: Request) {
  const id = req.headers.get("mcp-session-id");
  if (!id) return Response.json({ error: "Mcp-Session-Id header required" }, { status: 400, headers: CORS });
  endStoreMcpSession(id);
  return new Response(null, { status: 204, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
