/**
 * Traffic simulator — public API. OWNED BY: simulator PR. Keep these signatures stable.
 *
 * Generates synthetic humans and AI shopper agents whose behaviour depends on the PageSpec
 * each visitor is served (see resolveSpecForVisitor), writing events via `track()`.
 *
 *   - humans: `humans.ts` walks the storefront funnel; probabilities come from `behavior-model.ts`.
 *   - agents: `runBuyerAgent` (agent-commerce) with a goal from `agents.ts`; falls back to the
 *     built-in `simulateAgentVisit` policy while agent-commerce is not implemented.
 *
 * All events carry `synthetic: true`. Runs are reproducible from `seed` (except events written
 * by the real `runBuyerAgent`, which owns its own randomness and timestamps).
 */
import type { AnalyticsEventInput, EventProperties } from "@/lib/contracts";
import { runBuyerAgent } from "@/lib/agent-commerce";
import { eventStore, track } from "@/lib/analytics/store";
import { llmAvailable } from "@/lib/llm/client";
import { attributionProps, resolveSpecForVisitor } from "@/lib/spec/resolve";
import { AGENT_NAMES, generateGoal, simulateAgentVisit, toShoppingGoal } from "./agents";
import { simulateHumanVisit } from "./humans";
import { type SimClock } from "./clock";
import { createRng, deriveSeed, randomSeed } from "./rng";

export interface SimulationOptions {
  humans: number;
  agents: number;
  /** Deterministic runs for tests/demos. */
  seed?: number;
  /** Spread event timestamps over this many simulated minutes ending now. Default 30. */
  spreadMinutes?: number;
  /** Use a real LLM for some agent shoppers (slow, costs tokens). Default false. */
  useLlmAgents?: boolean;
}

export interface SimulationResult {
  humans: number;
  agents: number;
  events: number;
  orders: number;
  revenue: number;
  byVariant: Record<string, { visitors: number; orders: number }>;
}

/** Test/demo knobs that are not part of the public contract. */
export interface SimulationInternals {
  /** Wall clock "now" in ms. Default Date.now(). */
  now?: number;
  /** "auto": runBuyerAgent, falling back to the built-in policy if it is not implemented (default).
   *  "builtin": always use the built-in policy (deterministic; used by calibration tests). */
  agentDriver?: "auto" | "builtin";
}

/** Simulated gap between an agent's tool calls, ms. */
const AGENT_STEP_MS = 800;

/** Max agents that get a real LLM brain when `useLlmAgents` is set. */
const MAX_LLM_AGENTS = 3;

export async function simulateTraffic(opts: SimulationOptions): Promise<SimulationResult> {
  return runSimulation(opts);
}

export async function runSimulation(opts: SimulationOptions, internals: SimulationInternals = {}): Promise<SimulationResult> {
  const seed = (opts.seed ?? randomSeed()) >>> 0;
  const clock: SimClock = { now: internals.now ?? Date.now(), spreadMs: Math.max(0, opts.spreadMinutes ?? 30) * 60_000 };

  const result: SimulationResult = { humans: 0, agents: 0, events: 0, orders: 0, revenue: 0, byVariant: {} };
  const tally = (key: string, ordered: boolean, revenue: number) => {
    const v = (result.byVariant[key] ??= { visitors: 0, orders: 0 });
    v.visitors++;
    if (ordered) {
      v.orders++;
      result.orders++;
      result.revenue += revenue;
    }
  };
  const buffer: AnalyticsEventInput[] = [];

  /* ---- humans: visitor i of a seed is always the same person (stream 1) */
  for (let i = 0; i < Math.max(0, Math.floor(opts.humans)); i++) {
    const visit = simulateHumanVisit(deriveSeed(seed, 1, i), clock);
    for (const e of visit.events) buffer.push(e);
    result.humans++;
    tally(visit.variantKey, visit.ordered, visit.revenue);
  }

  /* ---- agents (stream 2) */
  let builtin = internals.agentDriver === "builtin";
  const useLlm = Boolean(opts.useLlmAgents) && llmAvailable();
  for (let i = 0; i < Math.max(0, Math.floor(opts.agents)); i++) {
    const agentSeed = deriveSeed(seed, 2, i);
    const rng = createRng(agentSeed);
    const goal = generateGoal(rng);
    const who = rng.weighted(AGENT_NAMES.map((a) => [a, a.share] as const));
    const agentId = `sim_a_${rng.token(10)}`;
    const sessionId = `sim_as_${rng.token(12)}`;
    const resolved = resolveSpecForVisitor(agentId);
    result.agents++;

    if (!builtin) {
      const lastBefore = eventStore().all().at(-1)?.uuid;
      try {
        // Place the agent's session on the simulator clock (same rule as humans) so its events are
        // spread over the window and a seed reproduces identical timestamps.
        const end = clock.spreadMs > 0 ? clock.now - rng.next() * clock.spreadMs : clock.now - rng.next() * 3_000;
        const start = end - AGENT_STEP_MS * 8;
        let step = 0;
        const now = () => new Date(Math.round(Math.min(end, start + AGENT_STEP_MS * step++))).toISOString();
        const summary = await runBuyerAgent(
          toShoppingGoal(goal),
          { agentId, agentName: who.name, sessionId, synthetic: true, persona: `agent:${goal.kind}`, now },
          { useLlm: useLlm && i < MAX_LLM_AGENTS },
        );
        if (summary.reason !== "not implemented") {
          tally(summary.variant ?? resolved.variant ?? "live", summary.outcome === "purchased", summary.orderTotal ?? 0);
          result.events += eventStore().since(lastBefore, Number.MAX_SAFE_INTEGER).length;
          continue;
        }
      } catch (err) {
        console.warn("[simulator] runBuyerAgent failed; using the built-in agent policy for this run", err);
      }
      builtin = true; // not implemented (or failing): use the built-in policy from now on
    }

    const baseProps: EventProperties = {
      visitor_kind: "agent",
      agent_name: who.name,
      synthetic: true,
      persona: `agent:${goal.kind}`,
      $session_id: sessionId,
      $user_agent: `${who.name}/1.0 (AI shopping agent; synthetic)`,
      ...attributionProps(resolved),
    };
    const visit = simulateAgentVisit(
      goal,
      { agentId, agentName: who.name, channel: who.channel, sessionId },
      resolved.spec,
      baseProps,
      deriveSeed(agentSeed, 1),
      clock,
    );
    for (const e of visit.events) buffer.push(e);
    tally(resolved.variant ?? "live", visit.outcome === "purchased", visit.revenue);
  }

  /* ---- write, oldest first (stable sort keeps intra-session order on ties) */
  buffer.sort((a, b) => (a.timestamp! < b.timestamp! ? -1 : a.timestamp! > b.timestamp! ? 1 : 0));
  const CHUNK = 20_000;
  for (let i = 0; i < buffer.length; i += CHUNK) track(buffer.slice(i, i + CHUNK));
  result.events += buffer.length;
  return result;
}

export { bestKnownSpec } from "./behavior-model";
