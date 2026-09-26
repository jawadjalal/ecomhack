import { CORS_HEADERS, json, preflight, publicOrigin } from "@/lib/agent-commerce/http";
import { deleteMcpSession, handleMcpPost, mcpDescription } from "@/lib/agent-commerce/mcp";

/** POST /api/mcp: MCP Streamable HTTP (JSON-RPC 2.0, JSON responses). */
export async function POST(req: Request) {
  const res = await handleMcpPost(await req.text(), req.headers);
  return new Response(res.body !== undefined ? JSON.stringify(res.body) : null, {
    status: res.status,
    headers: { ...CORS_HEADERS, ...res.headers },
  });
}

/** GET /api/mcp: no SSE stream (405 for event-stream clients); a short description otherwise. */
export async function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, DELETE, OPTIONS" } });
  }
  return json(mcpDescription(publicOrigin(req)));
}

/** DELETE /api/mcp with Mcp-Session-Id: end the session. */
export async function DELETE(req: Request) {
  const id = req.headers.get("mcp-session-id");
  if (!id) return json({ error: "Mcp-Session-Id header required" }, { status: 400 });
  deleteMcpSession(id);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export const OPTIONS = preflight;
