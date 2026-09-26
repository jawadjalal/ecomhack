import { acpHttp, acpPreflight } from "@/lib/store-agent/acp";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /acp/checkout_sessions/:id — retrieve (shows "completed" once the Whop payment has arrived). */
export async function GET(req: Request, ctx: Ctx) {
  return acpHttp(req, "retrieve", (await ctx.params).id);
}

/** POST /acp/checkout_sessions/:id — update items (quantities) or buyer. */
export async function POST(req: Request, ctx: Ctx) {
  return acpHttp(req, "update", (await ctx.params).id);
}

export const OPTIONS = acpPreflight;
