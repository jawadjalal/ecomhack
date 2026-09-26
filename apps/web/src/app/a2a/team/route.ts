import { publicOrigin } from "@/lib/github";
import { handleTeamA2a, teamA2aAuthorized, teamAgentCard } from "@/lib/team/a2a";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, A2A-Version",
};

const unauthorized = () =>
  Response.json({ error: "Darwin's team needs Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401, headers: CORS });

/** GET /a2a/team → the agent card. Admin. */
export async function GET(req: Request) {
  if (!teamA2aAuthorized(req.headers.get("authorization"))) return unauthorized();
  return Response.json(teamAgentCard(publicOrigin(req)), { headers: { ...CORS, "cache-control": "no-store" } });
}

/** POST /a2a/team → ask Darwin, read the inbox, or decide an action token. Admin. */
export async function POST(req: Request) {
  if (!teamA2aAuthorized(req.headers.get("authorization"))) return unauthorized();
  const text = await req.text();
  if (text.length > 32_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Body too large" } }, { status: 413, headers: CORS });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  return Response.json(await handleTeamA2a(body, { origin: publicOrigin(req) }), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
