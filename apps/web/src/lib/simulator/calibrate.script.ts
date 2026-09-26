/**
 * Calibration table for the behaviour model (not part of the app or the test suite).
 *
 *   cd apps/web && DARWIN_PERSIST=0 DARWIN_MAX_EVENTS=5000000 npx tsx src/lib/simulator/calibrate.script.ts
 *
 * Every row reuses the same seed, so each synthetic visitor is the same person on every spec and
 * differences come from the page alone. N / A env vars set humans / agents per row.
 */
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { promoteSpec, resetSpec } from "@/lib/spec/store";
import { eventStore } from "@/lib/analytics/store";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import { runSimulation } from "@/lib/simulator";
import { bestKnownSpec, SINGLE_KNOB_CHANGES } from "@/lib/simulator/behavior-model";
import type { PageSpec, SpecPatch } from "@/lib/contracts";

const N = Number(process.env.N ?? 20000);
const A = Number(process.env.A ?? 4000);

async function measure(spec: PageSpec, seed = Number(process.env.SEED ?? 7)) {
  resetSpec();
  if (spec !== DEFAULT_SPEC) promoteSpec(spec, spec.label);
  eventStore().clear();
  const t0 = performance.now();
  const r = await runSimulation({ humans: N, agents: A, seed }, { agentDriver: "builtin" });
  const ms = performance.now() - t0;
  const s = getAnalyticsSummary();
  return { h: s.byKind.human, a: s.byKind.agent, ms, r };
}

const pct = (x: number) => (100 * x).toFixed(2) + "%";
const rows: [string, SpecPatch | "best" | null][] = [
  ["DEFAULT_SPEC", null],
  ...SINGLE_KNOB_CHANGES.map((c) => [c.name, c.patch] as [string, SpecPatch]),
  ["urgency low-stock", { productPage: { urgency: "low-stock" } }],
  ["cart upsell", { cart: { upsell: true } }],
  ["quick add", { productGrid: { showQuickAdd: true } }],
  ["size guide", { productPage: { showSizeGuide: true } }],
  ["delivery estimate", { productPage: { showDeliveryEstimate: true } }],
  ["returns policy", { productPage: { showReturnsPolicy: true } }],
  ["social proof", { hero: { showSocialProof: true } }],
  ["ratings on grid", { productGrid: { showRatings: true } }],
  ["ctaText 'Buy now'", { productPage: { ctaText: "Buy now" } }],
  ["price-asc", { productGrid: { sort: "price-asc" } }],
  ["2 columns", { productGrid: { columns: 2 } }],
  ["upfront only", { cart: { showShippingUpfront: true } }],
  ["threshold £100 only", { cart: { freeShippingThreshold: 10000 } }],
  ["agent: ETA", { agentSurface: { exposeDeliveryEta: true } }],
  ["agent: stock", { agentSurface: { exposeStock: true } }],
  ["agent: landed", { agentSurface: { exposeLandedPrice: true } }],
  ["agent: returns", { agentSurface: { exposeReturnPolicy: true } }],
  ["agent: structured", { agentSurface: { structuredData: true } }],
  ["agent: negotiation 10%", { agentSurface: { negotiation: { enabled: true, maxDiscountPct: 10 } } }],
  [
    "agent: full surface no negotiation",
    {
      agentSurface: {
        structuredData: true,
        exposeStock: true,
        exposeDeliveryEta: true,
        exposeReturnPolicy: true,
        exposeLandedPrice: true,
      },
    },
  ],
  ["bestKnownSpec", "best"],
];

(async () => {
  if (process.env.DARWIN_PERSIST !== "0") {
    console.error("Refusing to run: set DARWIN_PERSIST=0 (this script clears the event store and changes the live spec).");
    process.exit(1);
  }
  const base = await measure(DEFAULT_SPEC);
  for (const [name, patch] of rows) {
    const spec = patch === null ? DEFAULT_SPEC : patch === "best" ? bestKnownSpec() : applyPatch(DEFAULT_SPEC, patch);
    const m = patch === null ? base : await measure(spec);
    const lift = m.h.conversionRate / base.h.conversionRate - 1;
    const alift = m.a.conversionRate / base.a.conversionRate - 1;
    console.log(
      `${name.padEnd(36)} human ${pct(m.h.conversionRate).padStart(7)} (${(lift * 100).toFixed(1).padStart(6)}%)  AOV £${(m.h.averageOrderValue / 100).toFixed(2)}  agent ${pct(m.a.conversionRate).padStart(7)} (${(alift * 100).toFixed(1).padStart(6)}%)  ${m.ms.toFixed(0)}ms`,
    );
  }
  console.log("default human funnel", base.h.funnel.map((s) => `${s.step}:${pct(s.rateFromPrevious)}`).join(" "));
  console.log("default agent funnel", base.a.funnel.map((s) => `${s.step}:${pct(s.rateFromPrevious)}`).join(" "));
})();
