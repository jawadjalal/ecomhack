/**
 * Self-improvement loop — public API. OWNED BY: optimizer PR. Keep these signatures stable.
 *
 * observe → diagnose → propose → experiment → decide → ship → (next generation)
 *
 * The console drives the loop: `stepLoop()` advances exactly one phase; when `autopilot` is on the
 * console simply keeps calling it. See ./loop.ts for the state machine.
 */
import type { LoopState } from "@/lib/contracts";
import {
  getLoopState as getState,
  resetLoop as reset,
  rollbackTo as rollback,
  setAutopilot as setPilot,
  stepLoop as step,
} from "./loop";

export function getLoopState(): LoopState {
  return getState();
}

/** Advance the loop by one phase. Returns the new state. Concurrent calls return the current state. */
export async function stepLoop(): Promise<LoopState> {
  return step();
}

/** Persist the autopilot flag (the console keeps stepping while it's on). */
export function setAutopilot(on: boolean): LoopState {
  return setPilot(on);
}

/** Reset everything (spec, experiments, events, agent sessions, loop) back to Gen 0. */
export async function resetLoop(): Promise<LoopState> {
  return reset();
}

/**
 * Put generation `generation`'s store back live (as a new version and a new history record), stop any
 * running test, and open a PR restoring the config when GitHub is live. Throws RollbackError
 * (status 400 unknown generation / 409 nothing to change).
 */
export async function rollbackTo(generation: number): Promise<LoopState> {
  return rollback(generation);
}

export { RollbackError } from "./loop";

// Building blocks, for the console / PR body / tests.
export { diagnose, refineInsightsWithLlm, insightKind, type InsightKind } from "./insights";
export { propose, proposeWithLlm, IDEAS, PLAYBOOK } from "./proposals";
export { comparePosteriors, decide, evaluateArms, evaluateExperiment, experimentArms, DEFAULT_DECISION } from "./stats";
export { loopConfigFromEnv, type LoopConfig, type LoopOverrides } from "./loop";
