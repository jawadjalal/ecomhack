/**
 * Server-side planner for POST /api/command: natural language → validated plan.
 *
 * With an LLM key: `generateJson` gets the registry (names, descriptions, JSON Schemas), the page and the
 * known sites, and answers { say, steps }. Every step is validated against the command's zod schema;
 * unknown commands and bad inputs are rejected (and reported). Risk always comes from the registry,
 * never from the model. No key, an error, or no valid step → the deterministic parser (./parse.ts).
 */
import { z } from "zod";
import { generateJson, llmAvailable } from "@/lib/llm/client";
import { parseCommand, type ParseContext } from "./parse";
import { COMMAND_NAMES, inputJsonSchema, sayFor, specOf, validateSteps, viewStep } from "./specs";
import type { CommandPlanResponse } from "./types";

export const MAX_PLAN_STEPS = 6;

/** What the model may answer. `command` is a free string so unknown names are rejected (and reported), not fatal. */
export const LlmPlanSchema = z.object({
  say: z.string().max(400).default(""),
  steps: z
    .array(z.object({ command: z.string().max(80), input: z.record(z.string(), z.unknown()).default({}) }))
    .max(MAX_PLAN_STEPS)
    .default([]),
});

const SYSTEM = `You are the command planner of Darwin, a tool that improves an online store by watching human and AI shoppers, A/B testing page changes and shipping winners.
Turn the merchant's words into a short plan of Darwin commands. Use only the commands listed, with inputs matching their JSON Schemas.
Rules:
- One step per action the merchant asked for, in the order they asked. Usually 1 step; at most ${MAX_PLAN_STEPS}.
- Questions (why/what/how…) that aren't actions → ask_darwin with the question as asked.
- Never invent numbers, ids or results. Only use numbers the merchant said. Omit optional inputs you don't know (e.g. omit site when unsure: the command uses the site on screen).
- Prefer a known site id when the merchant names a site loosely ("trail-shop" → the matching known site).
- "say" is ONE short sentence describing what you're about to do (no results, no numbers you don't have).
Answer JSON only: {"say": "...", "steps": [{"command": "<name>", "input": {...}}]}`;

function catalog(): string {
  return COMMAND_NAMES.map((name) => {
    const s = specOf(name);
    const ex = s.examples.map((e) => `"${e.text}" → ${JSON.stringify(e.input)}`).join("; ");
    return `- ${name}${s.risk === "confirm" ? " [merchant confirms before it runs]" : ""}: ${s.description}\n  input JSON Schema: ${JSON.stringify(inputJsonSchema(name))}\n  examples: ${ex}`;
  }).join("\n");
}

export function plannerPrompt(text: string, ctx: ParseContext): string {
  return [
    `COMMANDS:\n${catalog()}`,
    `PAGE: the merchant is on ${ctx.page || "/console"}.`,
    `KNOWN SITES: tracking plans (dashboards): ${ctx.sites?.tracking?.join(", ") || "none"}; darwin.js sites (personalize): ${ctx.sites?.web?.join(", ") || "none"}.`,
    `MERCHANT SAID: ${JSON.stringify(text)}`,
  ].join("\n\n");
}

/** Validate raw steps; every surviving step gets its label and the registry's risk. */
export function finishPlan(raw: { command: string; input?: unknown }[], say: string, source: CommandPlanResponse["source"]): CommandPlanResponse {
  const { steps, rejected } = validateSteps(raw.slice(0, MAX_PLAN_STEPS));
  return { steps: steps.map(viewStep), say: say.trim() || sayFor(steps), source, ...(rejected.length ? { rejected } : {}) };
}

export async function planCommand(text: string, ctx: ParseContext = {}): Promise<CommandPlanResponse> {
  const words = text.trim().slice(0, 500);
  if (llmAvailable()) {
    try {
      const out = await generateJson({ system: SYSTEM, prompt: plannerPrompt(words, ctx), schema: LlmPlanSchema, maxTokens: 900 });
      const plan = finishPlan(out.steps, out.say, "llm");
      if (plan.steps.length) return plan;
      if (plan.rejected?.length) console.warn(`[command] LLM plan had no valid step (${plan.rejected.map((r) => r.command).join(", ")}); using the heuristic parser`);
    } catch (err) {
      console.warn(`[command] LLM planner failed (${err instanceof Error ? err.message.slice(0, 160) : String(err)}); using the heuristic parser`);
    }
  }
  const h = parseCommand(words, ctx);
  return { steps: h.steps.map(viewStep), say: h.say, source: "heuristic" };
}
