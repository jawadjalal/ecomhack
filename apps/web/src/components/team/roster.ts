/**
 * Client-side fallbacks for the team roster (the server's GET /api/team is the source of truth),
 * plain-English tool labels and starter prompts.
 */
import type { AgentId, TeamAgent } from "@/lib/contracts";
import { isMascotKind, MASCOT_COLOR, MASCOT_TINT, type MascotKind } from "@/components/console/mascot";

export const FALLBACK_AGENTS: TeamAgent[] = [
  { id: "darwin", name: "Darwin", role: "Manager", blurb: "Plans the work, hands it to the right specialist, and reports back.", mascot: "analyst", color: MASCOT_COLOR.analyst },
  { id: "iris", name: "Iris", role: "Observer", blurb: "Watches how shoppers and AI agents move through your store.", mascot: "observer", color: MASCOT_COLOR.observer },
  { id: "pixel", name: "Pixel", role: "Website editor", blurb: "Changes your pages to fix what's stopping shoppers.", mascot: "designer", color: MASCOT_COLOR.designer },
  { id: "fizz", name: "Fizz", role: "Experimenter", blurb: "Runs A/B tests and tells you which version wins.", mascot: "experimenter", color: MASCOT_COLOR.experimenter },
  { id: "dash", name: "Dash", role: "Shipper", blurb: "Ships winning changes to your store and keeps track of them.", mascot: "shipper", color: MASCOT_COLOR.shipper },
];

const DEFAULT_MASCOT: Record<AgentId, MascotKind> = { darwin: "analyst", iris: "observer", pixel: "designer", fizz: "experimenter", dash: "shipper" };

export interface AgentLook {
  id: AgentId;
  name: string;
  role: string;
  blurb: string;
  mascot: MascotKind;
  color: string;
  tint: string;
}

/** Everything the UI needs to draw an agent. Each agent always keeps its own mascot. */
export function lookFor(agents: TeamAgent[], id: AgentId): AgentLook {
  const a = agents.find((x) => x.id === id) ?? FALLBACK_AGENTS.find((x) => x.id === id) ?? FALLBACK_AGENTS[0];
  const mascot = isMascotKind(a.mascot) ? a.mascot : DEFAULT_MASCOT[id] ?? "analyst";
  return { id: a.id, name: a.name, role: a.role, blurb: a.blurb, mascot, color: /^#[0-9a-f]{3,8}$/i.test(a.color) ? a.color : MASCOT_COLOR[mascot], tint: MASCOT_TINT[mascot] };
}

/** Plain-English names for what an agent did. Unknown tools get a tidied-up version of their name. */
const TOOL_LABELS: Record<string, string> = {
  get_kpis: "Store numbers",
  loop_status: "Loop status",
  step_loop: "Next step of the loop",
  set_autopilot: "Autopilot",
  reset_loop: "Start over",
  list_experiments: "Tests",
  ship_winner: "Ship the winner",
  list_dashboards: "Dashboards",
  add_chart: "New chart",
  suggest_web_rules: "Personalization ideas",
  run_simulation: "Practice shoppers",
  audit_readiness: "Agent readiness check",
  certify_store: "Store certificate",
  send_test_shopper: "Test shopper",
  research_competitors: "Competitor research",
  agent_funnel: "How agents buy",
  delegate: "Hand-off",
};

export function toolLabel(tool?: string): string {
  if (!tool) return "Done";
  const known = TOOL_LABELS[tool];
  if (known) return known;
  const words = tool.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Done";
}

/** Starter prompts per mascot role (plain English, no jargon). */
export const STARTERS: Record<MascotKind, string[]> = {
  analyst: ["How is my store doing?", "Find what's stopping people from buying", "Test a better product page", "Is anything ready to ship?"],
  observer: ["What are shoppers doing right now?", "Where do people drop off?", "How do AI shoppers find us?"],
  designer: ["Suggest a better product page", "Make shipping costs clearer", "What would you change first?"],
  experimenter: ["How is the current test going?", "Start a new test", "Which version is winning?"],
  shipper: ["Is anything ready to ship?", "Ship the winning change", "What did we ship last?"],
};

export const GROUP_STARTERS = ["What's the plan?", "Work together on the biggest problem", "Give me a quick update"];

/** Status notes and progress labels in plain words: tool names become labels, "Fizz: …" loses the name. */
export function friendlyNote(note: string | undefined, name?: string): string | undefined {
  let t = note?.trim();
  if (!t) return undefined;
  if (name && t.toLowerCase().startsWith(`${name.toLowerCase()}:`)) t = t.slice(name.length + 1).trim();
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(t) || TOOL_LABELS[t]) return toolLabel(t);
  return t ? t[0].toUpperCase() + t.slice(1) : undefined;
}
