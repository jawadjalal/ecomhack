/**
 * Demo store mode — public API. OWNED BY: demo (onboarding + scaffold).
 *
 *   demoStatus()       is this Darwin running on the demo store (nothing connected) or a merchant's site?
 *   ensureDemoStore()  make sure the console has something true to show about /store:
 *                      - fresh store (Gen 0, no simulated shoppers yet): run the loop until Gen 1 is live and a
 *                        test is running
 *                      - loop has history but no simulated shoppers (the server restarted: simulated events are never
 *                        written to disk, the loop state is): send one round of simulated shoppers to the live store,
 *                        so the cards that read analytics agree with the generations the loop remembers
 *                      - simulated shoppers already there: nothing
 *
 * Every event this creates comes from the simulator, so it carries `properties.synthetic = true` and the console
 * labels it "simulated". Nothing here invents numbers: the console only shows what the simulated shoppers did.
 */
import type { DemoConnections, DemoResponse, DemoStatus, LoopState } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { getGithubStatus } from "@/lib/github";
import { getLoopState, stepLoop } from "@/lib/optimizer";
import { simulateTraffic } from "@/lib/simulator";
import { DEMO_STORE_BRAND, storeCatalog } from "@/lib/storefront/showcase";
import { DEMO_STORE_SITE, listPlans } from "@/lib/tracking";
import { getWhopStatus } from "@/lib/whop";
import { DEMO_PATH, DEMO_SITE, listRules, simulateWebTraffic, webState } from "@/lib/web";

/** Darwin's own sites: its onboarding (records itself with darwin.js) and the demo store's plan. Not a merchant's. */
const OWN_SITES = new Set(["darwin-onboarding", DEMO_STORE_SITE]);

/** Enough steps to go Gen 0 → Gen 1 shipped → the next test running (observe, diagnose, propose, experiment, decide ×2). */
const MAX_SEED_STEPS = 14;
/** One round of refill traffic: the simulator's defaults are 200 humans + 20 agents; a bit more reads steadier. */
const REFILL = { humans: 400, agents: 60 } as const;
/** Simulated visitors for the darwin.js demo site (North Trail) that Personalize and Traffic open on. */
const WEB_VISITORS = 400;

export type { DemoConnections, DemoStatus };
export type DemoAction = NonNullable<DemoResponse["action"]>;

export interface EnsureResult {
  action: DemoAction;
  steps: number;
  status: DemoStatus;
}

type RunResult = Omit<EnsureResult, "status">;

export interface DemoDeps {
  loop: () => LoopState;
  step: () => Promise<LoopState>;
  simulate: (opts: { humans: number; agents: number }) => Promise<unknown>;
  hasSimulatedTraffic: () => boolean;
  connections: () => DemoConnections;
  /** Seeds the darwin.js demo site when it has no visitors; returns how many it sent (0 = already had some). */
  seedWebDemo: () => number;
}

/** Events from the demo storefront (/store and its agent tools): darwin.js sites tag theirs with `darwin_site`. */
export function isStoreEvent(e: { properties?: Record<string, unknown> }): boolean {
  return !e.properties?.darwin_site;
}

export function isSimulatedStoreEvent(e: { properties?: Record<string, unknown> }): boolean {
  return e.properties?.synthetic === true && isStoreEvent(e);
}

function readConnections(): DemoConnections {
  const gh = getGithubStatus().connection;
  const whop = getWhopStatus().connection;
  return {
    ...(gh?.repo ? { github: gh.repo } : {}),
    sites: listPlans()
      .map((p) => p.site)
      .filter((s) => !OWN_SITES.has(s)),
    ...(whop?.mode === "live" ? { whop: whop.title } : {}),
  };
}

function seedWebDemo(): number {
  if (webState(DEMO_SITE).overview.visitors > 0) return 0;
  const origin = (process.env.DARWIN_PUBLIC_URL?.trim() || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
  return simulateWebTraffic({ site: DEMO_SITE, visitors: WEB_VISITORS, rules: listRules(DEMO_SITE), url: `${origin}${DEMO_PATH}` }).visitors;
}

const defaultDeps: DemoDeps = {
  loop: getLoopState,
  step: stepLoop,
  simulate: (opts) => simulateTraffic(opts),
  hasSimulatedTraffic: () => eventStore().all().some(isSimulatedStoreEvent),
  connections: readConnections,
  seedWebDemo,
};

const g = globalThis as unknown as { __darwinDemoSeed?: Promise<RunResult> | null };

/**
 * The Overview is about the merchant's own site once a repo or a darwin.js site is connected. Whop alone doesn't
 * count: it feeds the store agent (/console/agents), not the storefront the loop optimizes.
 */
export function isConnected(c: DemoConnections): boolean {
  return Boolean(c.github || c.sites.length);
}

export function demoStatus(deps: DemoDeps = defaultDeps): DemoStatus {
  const connections = deps.connections();
  return {
    mode: isConnected(connections) ? "connected" : "demo",
    store: { name: DEMO_STORE_BRAND, url: "/store", catalog: storeCatalog() },
    connections,
    hasSimulatedTraffic: deps.hasSimulatedTraffic(),
    generation: deps.loop().generation,
    seeding: Boolean(g.__darwinDemoSeed),
  };
}

/** A test is live on a store Darwin has already improved once: the Overview has all four cards to show. */
export function isShowcaseReady(s: LoopState): boolean {
  return s.generation >= 1 && Boolean(s.experimentId) && (s.phase === "experiment" || s.phase === "decide");
}

export interface EnsureOptions {
  /**
   * Run the loop on a fresh (Gen 0) store. Default true. Boot passes false once a merchant's site is connected:
   * Darwin shouldn't start testing on its own then, but a restart's refill still happens (the loop's history is
   * about /store either way).
   */
  seed?: boolean;
}

async function run(deps: DemoDeps, opts: EnsureOptions): Promise<RunResult> {
  // Personalize and Traffic open on the darwin.js demo site: give it simulated visitors too (labelled, like all of these).
  try {
    deps.seedWebDemo();
  } catch (err) {
    console.warn("[demo] couldn't seed the darwin.js demo site", err);
  }
  if (deps.hasSimulatedTraffic()) return { action: "none", steps: 0 };

  let state = deps.loop();
  if (state.generation > 0) {
    // Restarted server: the loop remembers its generations, the (simulated) events are gone.
    await deps.simulate({ ...REFILL });
    return { action: "refilled", steps: 0 };
  }
  if (opts.seed === false) return { action: "none", steps: 0 };

  let steps = 0;
  while (steps < MAX_SEED_STEPS && !isShowcaseReady(state)) {
    const before = `${state.phase}:${state.generation}:${state.updatedAt}`;
    state = await deps.step();
    steps++;
    // stepLoop returns the unchanged state when another step is in flight (e.g. the console's autopilot).
    if (`${state.phase}:${state.generation}:${state.updatedAt}` === before) break;
  }
  return { action: "seeded", steps };
}

/**
 * Idempotent and single-flight: concurrent callers share one run. Safe to call on every boot and from the
 * onboarding "explore the demo store" button.
 */
export async function ensureDemoStore(deps: DemoDeps = defaultDeps, opts: EnsureOptions = {}): Promise<EnsureResult> {
  let p = g.__darwinDemoSeed;
  if (!p) {
    p = run(deps, opts).finally(() => {
      g.__darwinDemoSeed = null;
    });
    g.__darwinDemoSeed = p;
  }
  const result = await p;
  return { ...result, status: demoStatus(deps) };
}

/** Boot-time seeding is on unless DARWIN_DEMO_SEED=0 (qa scripts and tests turn it off). */
export function bootSeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DARWIN_DEMO_SEED?.trim() !== "0";
}
