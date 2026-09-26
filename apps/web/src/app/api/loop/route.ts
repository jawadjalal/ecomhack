import { NextResponse, connection } from "next/server";
import type { LoopResponse } from "@/lib/contracts";
import { getLoopState } from "@/lib/optimizer";

/** GET /api/loop → LoopState (phase, generation, live spec, insights, proposal, history, log). */
export async function GET() {
  await connection(); // always read live state, never prerender
  return NextResponse.json<LoopResponse>(getLoopState(), { headers: { "cache-control": "no-store" } });
}
