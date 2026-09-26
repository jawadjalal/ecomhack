import { buildLlmsTxt } from "@/lib/agent-commerce/discovery";
import { CORS_HEADERS, identityFromHeaders, preflight, publicOrigin } from "@/lib/agent-commerce/http";
import { resolveSpecForVisitor } from "@/lib/spec/resolve";

export const dynamic = "force-dynamic";

/** GET /llms.txt: how AI agents shop this store, reflecting the spec the caller would be served. */
export async function GET(req: Request) {
  const { spec } = resolveSpecForVisitor(identityFromHeaders(req.headers).agentId);
  return new Response(buildLlmsTxt(publicOrigin(req), spec), {
    headers: { ...CORS_HEADERS, "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const OPTIONS = preflight;
