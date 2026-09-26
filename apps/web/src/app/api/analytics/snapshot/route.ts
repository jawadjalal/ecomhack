import { storeSnapshot } from "@/lib/analytics/snapshot";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/snapshot
 * The numbers the console and the crew cite: real events on a connected store, labelled simulated
 * shoppers in demo mode. Never a mix of the two.
 */
export function GET() {
  return Response.json(storeSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
