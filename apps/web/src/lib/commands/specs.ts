/**
 * The command registry: name, title, LLM-facing description, zod input (→ JSON Schema), risk.
 * Isomorphic (the /api/command planner and the browser both read it). The browser runners live in
 * ./run.ts; the natural-language parser in ./parse.ts.
 *
 * Adding a user-facing action to Darwin? Add it here (spec), in run.ts (browser runner) and server-run.ts (headless
 * runner), plus phrases in parse.ts: ⌘K, WebMCP, window.darwin, the MCP server and the CLI pick it up automatically.
 */
import { z } from "zod";
import { ROADMAP, ROADMAP_KEYS, roadmapArea } from "@/lib/status/roadmap";
import type { CommandManifestEntry, CommandName, CommandSpec, PlanStep, PlanStepView, RejectedStep } from "./types";

/* ------------------------------------------------------------------ pages */

export const PAGES = {
  overview: { label: "Overview", href: "/console" },
  issues: { label: "Issues", href: "/console/issues" },
  fixes: { label: "Fixes", href: "/console/fixes" },
  experiments: { label: "Experiments", href: "/console/experiments" },
  changes: { label: "Changes", href: "/console/changes" },
  settings: { label: "Settings", href: "/console/settings" },
  inbox: { label: "Inbox", href: "/console/inbox" },
  agents: { label: "Store agent", href: "/console/agents" },
  dashboards: { label: "Dashboards", href: "/console/dashboards" },
  personalize: { label: "Personalize", href: "/console/personalize" },
  traffic: { label: "Traffic", href: "/console/traffic" },
  onboarding: { label: "Set up a store", href: "/onboarding" },
  readiness: { label: "Agent readiness", href: "/readiness" },
} as const;

export type PageKey = keyof typeof PAGES;
export const PAGE_KEYS = Object.keys(PAGES) as [PageKey, ...PageKey[]];

/** "/console/dashboards?site=trail-shop-co-uk" for (dashboards, { site }). */
export function pageHref(page: PageKey, q: { site?: string; id?: string } = {}): string {
  const params = new URLSearchParams();
  if (q.site && (page === "dashboards" || page === "personalize")) params.set("site", q.site);
  if (q.id && (page === "issues" || page === "fixes")) params.set("id", q.id);
  const s = params.toString();
  return `${PAGES[page].href}${s ? `?${s}` : ""}`;
}

/** Which page a path is ("/console/issues?id=…" → "issues"). */
export function pageOf(path: string | undefined): PageKey | undefined {
  const p = (path ?? "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: PageKey | undefined;
  for (const k of PAGE_KEYS) {
    const href = PAGES[k].href;
    if ((p === href || p.startsWith(`${href}/`)) && (!best || href.length > PAGES[best].href.length)) best = k;
  }
  return best;
}

/* ------------------------------------------------------------------ shared inputs */

const Site = z
  .string()
  .regex(/^[\w.-]{1,64}$/)
  .describe("Site id (a tracking plan's or darwin.js data-darwin-site), e.g. \"trail-shop-co-uk\" or \"north-trail\". Omit to use the site on screen.");

/** Store-agent pitch levers (mirrors LEVERS in lib/store-agent/experiments.ts; a test keeps them in sync). */
export const AGENT_LEVERS = {
  facts: "Facts up front",
  "one-pick": "One best pick",
  structured: "Structured buy instructions",
  upsell: "Upsell the yearly plan",
} as const;
export type AgentLever = keyof typeof AGENT_LEVERS;
const LEVER_KEYS = Object.keys(AGENT_LEVERS) as [AgentLever, ...AgentLever[]];

/** Same caps as the simulator (lib/simulator/schema.ts). */
export const MAX_SIM_HUMANS = 5000;
export const MAX_SIM_AGENTS = 1000;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function define<S extends z.ZodObject>(spec: CommandSpec<S>): CommandSpec<S> {
  return spec;
}

/* ------------------------------------------------------------------ the registry */

export const COMMANDS = {
  navigate: define({
    name: "navigate",
    title: "Go to a page",
    description:
      "Open a page of the Darwin console: overview, issues, fixes, experiments, changes (shipped generations + rollback), settings, agents (the store's own AI agent), dashboards, personalize, traffic, onboarding (set up a store) or readiness. Optional site for dashboards/personalize, optional id for issues/fixes.",
    input: z.object({
      page: z.enum(PAGE_KEYS).describe("Which page."),
      site: Site.optional(),
      id: z.string().max(80).optional().describe("Issue or fix id to select (issues / fixes pages)."),
    }),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: ({ page, site }) => `Open ${PAGES[page].label}${site ? ` for ${site}` : ""}`,
    examples: [
      { text: "go to experiments", input: { page: "experiments" } },
      { text: "show me the dashboards for trail-shop-co-uk", input: { page: "dashboards", site: "trail-shop-co-uk" } },
    ],
  }),

  build_dashboard: define({
    name: "build_dashboard",
    title: "Build a dashboard",
    description:
      "Add a chart to a site's dashboards from a plain-English request (\"coupon usage per hour\", \"funnel from product view to order\", \"mobile vs desktop\"), then open the dashboards page with the new chart highlighted. If the store doesn't send the event yet, Darwin adds it to the tracking plan and says which line of code to add. Needs a site with a tracking plan.",
    input: z.object({
      request: z.string().trim().min(2).max(300).describe("What to chart, in the merchant's words, without the site."),
      site: Site.optional(),
    }),
    risk: "safe",
    actor: "analyst",
    aliases: ["add_chart"],
    describe: ({ request, site }) => `Build a chart of “${request}”${site ? ` on ${site}` : ""}`,
    examples: [
      { text: "build a dashboard of coupon usage per hour for trail-shop", input: { request: "coupon usage per hour", site: "trail-shop-co-uk" } },
      { text: "chart mobile vs desktop", input: { request: "mobile vs desktop" } },
    ],
  }),

  simulate_traffic: define({
    name: "simulate_traffic",
    title: "Simulate shoppers",
    description:
      "Send SIMULATED traffic to the demo store: human shoppers (people) and AI shopping agents, against the live page or the running A/B test. Every event is labelled synthetic and the console says “simulated”. Use for “send 200 shoppers”, “simulate traffic”.",
    input: z.object({
      humans: z.number().int().min(0).max(MAX_SIM_HUMANS).default(200).describe("Simulated human shoppers (people)."),
      agents: z.number().int().min(0).max(MAX_SIM_AGENTS).default(20).describe("Simulated AI shopping agents."),
    }),
    risk: "safe",
    actor: "observer",
    aliases: ["run_simulation"],
    describe: ({ humans, agents }) => {
      const parts = [humans ? plural(humans, "simulated person", "simulated people") : "", agents ? plural(agents, "simulated AI agent") : ""].filter(Boolean);
      return parts.length ? `Send ${parts.join(" and ")}` : "Send no simulated traffic";
    },
    examples: [
      { text: "send 200 shoppers", input: { humans: 200, agents: 0 } },
      { text: "simulate 500 people and 50 agents", input: { humans: 500, agents: 50 } },
    ],
  }),

  set_autopilot: define({
    name: "set_autopilot",
    title: "Autopilot",
    description:
      "Turn Darwin's loop autopilot on or off. On: Darwin observes, diagnoses, proposes, A/B tests and ships winners by itself while the console is open, and simulated shoppers keep arriving so it has traffic to learn from. Off: pauses it.",
    input: z.object({ on: z.boolean().describe("true = run on its own, false = pause.") }),
    risk: "safe",
    actor: "experimenter",
    describe: ({ on }) => (on ? "Turn autopilot on" : "Pause autopilot"),
    examples: [
      { text: "turn on autopilot", input: { on: true } },
      { text: "pause darwin", input: { on: false } },
    ],
  }),

  step_loop: define({
    name: "step_loop",
    title: "Step the loop",
    description:
      "Advance Darwin's self-improvement loop by one phase (observe → diagnose → propose → experiment → decide → ship), `times` times. The experiment phase runs a round of labelled simulated traffic.",
    input: z.object({ times: z.number().int().min(1).max(10).default(1).describe("How many phases to advance.") }),
    risk: "safe",
    actor: "designer",
    describe: ({ times }) => (times === 1 ? "Step the loop" : `Step the loop ${times} times`),
    examples: [
      { text: "step the loop", input: { times: 1 } },
      { text: "advance the loop 3 times", input: { times: 3 } },
    ],
  }),

  send_shopper: define({
    name: "send_shopper",
    title: "Send an AI shopper",
    description:
      "Send ONE AI buyer agent shopping the demo store with a natural-language brief (\"trail shoes, UK 10, under £140\"), over the tool API (tools) or by chatting with the store's agent (a2a). Reports whether it bought and why not. Not for bulk traffic (use simulate_traffic).",
    input: z.object({
      brief: z.string().trim().min(3).max(300).describe("What the shopper wants, in plain words."),
      via: z.enum(["tools", "a2a"]).default("tools").describe("tools = the store's agent API; a2a = chat with the store's own agent."),
    }),
    risk: "safe",
    actor: "observer",
    aliases: ["send_test_shopper"],
    describe: ({ brief, via }) => `Send an AI shopper: “${brief}”${via === "a2a" ? " (over A2A)" : ""}`,
    examples: [
      { text: "send an AI shopper to find trail shoes under £140", input: { brief: "find trail shoes under £140", via: "tools" } },
      { text: "send a buyer agent over a2a for a yearly plan", input: { brief: "a yearly plan", via: "a2a" } },
    ],
  }),

  ask_darwin: define({
    name: "ask_darwin",
    title: "Ask Darwin",
    description:
      "Answer a question about the store's shoppers from live numbers (conversion, humans vs AI agents, which agents buy, the current test, the top issue, why a shopper left). Use for any question that isn't an action.",
    input: z.object({ question: z.string().trim().min(2).max(500).describe("The question, as asked.") }),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: ({ question }) => `Ask Darwin: “${question}”`,
    examples: [{ text: "why are agents leaving?", input: { question: "why are agents leaving?" } }],
  }),

  open_issue: define({
    name: "open_issue",
    title: "Open an issue",
    description:
      "Open one of the issues Darwin found (ranked by buyers lost per 1,000 visits, 1 = biggest) on the Issues page, by rank or by insight id.",
    input: z.object({
      rank: z.number().int().min(1).max(50).optional().describe("1 = the biggest issue."),
      id: z.string().max(80).optional().describe("Insight id, when known."),
    }),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: ({ rank, id }) => (id ? `Open issue ${id}` : !rank || rank === 1 ? "Open the biggest issue" : `Open issue #${rank}`),
    examples: [
      { text: "open the top issue", input: { rank: 1 } },
      { text: "show issue 3", input: { rank: 3 } },
    ],
  }),

  rollback: define({
    name: "rollback",
    title: "Roll back",
    description:
      "Put an earlier generation of the store back live (Gen 0 = the original store). Stops any running test and records the rollback (and opens a revert PR when GitHub is connected). Changes the live store, so the merchant confirms first.",
    input: z.object({ generation: z.number().int().min(0).max(999).describe("The generation to restore.") }),
    risk: "confirm",
    actor: "shipper",
    describe: ({ generation }) => `Roll back to Gen ${generation}`,
    examples: [{ text: "roll back to gen 3", input: { generation: 3 } }],
  }),

  start_agent_test: define({
    name: "start_agent_test",
    title: "Test the store agent's pitch",
    description:
      "Start an A/B test on how the store's own AI agent sells to buyer agents, one lever at a time: facts (facts up front), one-pick (one best pick), structured (structured buy instructions) or upsell (upsell the yearly plan). Optionally send simulated buyer agents (labelled synthetic) to fill it.",
    input: z.object({
      lever: z.enum(LEVER_KEYS).describe("Which pitch lever to test."),
      buyers: z.number().int().min(1).max(500).optional().describe("Simulated buyer agents to send right away."),
    }),
    risk: "safe",
    actor: "experimenter",
    describe: ({ lever, buyers }) => `Test “${AGENT_LEVERS[lever]}” on the store agent${buyers ? ` with ${plural(buyers, "simulated buyer agent")}` : ""}`,
    examples: [{ text: "test one best pick on the store agent", input: { lever: "one-pick" } }],
  }),

  set_agent_autopilot: define({
    name: "set_agent_autopilot",
    title: "Store agent autopilot",
    description:
      "Turn the store agent's autopilot on or off: Darwin tests one pitch lever at a time on the store's AI agent, keeps winners and stops losers.",
    input: z.object({ on: z.boolean() }),
    risk: "safe",
    actor: "experimenter",
    describe: ({ on }) => (on ? "Turn the store agent's autopilot on" : "Pause the store agent's autopilot"),
    examples: [{ text: "turn on the store agent autopilot", input: { on: true } }],
  }),

  draft_personalization: define({
    name: "draft_personalization",
    title: "Draft a personalization",
    description:
      "Draft a page change for a store running darwin.js, for an audience (traffic source, search words): \"show a free-delivery banner to visitors from ads\". Saved as a DRAFT only, never started: the merchant reviews it on Personalize and presses Start. Never invents claims about the store.",
    input: z.object({
      prompt: z.string().trim().min(3).max(1000).describe("The change and who it's for, in plain words."),
      site: Site.optional(),
    }),
    risk: "safe",
    actor: "designer",
    describe: ({ prompt, site }) => `Draft a personalization${site ? ` for ${site}` : ""}: “${prompt}”`,
    examples: [{ text: "personalize north-trail: show a free delivery banner to visitors from ads", input: { site: "north-trail", prompt: "show a free delivery banner to visitors from ads" } }],
  }),

  briefing: define({
    name: "briefing",
    title: "Briefing",
    description:
      "Darwin's briefing in plain English: every running test (store page, darwin.js sites, store agent), which are winning or losing, and the one decision it wants from the merchant. Says when numbers come from simulated traffic.",
    input: z.object({}),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: () => "Get Darwin's briefing",
    examples: [{ text: "brief me", input: {} }],
  }),

  act_on_briefing: define({
    name: "act_on_briefing",
    title: "Ship or stop a test",
    description:
      "Ship or stop a test from the briefing. `id` is an item id from the briefing (\"web:<site>:<rule>\", \"agent:<test>\", \"loop:<experiment>\"); without it, Darwin uses the decision its briefing asks about. Changes what shoppers see, so the merchant confirms first.",
    input: z.object({
      action: z.enum(["ship", "stop"]),
      id: z.string().trim().min(3).max(200).optional().describe("Briefing item id; omit for the one Darwin recommends."),
    }),
    risk: "confirm",
    actor: "shipper",
    describe: ({ action, id }) => (action === "ship" ? (id ? `Ship ${id}` : "Ship the test Darwin recommends") : id ? `Stop ${id}` : "Stop the test Darwin flagged"),
    examples: [
      { text: "ship it", input: { action: "ship" } },
      { text: "stop the test", input: { action: "stop" } },
    ],
  }),

  whats_left: define({
    name: "whats_left",
    title: "What's left to do",
    description: `What's left to build on a part of Darwin (from docs/STATUS.md): status, left to do, limitations, next ideas. area: ${ROADMAP.map((a) => `${a.key} (${a.name})`).join(", ")}. Omit area for the page on screen.`,
    input: z.object({ area: z.enum(ROADMAP_KEYS).optional().describe("Roadmap area; omit for the current page.") }),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: ({ area }) => {
      const a = area ? roadmapArea(area) : undefined;
      return a ? `What's left on ${a.name}` : "What's left on this page";
    },
    examples: [
      { text: "what's left on this page?", input: {} },
      { text: "what's left to do on dashboards", input: { area: "dashboards" } },
    ],
  }),

  start_demo: define({
    name: "start_demo",
    title: "Watch Darwin improve the demo store",
    description:
      "Point Darwin at the demo store (/store, PACE running shoes), fill it with SIMULATED shoppers (people and AI agents, all labelled synthetic) and turn autopilot on, so Darwin observes, tests and ships fixes by itself. Use for “start the demo”, “watch Darwin improve the demo store”, “show me how it works”.",
    input: z.object({}),
    risk: "safe",
    actor: "experimenter",
    describe: () => "Fill the demo store with simulated shoppers and turn autopilot on",
    examples: [
      { text: "watch darwin improve the demo store", input: {} },
      { text: "start the demo", input: {} },
    ],
  }),

  watch_fix: define({
    name: "watch_fix",
    title: "Watch Darwin fix it",
    description:
      "Run Darwin's loop live, phase by phase (observe → diagnose → propose → experiment → decide → ship), until it ships a fix or finds no winner, narrating each phase. In the console it starts the Overview's watch run; headless it steps the loop up to `steps` times. The experiment phase uses labelled simulated traffic.",
    input: z.object({ steps: z.number().int().min(1).max(10).default(6).describe("Most loop phases to run (headless).") }),
    risk: "safe",
    actor: "designer",
    aliases: ["watch_darwin_fix"],
    describe: () => "Watch Darwin fix the top issue, phase by phase",
    examples: [
      { text: "watch darwin fix it", input: {} },
      { text: "watch the fix", input: { steps: 6 } },
    ],
  }),

  check_install: define({
    name: "check_install",
    title: "Test my install",
    description:
      "Check whether darwin.js is installed on the merchant's store: waiting (no tag or events yet), installed (the tag is on the homepage) or verified (Darwin has received real events from the store). `url` is the store's address; `site` the darwin.js site id (defaults to the one for that address, or the only store set up).",
    input: z.object({
      url: z.string().trim().min(3).max(300).optional().describe("The store's address, e.g. \"https://shop.example.com\". Omit to use the store saved in onboarding."),
      site: Site.optional(),
    }),
    risk: "safe",
    readOnly: true,
    actor: "observer",
    aliases: ["verify_install", "test_install"],
    describe: ({ url, site }) => `Check the darwin.js install${url ? ` on ${url}` : site ? ` for ${site}` : ""}`,
    examples: [
      { text: "test my install on https://shop.example.com", input: { url: "https://shop.example.com" } },
      { text: "is darwin installed?", input: {} },
    ],
  }),

  save_setup: define({
    name: "save_setup",
    title: "Save my setup",
    description:
      "Save the merchant's setup (their email and store) so they can pick up where they left off on any browser: returns a 30-day resume link. Nothing is emailed: the merchant keeps the link. Needs an email address.",
    input: z.object({
      email: z.email().max(254).optional().describe("The merchant's email address. Required to save; without it Darwin asks for one."),
      site: Site.optional(),
    }),
    risk: "safe",
    actor: "shipper",
    aliases: ["save_account"],
    describe: ({ email }) => (email ? `Save your setup under ${email}` : "Save your setup"),
    examples: [
      { text: "save my setup as jo@example.com", input: { email: "jo@example.com" } },
      { text: "save my setup for trail-shop-co-uk under jo@example.com", input: { email: "jo@example.com", site: "trail-shop-co-uk" } },
    ],
  }),

  which_store: define({
    name: "which_store",
    title: "Which store is this?",
    description:
      "Say which store the console is showing: the demo store (/store, simulated shoppers) or the merchant's own (connected GitHub repo, darwin.js sites with a tracking plan, saved account). Use for “which store am I looking at?”, “is this my store or the demo?”.",
    input: z.object({}),
    risk: "safe",
    readOnly: true,
    actor: "analyst",
    describe: () => "Check which store Darwin is showing",
    examples: [
      { text: "which store am I looking at?", input: {} },
      { text: "is this the demo store?", input: {} },
    ],
  }),

  detect_platform: define({
    name: "detect_platform",
    title: "Detect a store's platform",
    description:
      "Look at a store's homepage and say what it runs on (Shopify, Webflow, WordPress, Squarespace, Wix, BigCommerce, custom or unknown), with the evidence. Use before installing darwin.js to pick the right instructions.",
    input: z.object({ url: z.string().trim().min(3).max(300).describe("The store's address, e.g. \"https://shop.example.com\".") }),
    risk: "safe",
    readOnly: true,
    actor: "observer",
    aliases: ["inspect_store"],
    describe: ({ url }) => `Detect the platform of ${url}`,
    examples: [{ text: "what platform is shop.example.com on?", input: { url: "shop.example.com" } }],
  }),

  research_competitors: define({
    name: "research_competitors",
    title: "Research competitors",
    description:
      "Research the merchant's competitors on the web: who they are, their prices, shipping and returns, trends, and suggestions for the store, with sources. Without a TAVILY_API_KEY the report is a labelled sample. `query` is what to research (\"trail running shoes in the UK\"); `store` optionally describes the merchant's store or its URL.",
    input: z.object({
      query: z.string().trim().min(2).max(500).describe("What to research, e.g. \"trail running shoes in the UK\"."),
      store: z.string().trim().max(500).optional().describe("The merchant's store: a short description or its URL."),
    }),
    risk: "safe",
    actor: "analyst",
    aliases: ["competitor_research"],
    describe: ({ query }) => `Research competitors: “${query}”`,
    examples: [{ text: "research competitors for trail running shoes in the UK", input: { query: "trail running shoes in the UK" } }],
  }),
} satisfies Record<CommandName, CommandSpec<z.ZodObject>>;

export type Commands = typeof COMMANDS;
export type CommandInput<N extends CommandName> = z.output<Commands[N]["input"]>;

export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

/** Any spec, loosely typed (for iteration). */
export function specOf(name: CommandName): CommandSpec {
  return COMMANDS[name] as unknown as CommandSpec;
}

/** Resolve a name or alias ("add_chart" → build_dashboard). */
export function resolveCommand(name: string): CommandName | undefined {
  const n = name.trim();
  if ((COMMAND_NAMES as string[]).includes(n)) return n as CommandName;
  return COMMAND_NAMES.find((c) => specOf(c).aliases?.includes(n));
}

/** JSON Schema (input side: defaulted fields are optional) for LLMs, WebMCP and the manifest. */
export function inputJsonSchema(name: CommandName): Record<string, unknown> {
  const { $schema: _drop, ...schema } = z.toJSONSchema(specOf(name).input, { io: "input" }) as Record<string, unknown>;
  void _drop;
  return schema;
}

export function manifest(): CommandManifestEntry[] {
  return COMMAND_NAMES.map((name) => {
    const s = specOf(name);
    return { name, title: s.title, description: s.description, risk: s.risk, readOnly: !!s.readOnly, aliases: s.aliases ?? [], inputSchema: inputJsonSchema(name) };
  });
}

/** Validate one step: known command (or alias) and input that parses (defaults filled in). */
export function validateStep(command: string, input: unknown): { ok: true; step: PlanStep } | { ok: false; reason: string } {
  const name = resolveCommand(command);
  if (!name) return { ok: false, reason: `Unknown command “${command}”` };
  const parsed = specOf(name).input.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, reason: z.prettifyError(parsed.error) };
  return { ok: true, step: { command: name, input: parsed.data as Record<string, unknown> } };
}

export function validateSteps(raw: { command: string; input?: unknown }[]): { steps: PlanStep[]; rejected: RejectedStep[] } {
  const steps: PlanStep[] = [];
  const rejected: RejectedStep[] = [];
  raw.forEach((r, index) => {
    const v = validateStep(r.command, r.input);
    if (v.ok) steps.push(v.step);
    else rejected.push({ index, command: r.command, reason: v.reason });
  });
  return { steps, rejected };
}

/** A validated step with its title, plain-words label and risk (risk always comes from the registry). */
export function viewStep(step: PlanStep): PlanStepView {
  const spec = specOf(step.command);
  return { ...step, title: spec.title, label: spec.describe(step.input as never), risk: spec.risk, actor: spec.actor };
}

/** "Send 200 simulated people, then step the loop." */
export function sayFor(steps: PlanStep[]): string {
  if (!steps.length) return "";
  const labels = steps.map((s, i) => {
    const l = viewStep(s).label;
    return i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1);
  });
  return `${labels.join(", then ")}.`;
}
