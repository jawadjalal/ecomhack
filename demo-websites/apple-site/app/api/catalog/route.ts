import { agentCatalog } from "@/lib/agent-view";
import { getSpec } from "@/lib/spec";

/** GET /api/catalog: the agent-facing catalogue. What it reveals is set by the PageSpec's agentSurface. */
export async function GET() {
  const { spec } = await getSpec();
  return Response.json(agentCatalog(spec), { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
