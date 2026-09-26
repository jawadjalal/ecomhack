import { NextResponse } from "next/server";
import type { DemoResponse } from "@/lib/contracts";
import { demoStatus, ensureDemoStore } from "@/lib/demo";

export const dynamic = "force-dynamic";
/** Seeding a fresh store runs the loop to Gen 1 and starts a test: a few seconds, more with an LLM key. */
export const maxDuration = 60;

/** GET /api/demo → DemoResponse: demo store or connected site, and whether the demo store has shoppers yet. */
export function GET() {
  return NextResponse.json<DemoResponse>({ status: demoStatus() }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/demo → DemoResponse: "explore with the demo store". Makes sure the console has something true to
 * show about /store (see lib/demo): runs the loop to Gen 1 with a test live on a fresh store, or sends one round
 * of simulated shoppers after a restart. Idempotent; every event it creates is labelled synthetic.
 */
export async function POST() {
  const { action, steps, status } = await ensureDemoStore();
  return NextResponse.json<DemoResponse>({ status, action, steps }, { headers: { "cache-control": "no-store" } });
}
