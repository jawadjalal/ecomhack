/**
 * Keyword routing for the team when no LLM is configured (or it fails): split a multi-part ask, map each part to
 * the specialist that owns the tool, reusing the assistant's intent router for the shared tools.
 */
import type { AgentId } from "@/lib/contracts/team";
import { routeIntent } from "@/lib/assistant/agent";
import { safeHref } from "./tools";

export interface RoutedCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface RoutedPart {
  text: string;
  agent: AgentId;
  calls: RoutedCall[];
  /** Answer without tools (help, intro, "which store?"). */
  reply?: string;
  intro?: boolean;
}

/** Who does what when routed by keywords (tools several agents have go to the specialist). */
const OWNER: Record<string, AgentId> = {
  get_kpis: "iris",
  agent_funnel: "iris",
  list_dashboards: "iris",
  add_chart: "iris",
  research_competitors: "iris",
  audit_readiness: "iris",
  certify_store: "iris",
  suggest_web_rules: "pixel",
  draft_web_rule: "pixel",
  save_web_rule: "pixel",
  list_repo_files: "pixel",
  read_repo_file: "pixel",
  propose_file_edit: "pixel",
  open_pr: "pixel",
  list_experiments: "fizz",
  step_loop: "fizz",
  run_simulation: "fizz",
  send_test_shopper: "fizz",
  agent_tests: "fizz",
  set_autopilot: "fizz",
  reset_loop: "fizz",
  ship_winner: "dash",
  pr_status: "dash",
  merge_pr: "dash",
  loop_status: "darwin",
  navigate: "darwin",
};

export function ownerFor(tool: string): AgentId {
  return OWNER[tool] ?? "darwin";
}

const VERBS =
  "run|send|audit|check|show|ship|research|open|simulate|merge|draft|change|build|add|chart|step|list|read|publish|certify|tell|give|what|how|turn|find|look|compare|go|take|browse|edit|update|suggest|create|make|start|stop|reset|launch|test";

/** "audit allbirds.com and run 200 shoppers, then ship the winner" → three parts. */
export function splitAsk(text: string): string[] {
  const parts = text
    .split(new RegExp(`\\s*(?:;|\\n|,?\\s+and then\\s+|,?\\s+then\\s+|,?\\s+also\\s+|\\.\\s+(?=[A-Z])|,?\\s+and\\s+(?=(?:${VERBS})\\b)|,\\s+(?=(?:${VERBS})\\b))`, "i"))
    .map((p) => p.trim().replace(/^(and|also|then|plus)\s+/i, "").replace(/[.!?]+$/, ""))
    .filter((p) => p.length >= 3);
  return parts.length ? parts.slice(0, 5) : [text.trim()];
}

const INTRO_RE = /\b(who('| i)?s on (the|your) team|who are you|meet the team|introduce|your team|the team|who does what|what can (you|the team) do)\b/i;
const GREETING_RE = /^\s*(hi|hey|hello|yo|hiya|morning|good (morning|afternoon|evening))\b[\s!.,]*(darwin)?[\s!.]*$/i;

export function isIntroAsk(text: string): boolean {
  return INTRO_RE.test(text);
}

export function isGreeting(text: string): boolean {
  return GREETING_RE.test(text);
}

/** Map one part of an ask to an agent + tool calls. `onboarding`: unknown asks get the team intro, not KPIs. */
export function routePart(text: string, opts: { onboarding?: boolean } = {}): RoutedPart {
  const t = ` ${text.toLowerCase()} `;

  if (/^\s*(help|\?|commands?)\b/i.test(text) || isIntroAsk(text) || (opts.onboarding && isGreeting(text))) return { text, agent: "darwin", calls: [], intro: true };

  // Navigation: "open the dashboards page", "take me to experiments".
  const nav = text.match(/^\s*(?:please\s+)?(?:open|go to|take me to|navigate to|show me|bring up|jump to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:page|tab|screen))?\s*[.!]*$/i);
  if (nav) {
    const href = safeHref(nav[1]) ?? safeHref(nav[1].split(/\s+/)[0]);
    if (href) return { text, agent: "darwin", calls: [{ tool: "navigate", args: { page: href } }] };
  }

  // GitHub: merge / PR status / read / list.
  const prNum = text.match(/(?:#|\bpr\s*#?|\bpull request\s*#?)(\d{1,6})\b/i)?.[1];
  if (/\bmerge\b/.test(t) && prNum) return { text, agent: "dash", calls: [{ tool: "merge_pr", args: { number: Number(prNum) } }] };
  if (/\bmerge\b/.test(t) && /\b(pr|pull request)\b/.test(t)) return { text, agent: "dash", calls: [], reply: "Which pull request should I merge? Give me its number, e.g. “merge PR #12”." };
  if (/\b(pr|pull request)\b.*\b(status|checks?|ci|state)\b|\b(status|checks?) (of|on) (the )?(pr|pull request)\b|\bis (the )?(pr|pull request) (green|merged|passing)\b/.test(t)) {
    return { text, agent: "dash", calls: [{ tool: "pr_status", args: prNum ? { number: Number(prNum) } : {} }] };
  }
  const file = text.match(/\b(?:read|show|open|cat|look at)\s+(?:the\s+)?(?:file\s+)?([\w./-]+\.[a-z0-9]{1,6})\b/i)?.[1];
  if (file && !/^https?:/i.test(file) && !/\.(com|co|io|shop|store|net|org|uk|app|dev)$/i.test(file)) {
    return { text, agent: "pixel", calls: [{ tool: "read_repo_file", args: { path: file.replace(/^\/+/, "") } }] };
  }
  if (/\b(list|browse|show)\b.*\b(files|repo|repository|codebase)\b/.test(t)) {
    const prefix = text.match(/\b(?:under|in)\s+([\w./-]+\/)/i)?.[1];
    return { text, agent: "pixel", calls: [{ tool: "list_repo_files", args: prefix ? { prefix } : {} }] };
  }

  // Live-site edits.
  if (/\b(change|edit|update|rewrite|make|swap|replace|add|hide)\b.*\b(headline|banner|hero|button|cta|copy|badge|title|tagline|heading|announcement)\b/.test(t)) {
    const publish = /\b(publish|go live|launch|put it live|make it live|ship it live)\b/.test(t);
    return { text, agent: "pixel", calls: [{ tool: publish ? "save_web_rule" : "draft_web_rule", args: { request: text.slice(0, 600) } }] };
  }

  // Store-agent pitch tests.
  if (/\b(pitch|store agent|sales agent)\b.*\b(tests?|a\/b|experiments?)\b|\bagent tests?\b/.test(t)) {
    return { text, agent: "fizz", calls: [{ tool: "agent_tests", args: /\b(run|step|start|next)\b/.test(t) ? { step: true } : {} }] };
  }

  const r = routeIntent(text);
  if (!r.calls.length) return { text, agent: "darwin", calls: [], reply: r.reply };
  // The assistant router falls back to KPIs for anything it doesn't know: on onboarding, introduce the team instead.
  if (r.reply && opts.onboarding) return { text, agent: "darwin", calls: [], intro: true };
  const agent = ownerFor(r.calls[0].tool);
  return { text, agent, calls: r.calls.map((c) => ({ tool: c.tool, args: c.args })), reply: r.reply };
}
