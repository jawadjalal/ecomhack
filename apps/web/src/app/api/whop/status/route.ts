import { getWhopStatus } from "@/lib/whop";

export const dynamic = "force-dynamic";

/** GET /api/whop/status → WhopStatus ({ configured, connection? }). */
export function GET() {
  return Response.json(getWhopStatus());
}
