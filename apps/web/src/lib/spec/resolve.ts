/**
 * Resolve which PageSpec a given visitor sees, taking the running experiment into account.
 * Used by the storefront (humans), the agent API (agents) and the simulator.
 */
import type { PageSpec } from "@/lib/contracts";
import { getLiveSpec } from "./store";
import { getRunningExperiment } from "@/lib/experiments/store";
import { assignVariant } from "@/lib/experiments/assign";

export interface ResolvedSpec {
  spec: PageSpec;
  experimentId?: string;
  variant?: "control" | "treatment";
}

export function resolveSpecForVisitor(distinctId: string, forceVariant?: "control" | "treatment"): ResolvedSpec {
  const live = getLiveSpec();
  const exp = getRunningExperiment();
  if (!exp) return { spec: live };
  const variant = forceVariant ?? assignVariant(distinctId, exp.id, exp.allocation);
  return {
    spec: variant === "treatment" ? exp.treatmentSpec : live,
    experimentId: exp.id,
    variant,
  };
}

/** Properties to stamp on every event so analytics can attribute it. */
export function attributionProps(resolved: ResolvedSpec) {
  return {
    spec_version: resolved.spec.version,
    ...(resolved.experimentId ? { experiment_id: resolved.experimentId, variant: resolved.variant } : {}),
  };
}
