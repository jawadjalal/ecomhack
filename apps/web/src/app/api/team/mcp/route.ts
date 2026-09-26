import { publicOrigin } from "@/lib/github";
import { handleTeamMcpPost, teamMcpDescription } from "@/lib/team/mcp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Protocol-Version",
};

/** POST /api/team/mcp — MCP tools team_ask, team_inbox, team_decide. Admin (the /api/team gate). */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 64_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Body too large" } }, { status: 413, headers: CORS });
  const res = await handleTeamMcpPost(text, publicOrigin(req));
  return Response.json(res.body, { status: res.status, headers: CORS });
}

export function GET(req: Request) {
  return Response.json(teamMcpDescription(publicOrigin(req)), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
