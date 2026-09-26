import { preflight, runRestTool, runRestToolFromBody } from "@/lib/agent-commerce/http";

/** POST /api/agent/availability { id, size } → AgentToolResult<AvailabilityView> (check_availability). */
export async function POST(req: Request) {
  return runRestToolFromBody(req, "check_availability");
}

/** GET /api/agent/availability?id=&size= (same as POST, for simple clients). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return runRestTool(req, "check_availability", { id: q.get("id") ?? "", size: q.get("size") ?? "" });
}

export const OPTIONS = preflight;
