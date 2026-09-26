import { NextResponse } from "next/server";
import { simulateTraffic } from "@/lib/simulator";
import { SimulationOptionsSchema } from "@/lib/simulator/schema";
import { KNOB_EFFECTS, PERSONA_PROFILES } from "@/lib/simulator/behavior-model";
import { AGENT_GOAL_MIX, AGENT_NAMES } from "@/lib/simulator/agents";

/**
 * POST /api/simulate  body SimulationOptions → SimulationResult
 * Generates synthetic (clearly labelled) human + agent traffic against the live spec / running
 * experiment. Route handlers other than GET are never cached, so this always runs per request.
 * humans ≤ 5000 and agents ≤ 1000 per call (larger values are clamped).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let body: unknown = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
  }
  const parsed = SimulationOptionsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json(await simulateTraffic(parsed.data));
}

/** GET /api/simulate → the behaviour model, for "is the traffic real?" transparency in the console. */
export async function GET() {
  return NextResponse.json({
    synthetic: true,
    personas: Object.values(PERSONA_PROFILES).map(({ id, description, share, devices }) => ({ id, description, share, devices })),
    effects: KNOB_EFFECTS.map(({ id, knob, stage, rationale }) => ({ id, knob, stage, rationale })),
    agents: { names: AGENT_NAMES, goalMix: AGENT_GOAL_MIX },
  });
}
