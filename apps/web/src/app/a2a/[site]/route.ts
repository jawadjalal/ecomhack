import { allowIngest } from "@/lib/analytics/trust";
import { handleA2a, storeAgentCard } from "@/lib/store-agent";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Agent-Name, A2A-Version",
};

function origin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const notFound = () => Response.json({ error: "Unknown store. The connected Whop store's agent is at /a2a/whop." }, { status: 404, headers: CORS });

/**
 * POST /a2a/whop — the Whop store's agent (A2A JSON-RPC: SendMessage v1.0 or message/send v0.3). Public:
 * any buyer agent can shop. GET returns its agent card.
 */
export async function POST(req: Request, ctx: RouteContext<"/a2a/[site]">) {
  if ((await ctx.params).site !== "whop") return notFound();
  if (!allowIngest(req, 1)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests" } }, { status: 429, headers: CORS });
  const text = await req.text();
  if (text.length > 32_000) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Body too large" } }, { status: 413, headers: CORS });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  const agentName = req.headers.get("x-agent-name")?.slice(0, 60) || undefined;
  return Response.json(await handleA2a(body, { origin: origin(req), agentName }), { headers: CORS });
}

export async function GET(req: Request, ctx: RouteContext<"/a2a/[site]">) {
  if ((await ctx.params).site !== "whop") return notFound();
  return Response.json(await storeAgentCard(origin(req)), { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
