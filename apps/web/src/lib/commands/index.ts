/**
 * Darwin's command layer: one typed registry shared by the ⌘K bar, WebMCP and window.darwin.
 *
 *   specs.ts   the registry (zod inputs → JSON Schema, risk, LLM descriptions)      isomorphic
 *   parse.ts   natural language → plan, deterministic (no key needed)                isomorphic
 *   plan.ts    POST /api/command planner (LLM with heuristic fallback)               server
 *   run.ts     what each command does in the browser (ConsoleApi / existing routes)   browser
 *   webmcp.ts  navigator.modelContext registration                                    browser
 */
export * from "./types";
export { COMMANDS, COMMAND_NAMES, PAGES, PAGE_KEYS, AGENT_LEVERS, manifest, inputJsonSchema, pageHref, pageOf, resolveCommand, sayFor, specOf, validateStep, validateSteps, viewStep } from "./specs";
export type { CommandInput, PageKey, AgentLever } from "./specs";
export { parseCommand, resolveSite, siteSlug, type ParseContext } from "./parse";
