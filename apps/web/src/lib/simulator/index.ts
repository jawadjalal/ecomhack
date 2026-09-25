/**
 * Traffic simulator — public API. OWNED BY: simulator PR. Keep these signatures stable.
 *
 * Generates synthetic humans and AI shopper agents whose behaviour depends on the PageSpec
 * each visitor is served (see resolveSpecForVisitor), writing events via `track()`.
 */
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

export async function simulateTraffic(opts: SimulationOptions): Promise<SimulationResult> {
  // Placeholder until the simulator PR lands.
  return { humans: opts.humans, agents: opts.agents, events: 0, orders: 0, revenue: 0, byVariant: {} };
}
