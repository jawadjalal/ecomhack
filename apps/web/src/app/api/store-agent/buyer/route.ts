import { z } from "zod";
import { runSimulatedBuyer } from "@/lib/store-agent";

function origin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** POST /api/store-agent/buyer { brief } → a simulated buyer agent's whole purchase (labelled synthetic). */
export async function POST(req: Request) {
  const parsed = z.object({ brief: z.string().trim().min(3).max(300) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Body must be { brief }" }, { status: 400 });
  return Response.json(await runSimulatedBuyer(parsed.data.brief, origin(req)));
}
