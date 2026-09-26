import { eventStore } from "@/lib/analytics/store";
import { agentFunnel, getCatalog } from "@/lib/store-agent";

export const dynamic = "force-dynamic";

/** GET /api/store-agent/stats?fresh=1 → { catalog, funnel }: the store agent's catalog and its sales funnel. */
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return Response.json({ catalog: await getCatalog({ fresh }), funnel: agentFunnel(eventStore().all()) });
}
