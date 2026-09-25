/**
 * Self-improvement loop — public API. OWNED BY: optimizer PR. Keep these signatures stable.
 *
 * observe → diagnose → propose → experiment → decide → ship → (next generation)
 */
import type { LoopState } from "@/lib/contracts";
import { getLiveSpec } from "@/lib/spec/store";

export function getLoopState(): LoopState {
  // Placeholder until the optimizer PR lands.
  return {
    phase: "idle",
    autopilot: false,
    generation: 0,
    liveSpec: getLiveSpec(),
    insights: [],
    history: [],
    log: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Advance the loop by one phase. Returns the new state. */
export async function stepLoop(): Promise<LoopState> {
  return getLoopState();
}

export function setAutopilot(on: boolean): LoopState {
  return { ...getLoopState(), autopilot: on };
}

/** Reset everything (spec, experiments, events, loop) back to Gen 0. */
export async function resetLoop(): Promise<LoopState> {
  return getLoopState();
}
