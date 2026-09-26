import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Experiment, PageSpec, SpecPatch } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { resetAgentCommerce } from "@/lib/agent-commerce";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import { resetExperiments, saveExperiment } from "@/lib/experiments/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { promoteSpec, resetSpec } from "@/lib/spec/store";
import { POST } from "@/app/api/simulate/route";
import { SINGLE_KNOB_CHANGES, bestKnownSpec } from "./behavior-model";
import { runSimulation, simulateTraffic } from "./index";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const SLOW = 60_000;

function reset() {
  resetSpec();
  resetExperiments();
  resetAgentCommerce();
  eventStore().clear();
}

/** Serve `spec` as the live spec, simulate, and read conversion back through analytics. */
async function measure(spec: PageSpec | null, humans: number, agents: number, seed = 42) {
  reset();
  if (spec) promoteSpec(spec, spec.label);
  const result = await runSimulation({ humans, agents, seed }, { now: NOW, agentDriver: "builtin" });
  const s = getAnalyticsSummary();
  return { result, human: s.byKind.human.conversionRate, agent: s.byKind.agent.conversionRate };
}

/** Event stream minus ids that are unique by design (event uuid, order ids minted at checkout). */
const snapshot = () =>
  eventStore()
    .all()
    .map(({ event, distinct_id, timestamp, properties }) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { order_id, ...rest } = properties;
      return { event, distinct_id, timestamp, properties: rest };
    });

beforeEach(reset);
afterEach(reset);

describe("simulateTraffic", () => {
  it("is deterministic for a seed", async () => {
    const a = await runSimulation({ humans: 300, agents: 40, seed: 123 }, { now: NOW });
    const eventsA = snapshot();
    eventStore().clear();
    const b = await runSimulation({ humans: 300, agents: 40, seed: 123 }, { now: NOW });
    expect(b).toEqual(a);
    expect(snapshot()).toEqual(eventsA);

    eventStore().clear();
    const c = await runSimulation({ humans: 300, agents: 40, seed: 124 }, { now: NOW });
    expect(snapshot()).not.toEqual(eventsA);
    expect(c.humans).toBe(300);
  });

  it("labels every event as synthetic and attributable", async () => {
    const r = await runSimulation({ humans: 400, agents: 60, seed: 7 }, { now: NOW });
    const events = eventStore().all();
    expect(events.length).toBe(r.events);
    for (const e of events) {
      const p = e.properties;
      expect(p.synthetic).toBe(true);
      expect(p.$session_id).toBeTruthy();
      expect(p.persona).toBeTruthy();
      expect(p.spec_version).toBe(0);
      if (p.visitor_kind === "human") {
        expect(e.distinct_id.startsWith("sim_h_")).toBe(true);
        expect(p.$device_type).toBeTruthy();
        expect(p.$user_agent).toBeTruthy();
      } else {
        expect(p.visitor_kind).toBe("agent");
        expect(e.distinct_id.startsWith("sim_a_")).toBe(true);
        expect(p.agent_name).toBeTruthy();
      }
    }
    const summary = getAnalyticsSummary();
    expect(summary.byKind.human.visitors).toBe(400);
    expect(summary.byKind.agent.visitors).toBe(60);
    expect(summary.overall.orders).toBe(r.orders);
    expect(summary.overall.revenue).toBe(r.revenue);
    expect(r.byVariant.live.visitors).toBe(460);
  });

  it("emits a realistic storefront event stream", async () => {
    await runSimulation({ humans: 3000, agents: 0, seed: 9 }, { now: NOW });
    const events = eventStore().all();
    const names = new Set(events.map((e) => e.event));
    for (const n of [
      "$pageview",
      "$autocapture",
      "$rageclick",
      "$pageleave",
      "product_viewed",
      "product_added",
      "cart_viewed",
      "checkout_started",
      "checkout_step_completed",
      "shipping_cost_revealed",
      "checkout_abandoned",
      "order_completed",
    ]) {
      expect(names.has(n), n).toBe(true);
    }
    const paths = new Set(events.filter((e) => e.event === "$pageview").map((e) => String(e.properties.$pathname)));
    expect(paths.has("/store")).toBe(true);
    expect(paths.has("/store/cart")).toBe(true);
    expect(paths.has("/store/checkout")).toBe(true);
    expect([...paths].some((p) => p.startsWith("/store/products/"))).toBe(true);

    const reasons = new Set(events.filter((e) => e.event === "checkout_abandoned").map((e) => e.properties.reason));
    expect(reasons.has("account_required")).toBe(true);
    expect(reasons.has("unexpected_shipping_cost")).toBe(true);
    for (const o of events.filter((e) => e.event === "order_completed")) {
      expect(o.properties.revenue).toBe(Number(o.properties.subtotal) + Number(o.properties.shipping));
    }
    // Timestamps: within the 30-minute window (plus session length), never in the future, oldest first.
    const ts = events.map((e) => Date.parse(e.timestamp));
    expect(Math.max(...ts)).toBeLessThanOrEqual(NOW);
    expect(Math.min(...ts)).toBeGreaterThan(NOW - 30 * 60_000 - 60 * 60_000);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("spreadMinutes: 0 places sessions in the last few seconds", async () => {
    await runSimulation({ humans: 200, agents: 20, seed: 5, spreadMinutes: 0 }, { now: NOW });
    const ts = eventStore().all().map((e) => Date.parse(e.timestamp));
    expect(Math.max(...ts)).toBeLessThanOrEqual(NOW);
    expect(Math.min(...ts)).toBeGreaterThanOrEqual(NOW - 15_000);
  });

  it("fixed frictions disappear from the stream when the page fixes them", async () => {
    await measure(bestKnownSpec(), 3000, 0);
    const events = eventStore().all();
    expect(events.some((e) => e.event === "shipping_cost_revealed")).toBe(false);
    expect(events.some((e) => e.properties.reason === "account_required")).toBe(false);
  });

  it(
    "runs 2,000 humans + 200 agents in under 1.5s",
    async () => {
      const t0 = performance.now();
      const r = await simulateTraffic({ humans: 2000, agents: 200, seed: 11 });
      expect(performance.now() - t0).toBeLessThan(1500);
      expect(r.humans + r.agents).toBe(2200);
    },
    SLOW,
  );
});

describe("calibration", () => {
  it(
    "DEFAULT_SPEC vs bestKnownSpec conversion bands (humans + agents)",
    async () => {
      const base = await measure(null, 20_000, 3_000);
      expect(base.human).toBeGreaterThanOrEqual(0.02);
      expect(base.human).toBeLessThanOrEqual(0.026);
      // Negotiators carry a budget under list price, so at Gen 0 (no haggling) they walk: ~12–22%.
      expect(base.agent).toBeGreaterThanOrEqual(0.12);
      expect(base.agent).toBeLessThanOrEqual(0.22);

      const best = await measure(bestKnownSpec(), 20_000, 3_000);
      expect(best.human).toBeGreaterThanOrEqual(0.045);
      expect(best.human).toBeLessThanOrEqual(0.055);
      expect(best.agent).toBeGreaterThanOrEqual(0.55);
      expect(best.agent).toBeLessThanOrEqual(0.7);
    },
    SLOW,
  );

  it(
    "each major human knob moves conversion in the documented direction",
    async () => {
      // Same seed on every spec = the same visitors, so differences come from the page alone.
      const base = await measure(null, 12_000, 0);
      for (const change of SINGLE_KNOB_CHANGES) {
        const m = await measure(applyPatch(DEFAULT_SPEC, change.patch), 12_000, 0);
        const lift = m.human / base.human - 1;
        if (change.expect === "up") expect(lift, change.name).toBeGreaterThan(0.02);
        if (change.expect === "down") expect(lift, change.name).toBeLessThan(-0.01);
        if (change.expect === "neutral") expect(Math.abs(lift), change.name).toBeLessThan(0.02);
      }
    },
    SLOW,
  );

  it(
    "each agent-surface knob raises agent conversion; the full surface lifts it most",
    async () => {
      const base = await measure(null, 0, 4_000);
      const patches: SpecPatch[] = [
        { agentSurface: { exposeDeliveryEta: true } },
        { agentSurface: { exposeReturnPolicy: true } },
        { agentSurface: { exposeStock: true } },
        { agentSurface: { exposeLandedPrice: true } },
        { agentSurface: { structuredData: true } },
        { agentSurface: { negotiation: { enabled: true, maxDiscountPct: 10 } } },
      ];
      let best = 0;
      for (const patch of patches) {
        const m = await measure(applyPatch(DEFAULT_SPEC, patch), 0, 4_000);
        expect(m.agent, JSON.stringify(patch)).toBeGreaterThan(base.agent * 1.03);
        best = Math.max(best, m.agent);
      }
      const full = await measure(applyPatch(DEFAULT_SPEC, { agentSurface: bestKnownSpec().agentSurface }), 0, 4_000);
      expect(full.agent).toBeGreaterThan(best);
      // Agent knobs do not touch humans and vice versa.
      const humansOnly = await measure(applyPatch(DEFAULT_SPEC, { agentSurface: bestKnownSpec().agentSurface }), 2_000, 0);
      const humansBase = await measure(null, 2_000, 0);
      expect(humansOnly.human).toBe(humansBase.human);
    },
    SLOW,
  );
});

describe("experiments", () => {
  it(
    "splits traffic ~50/50 and serves each arm its own spec",
    async () => {
      const treatmentSpec = applyPatch(DEFAULT_SPEC, { checkout: { guestCheckout: true } });
      const exp: Experiment = {
        id: "exp_simtest",
        name: "Guest checkout",
        status: "running",
        createdAt: new Date(NOW).toISOString(),
        proposalId: "prop_simtest",
        controlVersion: 0,
        treatmentSpec,
        allocation: 0.5,
        primaryMetric: "order_completed",
      };
      saveExperiment(exp);
      const r = await runSimulation({ humans: 4000, agents: 400, seed: 21 }, { now: NOW });

      const { control, treatment } = r.byVariant;
      expect(control.visitors + treatment.visitors).toBe(4400);
      expect(treatment.visitors / 4400).toBeGreaterThan(0.45);
      expect(treatment.visitors / 4400).toBeLessThan(0.55);
      expect(r.byVariant.live).toBeUndefined();

      const events = eventStore().all();
      expect(events.every((e) => e.properties.experiment_id === exp.id)).toBe(true);
      const accountWalls = (variant: string) =>
        events.filter((e) => e.properties.variant === variant && e.properties.reason === "account_required").length;
      expect(accountWalls("control")).toBeGreaterThan(0);
      expect(accountWalls("treatment")).toBe(0);

      const arm = (variant: string) => getAnalyticsSummary({ experimentId: exp.id, variant }).overall.visitors;
      expect(arm("control")).toBe(control.visitors);
      expect(arm("treatment")).toBe(treatment.visitors);
    },
    SLOW,
  );
});

describe("POST /api/simulate", () => {
  const call = (body: unknown) =>
    POST(new Request("http://localhost/api/simulate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("validates, clamps and runs", async () => {
    const ok = await call({ humans: 50, agents: 5, seed: 3 });
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.humans).toBe(50);
    expect(json.agents).toBe(5);
    expect(json.events).toBeGreaterThan(0);

    expect((await call({ humans: "lots" })).status).toBe(400);
    expect((await call("{not json")).status).toBe(400);

    const clamped = await (await call({ humans: 0, agents: 5000, seed: 1 })).json();
    expect(clamped.agents).toBe(1000);

    const defaults = await (await call("")).json();
    expect(defaults.humans).toBe(200);
    expect(defaults.agents).toBe(20);
  }, SLOW);
});
