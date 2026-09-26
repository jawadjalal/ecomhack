import { NextResponse } from "next/server";
import type { LoopResponse } from "@/lib/contracts";
import { resetLoop } from "@/lib/optimizer";

/** POST /api/loop/reset → LoopState. Clears events, experiments, agent sessions and spec back to Gen 0. */
export async function POST() {
  return NextResponse.json<LoopResponse>(await resetLoop(), { headers: { "cache-control": "no-store" } });
}
