import { describe, expect, it } from "vitest";
import type { LoopPhase, LoopState } from "@/lib/contracts";
import { brandingFor, storeCatalog, DEMO_STORE_BRAND } from "@/lib/storefront/showcase";
import type { WhopShowcase } from "@/lib/whop";
import { bootSeedEnabled, demoStatus, ensureDemoStore, isConnected, isShowcaseReady, isSimulatedStoreEvent, type DemoDeps } from "./index";

/** The loop's phase order, as stepLoop walks it (ship → observe starts the next generation). */
const NEXT: Record<LoopPhase, LoopPhase> = {
  idle: "observe",
  observe: "diagnose",
  diagnose: "propose",
  propose: "experiment",
  experiment: "decide",
  decide: "ship",
  ship: "observe",
};

function loopState(over: Partial<LoopState> = {}): LoopState {
  return {
    phase: "idle",
    autopilot: false,
    generation: 0,
    liveSpec: {} as LoopState["liveSpec"],
    insights: [],
    history: [],
    log: [],
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function fakeWorld(start: Partial<LoopState> = {}, opts: { traffic?: boolean; stuck?: boolean } = {}) {
  let state = loopState(start);
  let traffic = opts.traffic ?? false;
  let tick = 0;
  const calls = { steps: 0, simulate: 0, web: 0 };
  const deps: DemoDeps = {
    loop: () => state,
    step: async () => {
      calls.steps++;
      if (opts.stuck) return state;
      const phase = NEXT[state.phase];
      tick++;
      state = {
        ...state,
        phase,
        generation: phase === "ship" ? state.generation + 1 : state.generation,
        experimentId: phase === "experiment" ? `exp_${tick}` : phase === "ship" ? undefined : state.experimentId,
        updatedAt: new Date(tick * 1000).toISOString(),
      };
      traffic = true;
      return state;
    },
    simulate: async () => {
      calls.simulate++;
      traffic = true;
    },
    hasSimulatedTraffic: () => traffic,
    connections: () => ({ sites: [] }),
    seedWebDemo: () => {
      calls.web++;
      return 0;
    },
  };
  return { deps, calls, state: () => state };
}

describe("ensureDemoStore", () => {
  it("runs a fresh store to Gen 1 with the next test live", async () => {
    const w = fakeWorld();
    const r = await ensureDemoStore(w.deps);
    expect(r.action).toBe("seeded");
    expect(w.state().generation).toBe(1);
    expect(isShowcaseReady(w.state())).toBe(true);
    expect(w.calls.simulate).toBe(0);
    expect(w.calls.web).toBe(1);
    expect(r.status.hasSimulatedTraffic).toBe(true);
    expect(r.status.seeding).toBe(false);
  });

  it("refills traffic after a restart instead of stepping (loop remembered, events gone)", async () => {
    const w = fakeWorld({ generation: 3, phase: "ship" });
    const r = await ensureDemoStore(w.deps);
    expect(r.action).toBe("refilled");
    expect(w.calls.simulate).toBe(1);
    expect(w.calls.steps).toBe(0);
    expect(w.state().generation).toBe(3);
  });

  it("with seed: false (a merchant site is connected) never steps a fresh loop, but still refills after a restart", async () => {
    const fresh = fakeWorld();
    expect((await ensureDemoStore(fresh.deps, { seed: false })).action).toBe("none");
    expect(fresh.calls.steps).toBe(0);
    const restarted = fakeWorld({ generation: 2, phase: "ship" });
    expect((await ensureDemoStore(restarted.deps, { seed: false })).action).toBe("refilled");
  });

  it("does nothing when the demo store already has simulated shoppers", async () => {
    const w = fakeWorld({}, { traffic: true });
    const r = await ensureDemoStore(w.deps);
    expect(r.action).toBe("none");
    expect(w.calls.steps + w.calls.simulate).toBe(0);
  });

  it("stops when another step is in flight (stepLoop returns the same state)", async () => {
    const w = fakeWorld({}, { stuck: true });
    const r = await ensureDemoStore(w.deps);
    expect(r.action).toBe("seeded");
    expect(w.calls.steps).toBe(1);
  });

  it("is single-flight: concurrent callers share one run", async () => {
    const w = fakeWorld();
    const [a, b] = await Promise.all([ensureDemoStore(w.deps), ensureDemoStore(w.deps)]);
    expect(a.action).toBe("seeded");
    expect(b.action).toBe("seeded");
    expect(w.state().generation).toBe(1);
    // A second pass afterwards finds traffic and does nothing.
    expect((await ensureDemoStore(w.deps)).action).toBe("none");
  });
});

describe("demoStatus", () => {
  it("is demo with nothing connected (or only Whop), connected with a repo or a planned site", () => {
    const w = fakeWorld();
    expect(demoStatus(w.deps).mode).toBe("demo");
    expect(demoStatus(w.deps).store).toMatchObject({ name: DEMO_STORE_BRAND, url: "/store" });
    expect(isConnected({ sites: [] })).toBe(false);
    expect(isConnected({ sites: [], github: "acme/shop" })).toBe(true);
    expect(isConnected({ sites: ["acme"] })).toBe(true);
    expect(isConnected({ sites: [], whop: "Acme" })).toBe(false);
  });
});

describe("isSimulatedStoreEvent", () => {
  it("counts simulated /store events, not darwin.js sites or real visitors", () => {
    expect(isSimulatedStoreEvent({ properties: { synthetic: true } })).toBe(true);
    expect(isSimulatedStoreEvent({ properties: { synthetic: true, darwin_site: "north-trail" } })).toBe(false);
    expect(isSimulatedStoreEvent({ properties: {} })).toBe(false);
  });
});

describe("bootSeedEnabled", () => {
  it("is on by default, off with DARWIN_DEMO_SEED=0", () => {
    expect(bootSeedEnabled({})).toBe(true);
    expect(bootSeedEnabled({ DARWIN_DEMO_SEED: "0" })).toBe(false);
  });
});

describe("demo store dashboards", () => {
  it("plans the demo store without saving it, with only dashboards its events can fill", async () => {
    const { DEMO_STORE_SITE, getPlan, listPlans, resetPlans } = await import("@/lib/tracking");
    resetPlans();
    const plan = getPlan(DEMO_STORE_SITE);
    expect(plan?.site).toBe("pace-store");
    expect(plan?.dashboards.map((d) => d.kind)).toEqual(expect.arrayContaining(["kpis", "funnel", "humans-agents", "devices", "revenue"]));
    expect(plan?.dashboards.some((d) => d.kind === "sources" || d.kind === "heatmap")).toBe(false);
    expect(listPlans()).toHaveLength(0);
    expect(getPlan("acme")).toBeUndefined();
  });

  it("counts the storefront's events (no darwin_site) for pace-store, not other sites' or Whop's", async () => {
    const { DEMO_STORE_SITE, computeDashboards, getPlan } = await import("@/lib/tracking");
    const at = new Date().toISOString();
    const e = (distinct_id: string, event: string, properties: Record<string, unknown>) => ({ uuid: `${distinct_id}-${event}`, distinct_id, event, timestamp: at, properties });
    const all = [
      e("v1", "$pageview", { visitor_kind: "human", synthetic: true }),
      e("v1", "order_completed", { visitor_kind: "human", synthetic: true, revenue: 11500 }),
      e("v2", "$pageview", { visitor_kind: "human", darwin_site: "north-trail" }),
      e("w1", "order_completed", { whop_event: "payment.succeeded", revenue: 999 }),
    ] as unknown as Parameters<typeof computeDashboards>[2];
    const res = computeDashboards(DEMO_STORE_SITE, getPlan(DEMO_STORE_SITE), all);
    expect(res.totalEvents).toBe(2);
    expect(res.syntheticEvents).toBe(2);
    const kpis = res.dashboards.find((d) => d.kind === "kpis");
    expect(kpis?.kpis?.find((k) => k.label === "Orders")?.value).toBe("1");
  });
});

describe("storefront branding", () => {
  const showcase: WhopShowcase = {
    title: "Acme Academy",
    storeUrl: "https://whop.com/acme",
    products: [{ id: "prod_1", title: "Course", headline: null, image: null, href: "https://whop.com/acme/course", priceLabel: "$10" }],
  };

  it("is PACE by default, even when Whop answers", () => {
    expect(storeCatalog({})).toBe("pace");
    expect(brandingFor("pace", showcase)).toEqual({ brand: DEMO_STORE_BRAND, showcase: null });
  });

  it("shows the Whop strip and brand only with DARWIN_STORE_CATALOG=whop", () => {
    expect(storeCatalog({ DARWIN_STORE_CATALOG: "whop" })).toBe("whop");
    expect(brandingFor("whop", showcase).brand).toBe("Acme Academy");
    expect(brandingFor("whop", showcase).showcase?.products).toHaveLength(1);
  });

  it("never brands the store with Whop's generic fallback title or an empty catalog", () => {
    expect(brandingFor("whop", { ...showcase, title: "Store" }).brand).toBe(DEMO_STORE_BRAND);
    expect(brandingFor("whop", { ...showcase, products: [] })).toEqual({ brand: DEMO_STORE_BRAND, showcase: null });
    expect(brandingFor("whop", null)).toEqual({ brand: DEMO_STORE_BRAND, showcase: null });
  });
});
