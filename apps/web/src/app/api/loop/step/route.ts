import { NextResponse } from "next/server";
import type { LoopResponse } from "@/lib/contracts";
import { stepLoop } from "@/lib/optimizer";

/** Simulating a round of traffic can take a few seconds. */
export const maxDuration = 60;

/** POST /api/loop/step → LoopState after advancing one phase (no-op if a step is already running). */
export async function POST() {
  const state = await stepLoop();
  return NextResponse.json<LoopResponse>(state, { headers: { "cache-control": "no-store" } });
}
