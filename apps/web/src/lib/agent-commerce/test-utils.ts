/**
 * Test helpers (imported by *.test.ts only).
 */
import type { PageSpec, SpecPatch } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { resetExperiments } from "@/lib/experiments/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { promoteSpec, resetSpec } from "@/lib/spec/store";
import { resetAgentCommerce } from "./index";
import type { AgentContext } from "./types";

/** Every agent-surface flag on, 15% max discount. */
export const OPEN_SURFACE: SpecPatch = {
  agentSurface: {
    structuredData: true,
    exposeStock: true,
    exposeDeliveryEta: true,
    exposeReturnPolicy: true,
    exposeLandedPrice: true,
    negotiation: { enabled: true, maxDiscountPct: 15 },
  },
};

export function resetWorld() {
  resetSpec();
  resetExperiments();
  eventStore().clear();
  resetAgentCommerce();
}

/** Make `patch` (applied to Gen 0) the live spec. */
export function useSpec(patch: SpecPatch): PageSpec {
  return promoteSpec(applyPatch(DEFAULT_SPEC, patch), "test");
}

export function ctx(n: string | number, extra: Partial<AgentContext> = {}): AgentContext {
  return { agentId: `agt_test_${n}`, agentName: "test-agent", sessionId: `ses_test_${n}`, synthetic: true, ...extra };
}

export function eventsNamed(name: string) {
  return eventStore()
    .all()
    .filter((e) => e.event === name);
}
