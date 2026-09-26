/**
 * The Darwin crew: who's who. Client-safe (pure data + lookups, no server imports), so the console can render
 * names, roles and mascots, and the assistant can route `ask_agent` / `agent` to the right specialist.
 *
 * Each crew member knows little on its own (only its own data); Darwin, the lead, talks to the merchant and
 * consults the others (agent-to-agent threads, `AgentThread` in contracts/api.ts).
 */

import type { CrewId } from "@/lib/contracts";

export type { CrewId };

/** Mascot art in components/dw/mascot.tsx. */
export type CrewMascot =
  | "analyst"
  | "observer"
  | "designer"
  | "experimenter"
  | "shipper";
/** Brand art instead of a mascot: the Whop store's own agent, and Grok. */
export type CrewBrand = "store" | "grok";

export interface CrewMember {
  id: CrewId;
  name: string;
  role: string;
  /** One plain line on what they do. */
  oneLiner: string;
  /** Exactly one of `mascot` / `brand` is set. */
  mascot?: CrewMascot;
  brand?: CrewBrand;
}

export const CREW: readonly CrewMember[] = [
  {
    id: "darwin",
    name: "Darwin",
    role: "Lead",
    oneLiner: "Talks to you and runs the team",
    mascot: "analyst",
  },
  {
    id: "iris",
    name: "Iris",
    role: "Watcher",
    oneLiner: "Finds where shoppers and AI agents get stuck",
    mascot: "observer",
  },
  {
    id: "theo",
    name: "Theo",
    role: "Designer",
    oneLiner: "Drafts page changes",
    mascot: "designer",
  },
  {
    id: "ada",
    name: "Ada",
    role: "Tester",
    oneLiner: "Runs A vs B tests and picks the winner",
    mascot: "experimenter",
  },
  {
    id: "max",
    name: "Max",
    role: "Shipper",
    oneLiner: "Ships winners, and can undo them",
    mascot: "shipper",
  },
  {
    id: "mika",
    name: "Mika",
    role: "Store agent",
    oneLiner: "Sells to AI shoppers on your Whop store over agent chat",
    brand: "store",
  },
  {
    id: "grok",
    name: "Grok",
    role: "Teammate",
    oneLiner: "Sends your morning briefing",
    brand: "grok",
  },
] as const;

export const CREW_IDS = CREW.map((c) => c.id) as CrewId[];

/** The buyer agent the simulated-shopper conversations use. Always labelled "simulated shopper" (synthetic). */
export const SIMULATED_SHOPPER = {
  id: "shopper",
  name: "Shopper",
  role: "Buyer agent",
  label: "simulated shopper",
  oneLiner:
    "A simulated AI buyer that shops your store agent the way a real one would",
  mascot: "experimenter" as CrewMascot,
  synthetic: true,
} as const;

/** Everyone `ask_agent` can consult: the crew minus the lead, plus the simulated shopper. */
export type SpecialistId = Exclude<CrewId, "darwin"> | "shopper";

/** Old role names (and a few natural ones) still accepted by `ask_agent`. */
export const CREW_ALIASES: Readonly<Record<string, SpecialistId>> = {
  analyst: "iris",
  watcher: "iris",
  designer: "theo",
  tester: "ada",
  experimenter: "ada",
  shipper: "max",
  store_agent: "mika",
  "store-agent": "mika",
  store: "mika",
  teammate: "grok",
  buyer: "shopper",
  simulated_shopper: "shopper",
};

export function crewMember(id: string): CrewMember | undefined {
  const key = id.trim().toLowerCase();
  return CREW.find((c) => c.id === key || c.name.toLowerCase() === key);
}

export function isCrewId(v: unknown): v is CrewId {
  return typeof v === "string" && (CREW_IDS as string[]).includes(v);
}

/** A specialist id from an id, a name or an alias ("analyst" → "iris"), or undefined. Never the lead. */
export function resolveSpecialist(name: string): SpecialistId | undefined {
  const key = name.trim().toLowerCase();
  if (key === SIMULATED_SHOPPER.id || key === "simulated shopper")
    return "shopper";
  const alias = CREW_ALIASES[key];
  if (alias) return alias;
  const m = crewMember(key);
  return m && m.id !== "darwin" ? m.id : undefined;
}

/** Display name for a specialist id ("iris" → "Iris", "shopper" → "Shopper"). */
export function specialistName(id: SpecialistId | "darwin"): string {
  return id === "shopper"
    ? SIMULATED_SHOPPER.name
    : (crewMember(id)?.name ?? id);
}
