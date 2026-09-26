/**
 * What the ⌘K sheet offers before you type: page-aware suggestions, the everyday commands, and "Go to".
 * Plus a small fuzzy filter. Suggestions either run validated steps directly or fill the input with a
 * phrase for the merchant to finish ("build a dashboard of …").
 */
import { PAGES, PAGE_KEYS, type CommandRisk, type PageKey, type PlanStep } from "@/lib/commands";

export type SuggestionIcon =
  | "chart"
  | "users"
  | "bot"
  | "step"
  | "autopilot"
  | "pause"
  | "ask"
  | "issue"
  | "rollback"
  | "flask"
  | "wand"
  | "brief"
  | "ship"
  | "todo"
  | "go"
  | "recent";

export type SuggestionTone = "yellow" | "pink" | "olive" | "blue" | "lilac" | "sand";

export interface Suggestion {
  id: string;
  title: string;
  hint?: string;
  icon: SuggestionIcon;
  tone: SuggestionTone;
  /** Extra words the filter matches. */
  keywords?: string;
  /** Run these steps straight away… */
  steps?: PlanStep[];
  /** …or put this phrase in the input for the merchant to finish. */
  fill?: string;
  /** …or plan this text (recent commands). */
  text?: string;
  risk?: CommandRisk;
  /** team = internal (the roadmap): listed last, and only when typed for or with ?dev=1. */
  group: "here" | "recent" | "do" | "go" | "team";
}

const step = (command: PlanStep["command"], input: Record<string, unknown> = {}): PlanStep[] => [{ command, input }];

export function suggestionsFor(page: PageKey | undefined, opts: { site?: string; autopilot: boolean; recent: string[] }): Suggestion[] {
  const here: Suggestion[] = [];
  const onPage = page ? PAGES[page].label : "this page";
  const team: Suggestion[] = [
    { id: "left", title: `What's left on ${onPage}`, hint: "The team roadmap: left to do, limitations", icon: "todo", tone: "lilac", steps: step("whats_left"), keywords: "left todo roadmap team status next", group: "team" },
  ];

  switch (page) {
    case "dashboards":
      here.push(
        { id: "chart-fill", title: "Build a chart…", hint: "Say what to chart, in plain words", icon: "chart", tone: "yellow", fill: "build a chart of ", keywords: "dashboard graph plot", group: "here" },
        ...(opts.site
          ? [{ id: "chart-devices", title: "Add a chart: mobile vs desktop", hint: `On ${opts.site}`, icon: "chart" as const, tone: "blue" as const, steps: step("build_dashboard", { request: "mobile vs desktop", site: opts.site }), group: "here" as const }]
          : []),
      );
      break;
    case "issues":
      here.push({ id: "top-issue", title: "Open the biggest issue", hint: "Ranked by buyers lost per 1,000 visits", icon: "issue", tone: "pink", steps: step("open_issue", { rank: 1 }), group: "here" });
      break;
    case "changes":
      here.push({ id: "rollback-fill", title: "Roll back to a generation…", hint: "Asks you before anything changes", icon: "rollback", tone: "pink", fill: "roll back to gen ", risk: "confirm", keywords: "revert undo", group: "here" });
      break;
    case "personalize":
      here.push({
        id: "perso-fill",
        title: "Draft a personalization…",
        hint: "Saved as a draft: never starts on its own",
        icon: "wand",
        tone: "yellow",
        fill: `personalize${opts.site ? ` ${opts.site}` : ""}: `,
        group: "here",
      });
      break;
    case "agents":
      here.push(
        { id: "agent-test", title: "Test “One best pick” on the store agent", hint: "A/B test on how your agent sells", icon: "flask", tone: "pink", steps: step("start_agent_test", { lever: "one-pick" }), group: "here" },
        { id: "agent-auto", title: "Turn the store agent's autopilot on", hint: "One lever at a time, keeps winners", icon: "autopilot", tone: "olive", steps: step("set_agent_autopilot", { on: true }), group: "here" },
      );
      break;
    case "experiments":
    case "fixes":
      here.push({ id: "ship", title: "Ship the winning test", hint: "From Darwin's briefing, asks you first", icon: "ship", tone: "olive", steps: step("act_on_briefing", { action: "ship" }), risk: "confirm", group: "here" });
      break;
  }

  const recent: Suggestion[] = opts.recent.slice(0, 4).map((text, i) => ({ id: `recent-${i}`, title: text, icon: "recent", tone: "sand", text, group: "recent" }));

  // Demo-worthy first: run the loop, autopilot, traffic, ship, roll back, build a dashboard.
  const doIt: Suggestion[] = [
    { id: "step", title: "Step the loop", hint: "Observe, diagnose, propose, test, decide, ship", icon: "step", tone: "yellow", steps: step("step_loop"), keywords: "advance next phase", group: "do" },
    opts.autopilot
      ? { id: "auto-off", title: "Pause autopilot", hint: "Darwin waits for you", icon: "pause", tone: "sand", steps: step("set_autopilot", { on: false }), keywords: "stop autopilot", group: "do" }
      : { id: "auto-on", title: "Turn autopilot on", hint: "Darwin tests and ships on its own, with simulated shoppers", icon: "autopilot", tone: "olive", steps: step("set_autopilot", { on: true }), keywords: "start run autopilot", group: "do" },
    { id: "sim", title: "Send 200 simulated shoppers", hint: "Plus 20 AI agents, labelled simulated", icon: "users", tone: "blue", steps: step("simulate_traffic", { humans: 200, agents: 20 }), keywords: "traffic simulate visitors", group: "do" },
    { id: "ship-any", title: "Ship the winning test", hint: "From Darwin's briefing, asks you first", icon: "ship", tone: "olive", steps: step("act_on_briefing", { action: "ship" }), risk: "confirm", group: "do" },
    { id: "rollback", title: "Roll back to a generation…", hint: "Asks you first", icon: "rollback", tone: "pink", fill: "roll back to gen ", risk: "confirm", keywords: "revert undo", group: "do" },
    { id: "chart", title: "Build a dashboard…", hint: "“coupon usage per hour for trail-shop”", icon: "chart", tone: "yellow", fill: "build a dashboard of ", keywords: "chart graph", group: "do" },
    { id: "shopper", title: "Send an AI shopper…", hint: "One buyer agent with a brief", icon: "bot", tone: "lilac", fill: "send an AI shopper to ", keywords: "agent buyer a2a", group: "do" },
    { id: "ask", title: "Ask Darwin…", hint: "“why are agents leaving?”", icon: "ask", tone: "blue", fill: "why ", keywords: "question", group: "do" },
    { id: "brief", title: "Briefing", hint: "Every test, and the decision Darwin wants", icon: "brief", tone: "sand", steps: step("briefing"), keywords: "status update summary", group: "do" },
    { id: "perso", title: "Draft a personalization…", hint: "For a traffic source; saved as a draft", icon: "wand", tone: "yellow", fill: "personalize: ", group: "do" },
    { id: "agent-lever", title: "Test the store agent's pitch…", hint: "facts, one best pick, structured, upsell", icon: "flask", tone: "pink", fill: "test one best pick on the store agent", group: "do" },
  ];

  const go: Suggestion[] = PAGE_KEYS.filter((k) => k !== page).map((k) => ({
    id: `go-${k}`,
    title: `Go to ${PAGES[k].label}`,
    icon: "go",
    tone: "sand",
    steps: step("navigate", { page: k }),
    keywords: k,
    group: "go",
  }));

  // Don't repeat a "here" suggestion in the general list.
  const hereTitles = new Set(here.map((s) => s.title));
  return [...here, ...recent, ...doIt.filter((s) => !hereTitles.has(s.title)), ...go, ...team];
}

/** Word-prefix / subsequence match. Higher is better; 0 = no match. */
export function score(s: Suggestion, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const hay = `${s.title} ${s.keywords ?? ""} ${s.hint ?? ""}`.toLowerCase();
  const title = s.title.toLowerCase();
  if (title.startsWith(q)) return 100;
  const words = hay.split(/[^a-z0-9£]+/).filter(Boolean);
  const tokens = q.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const t of tokens) {
    const w = words.findIndex((x) => x.startsWith(t));
    if (w >= 0) total += 20 - Math.min(w, 10);
    else if (hay.includes(t)) total += 6;
    else return 0;
  }
  return total;
}

export function filterSuggestions(list: Suggestion[], query: string, opts: { dev?: boolean } = {}): Suggestion[] {
  if (!query.trim()) return opts.dev ? list : list.filter((s) => s.group !== "team");
  return list
    .map((s) => ({ s, v: score(s, query) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.s)
    .slice(0, 8);
}
