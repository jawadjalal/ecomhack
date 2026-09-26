import { z } from "zod";
import type { SimulationOptions } from "./index";

export const MAX_HUMANS = 5000;
export const MAX_AGENTS = 1000;

const count = (max: number, fallback: number) =>
  z
    .number()
    .int()
    .min(0)
    .default(fallback)
    .transform((n) => Math.min(n, max));

/** Body of POST /api/simulate. Counts above the caps are clamped (not rejected). */
export const SimulationOptionsSchema = z.object({
  humans: count(MAX_HUMANS, 200),
  agents: count(MAX_AGENTS, 20),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  spreadMinutes: z.number().min(0).max(7 * 24 * 60).optional(),
  useLlmAgents: z.boolean().optional(),
}) satisfies z.ZodType<SimulationOptions, unknown>;
