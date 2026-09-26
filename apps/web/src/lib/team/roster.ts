/**
 * The Darwin team roster: names, roles, mascots, colours and what each agent can do.
 * Change a name or role here and it changes everywhere (onboarding intro, bottom chat, team panel).
 *
 * Client-safe: plain data, no server imports. The tool lists mirror the per-agent tool registries in
 * lib/team (the model-facing names must match); `confirm: true` marks tools that wait for the merchant.
 */

import type { AgentId, TeamAgent } from "@/lib/contracts/team";

/** Human label of the model Darwin (and by default the other agents) runs on. */
export const DEFAULT_MODEL_LABEL = "DeepSeek V4 Flash";
/** Pixel edits code, so it runs on the stronger editor model (APINex). */
export const EDITOR_MODEL_LABEL = "APINex editor model";

export const TEAM: TeamAgent[] = [
  {
    id: "darwin",
    name: "Darwin",
    role: "Team lead",
    blurb: "Your single point of contact. Plans the work, hands it to the right specialist, and reports back.",
    mascot: "leader",
    color: "#E23B3B",
    model: DEFAULT_MODEL_LABEL,
    tools: [
      { name: "delegate", label: "Hand a task to a specialist" },
      { name: "start_group_chat", label: "Start a group chat for a bigger job" },
      { name: "post", label: "Post an update in a group chat" },
      { name: "report", label: "Summarise results for you" },
      { name: "navigate", label: "Open any page in the console" },
      { name: "get_kpis", label: "Read conversion, revenue and AOV" },
      { name: "loop_status", label: "Check where the optimisation loop is" },
      { name: "step_loop", label: "Advance the loop one step" },
      { name: "set_autonomy", label: "Set how much Darwin may do alone", confirm: true },
      { name: "add_policy", label: "Add a standing policy", confirm: true },
    ],
  },
  {
    id: "iris",
    name: "Iris",
    role: "Observer",
    blurb: "Watches humans and AI shoppers, builds dashboards, and researches your market and competitors.",
    mascot: "observer",
    color: "#2F86FF",
    model: DEFAULT_MODEL_LABEL,
    tools: [
      { name: "get_kpis", label: "Read live KPIs, humans vs agents" },
      { name: "agent_funnel", label: "Trace the AI-shopper funnel" },
      { name: "list_dashboards", label: "Read your dashboards" },
      { name: "add_chart", label: "Add a chart to a dashboard" },
      { name: "research_competitors", label: "Research competitors and the market" },
      { name: "audit_readiness", label: "Audit any store for AI-agent readiness" },
      { name: "certify_store", label: "Run the agent trial and certify a store" },
      { name: "ask", label: "Ask a teammate a quick question" },
    ],
  },
  {
    id: "pixel",
    name: "Pixel",
    role: "Website editor",
    blurb: "Changes your live site and your code: personalisation rules, file edits and pull requests.",
    mascot: "designer",
    color: "#FF7A1C",
    model: EDITOR_MODEL_LABEL,
    tools: [
      { name: "suggest_web_rules", label: "Suggest personalisation rules" },
      { name: "draft_web_rule", label: "Draft a page change from plain English" },
      { name: "save_web_rule", label: "Publish or update a live rule", confirm: true },
      { name: "list_repo_files", label: "Browse your repo" },
      { name: "read_repo_file", label: "Read a file" },
      { name: "propose_file_edit", label: "Commit a file change on a branch", confirm: true },
      { name: "open_pr", label: "Open a pull request", confirm: true },
      { name: "merge_pr", label: "Merge a pull request", confirm: true },
      { name: "ask", label: "Ask a teammate a quick question" },
    ],
  },
  {
    id: "fizz",
    name: "Fizz",
    role: "Experimenter",
    blurb: "Designs and runs A/B tests, drives the optimisation loop, and stress-tests pages with simulated shoppers.",
    mascot: "experimenter",
    color: "#F0579E",
    model: DEFAULT_MODEL_LABEL,
    tools: [
      { name: "list_experiments", label: "Read running and finished A/B tests" },
      { name: "step_loop", label: "Propose and launch the next test" },
      { name: "run_simulation", label: "Send simulated humans and AI shoppers", confirm: true },
      { name: "send_test_shopper", label: "Send one AI test shopper to the store" },
      { name: "agent_tests", label: "Run A/B tests on the store agent's pitch" },
      { name: "set_autopilot", label: "Turn autopilot on or off", confirm: true },
      { name: "reset_loop", label: "Reset the loop to Gen 0", confirm: true },
      { name: "ask", label: "Ask a teammate a quick question" },
    ],
  },
  {
    id: "dash",
    name: "Dash",
    role: "Shipper",
    blurb: "Ships winning variants to your repo as pull requests and keeps an eye on them until they merge.",
    mascot: "shipper",
    color: "#22D18B",
    model: DEFAULT_MODEL_LABEL,
    tools: [
      { name: "ship_winner", label: "Ship the winning variant as a PR", confirm: true },
      { name: "pr_status", label: "Check a pull request's status and checks" },
      { name: "merge_pr", label: "Merge a pull request", confirm: true },
      { name: "ask", label: "Ask a teammate a quick question" },
    ],
  },
];

export const TEAM_BY_ID: Record<AgentId, TeamAgent> = Object.fromEntries(TEAM.map((a) => [a.id, a])) as Record<AgentId, TeamAgent>;

export function getAgent(id: AgentId): TeamAgent {
  return TEAM_BY_ID[id];
}

/** One thing you could ask each agent (onboarding intro, empty chat states). */
export const EXAMPLE_ASKS: Record<AgentId, string> = {
  darwin: "What should we fix first this week?",
  iris: "How are AI shoppers converting compared with people?",
  pixel: "Make the size guide easier to find on mobile.",
  fizz: "Test a shorter checkout against the current one.",
  dash: "Ship last week's winning variant.",
};

/** The specialists Darwin manages (everyone but Darwin). */
export const SPECIALISTS: TeamAgent[] = TEAM.filter((a) => a.id !== "darwin");
