/**
 * Shared types of Darwin's command layer: one typed registry used by the ⌘K bar, WebMCP
 * (navigator.modelContext) and window.darwin. Isomorphic: no server or browser-only imports here.
 */
import type { z } from "zod";

export type CommandName =
  | "navigate"
  | "build_dashboard"
  | "simulate_traffic"
  | "set_autopilot"
  | "step_loop"
  | "send_shopper"
  | "ask_darwin"
  | "open_issue"
  | "rollback"
  | "start_agent_test"
  | "set_agent_autopilot"
  | "draft_personalization"
  | "briefing"
  | "act_on_briefing"
  | "whats_left"
  | "start_demo"
  | "watch_fix"
  | "check_install"
  | "save_setup"
  | "which_store"
  | "detect_platform"
  | "research_competitors";

/** safe: runs straight away. confirm: the human approves it in the page first (always, even for browser agents). */
export type CommandRisk = "safe" | "confirm";

/** Which Darwin crew member does it (the mascot on the step row). */
export type CommandActor = "observer" | "analyst" | "designer" | "experimenter" | "shipper";

/** What every command returns: a human sentence built from real data, plus an optional link. */
export interface CommandResult {
  ok: boolean;
  /** One or two plain sentences. Never invented numbers: only what the API reported. */
  text: string;
  /** Where to see it, e.g. "/console/dashboards?site=…". */
  href?: string;
  /** Label for `href`, e.g. "Open dashboards". */
  linkLabel?: string;
  /** The result counts simulated traffic (the UI says so). */
  synthetic?: boolean;
  /** Structured result for automation (window.darwin / WebMCP callers). */
  data?: unknown;
}

export interface CommandExample<I> {
  text: string;
  input: I;
}

export interface CommandSpec<S extends z.ZodObject = z.ZodObject> {
  name: CommandName;
  /** Short title for menus: "Build a dashboard". */
  title: string;
  /** Written for an LLM: what it does, when to use it, what it changes. */
  description: string;
  input: S;
  risk: CommandRisk;
  /** Reads only (WebMCP readOnlyHint). */
  readOnly?: boolean;
  actor: CommandActor;
  /** Other names callers may use (e.g. the same tool in lib/assistant, PR #36). */
  aliases?: string[];
  /** One step in plain words: "Send 200 simulated people and 20 simulated AI agents". */
  describe(input: z.output<S>): string;
  examples: CommandExample<z.input<S>>[];
}

/** One step of a plan, as sent over the wire. */
export interface PlanStep {
  command: CommandName;
  input: Record<string, unknown>;
}

/** A plan step with what the UI needs to show it before it runs. */
export interface PlanStepView extends PlanStep {
  title: string;
  label: string;
  risk: CommandRisk;
  actor: CommandActor;
}

export type PlanSource = "llm" | "heuristic" | "direct";

export interface RejectedStep {
  index: number;
  command: string;
  reason: string;
}

/** POST /api/command { text, page? } → CommandPlanResponse */
export interface CommandPlanResponse {
  steps: PlanStepView[];
  /** One sentence: what Darwin is about to do. Never states results (the commands report those). */
  say: string;
  source: PlanSource;
  /** Steps the planner proposed that failed validation (unknown command or bad input). */
  rejected?: RejectedStep[];
}

/** Known sites, for "…for trail-shop" → "trail-shop-co-uk". */
export interface CommandSites {
  /** Sites with a tracking plan (dashboards). */
  tracking: string[];
  /** darwin.js sites (personalize). */
  web: string[];
}

/** GET /api/command → the registry, for automation and agents. */
export interface CommandManifestEntry {
  name: CommandName;
  title: string;
  description: string;
  risk: CommandRisk;
  readOnly: boolean;
  aliases: string[];
  inputSchema: Record<string, unknown>;
}

export interface CommandManifestResponse {
  commands: CommandManifestEntry[];
  context: { sites: CommandSites };
}
