import { NextResponse } from "next/server";
import { z } from "zod";
import type { LoopResponse } from "@/lib/contracts";
import { setAutopilot } from "@/lib/optimizer";

const Body = z.object({ on: z.boolean() });

/** POST /api/loop/autopilot { on: boolean } → LoopState. The console keeps stepping while it's on. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected JSON body { on: boolean }" }, { status: 400 });
  }
  return NextResponse.json<LoopResponse>(setAutopilot(parsed.data.on), { headers: { "cache-control": "no-store" } });
}
