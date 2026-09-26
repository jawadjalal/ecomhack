import { NextResponse } from "next/server";
import { z } from "zod";
import type { LoopResponse } from "@/lib/contracts";
import { RollbackError, rollbackTo } from "@/lib/optimizer";

/** Opening a revert PR can take a few seconds when GitHub is live. */
export const maxDuration = 60;

const Body = z.object({ generation: z.number().int().min(0) });

/**
 * POST /api/loop/rollback { generation } → LoopState.
 * Puts that generation's store back live as a new version, stops any running test, records the
 * rollback in history (and opens a revert PR when GitHub is live). Admin-gated with /api/loop.
 * 400 = unknown generation / bad body, 409 = nothing to change.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected JSON body { generation: number }" }, { status: 400 });
  }
  try {
    const state = await rollbackTo(parsed.data.generation);
    return NextResponse.json<LoopResponse>(state, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof RollbackError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[loop] rollback failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
