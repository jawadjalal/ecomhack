/**
 * The team: names, roles, mascots and colours in ONE place (change them here).
 * Tool sets per agent live in tools.ts (AGENT_TOOLS).
 */
import type { AgentId, TeamAgent } from "@/lib/contracts";

export const ROSTER: Record<AgentId, Omit<TeamAgent, "tools">> = {
  darwin: {
    id: "darwin",
    name: "Darwin",
    role: "Manager",
    blurb: "Plans the work, hands it to the right specialist, and reports back.",
    mascot: "analyst",
    color: "#7B55E8",
  },
  iris: {
    id: "iris",
    name: "Iris",
    role: "Observer",
    blurb: "Watches traffic and dashboards, researches competitors, audits agent readiness.",
    mascot: "observer",
    color: "#2F7BF0",
  },
  pixel: {
    id: "pixel",
    name: "Pixel",
    role: "Website editor",
    blurb: "Edits the live site with personalization rules and your repo's code through pull requests.",
    mascot: "designer",
    color: "#F07A1E",
  },
  fizz: {
    id: "fizz",
    name: "Fizz",
    role: "Experimenter",
    blurb: "Runs A/B tests, the improvement loop, simulations and the store agent's pitch tests.",
    mascot: "experimenter",
    color: "#E0529A",
  },
  dash: {
    id: "dash",
    name: "Dash",
    role: "Shipper",
    blurb: "Ships winning changes as pull requests, tracks them and merges when you say so.",
    mascot: "shipper",
    color: "#1FB57A",
  },
};

export const SPECIALISTS: AgentId[] = ["iris", "pixel", "fizz", "dash"];

export function agentName(id: AgentId | "user"): string {
  return id === "user" ? "You" : ROSTER[id].name;
}

export function isAgentId(v: unknown): v is AgentId {
  return typeof v === "string" && Object.hasOwn(ROSTER, v);
}

/** Resolve "Iris", "iris", "@iris", "observer" → "iris". */
export function findAgent(v: string): AgentId | undefined {
  const s = v.trim().replace(/^@/, "").toLowerCase();
  if (isAgentId(s)) return s;
  return (Object.values(ROSTER).find((a) => a.name.toLowerCase() === s || a.role.toLowerCase() === s || a.mascot === s)?.id) as AgentId | undefined;
}
