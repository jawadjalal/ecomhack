/**
 * How much Darwin may do without being asked, and the standing policies that widen it. OWNED BY: team.
 *
 *   off        nothing: the heartbeat still runs and logs, but Darwin never speaks and never acts.
 *   suggest    (default) messages only. Every action waits for a tap.
 *   auto-safe  reversible things by himself: drafts, dry-run pull requests, simulations, pausing a losing test.
 *   autopilot  the same, plus anything a confirmed standing policy allows.
 *
 * Drastic actions (merge, a real pull request, publishing to real traffic, shipping, resetting, and anything
 * near payments, auth or CI) never run on autonomy alone: they need a tap, or a policy the merchant wrote in
 * plain English, compiled into a guard, read back, and confirmed. Every policy-driven action is logged with
 * the policy that allowed it (lib/team/watch-store memory).
 *
 * Compiling a policy uses the LLM when there is one and falls back to the patterns below, so the demo works
 * with no keys. `describeGuard` is the read-back, and it round-trips: compiling its own description again
 * gives the same guard.
 */
import { z } from "zod";
import type { ActionRisk, AutonomyLevel, Policy, PolicyGuard, WatchAction } from "@/lib/contracts/watch";
import { generateJson, llmAvailable } from "@/lib/llm/client";
import { githubMode } from "@/lib/github";
import { id } from "@/lib/ids";
import { DARWIN_VOICE } from "./persona";
import { getWatchSettings, listPolicies, policyUsesToday } from "./watch-store";

export const AUTONOMY_LEVELS: AutonomyLevel[] = ["off", "suggest", "auto-safe", "autopilot"];

export const AUTONOMY_BLURB: Record<AutonomyLevel, string> = {
  off: "Darwin watches and logs, but never messages you and never acts.",
  suggest: "Darwin messages you when something needs a call. Nothing happens until you tap.",
  "auto-safe": "Darwin does reversible things himself (drafts, dry-run PRs, simulations, pausing a losing test) and tells you after.",
  autopilot: "Darwin runs the store. Drastic changes still need your tap, or a standing policy you confirmed.",
};

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return typeof v === "string" && (AUTONOMY_LEVELS as string[]).includes(v);
}

/* ------------------------------------------------------------------ what counts as drastic */

export type PolicyAction = PolicyGuard["actions"][number];

/** Words that make anything drastic, whatever else it is. */
const HOT_WORDS = /\b(payment|payments|billing|checkout|card|stripe|auth|login|oauth|password|secret|token|ci|workflow|deploy|deployment|dns|env)\b/i;

/** Team tools that change something the merchant would want a say in. */
const DRASTIC_TOOLS = new Set(["merge_pr", "open_pr", "propose_file_edit", "ship_winner", "reset_loop", "set_autopilot", "save_web_rule"]);
const SAFE_TOOLS = new Set(["run_simulation", "send_test_shopper", "draft_web_rule", "suggest_web_rules", "agent_tests", "add_chart", "get_kpis", "loop_status", "list_experiments", "pr_status", "agent_funnel", "audit_readiness", "research_competitors"]);

/** Which policy verb an action is, for matching a guard. */
export function policyActionOf(action: WatchAction): PolicyAction | undefined {
  if (action.type === "briefing") return action.action === "ship" ? "ship" : "stop";
  if (action.type === "tool") {
    switch (action.tool) {
      case "ship_winner":
        return "ship";
      case "merge_pr":
        return "merge";
      case "open_pr":
      case "propose_file_edit":
        return "open_pr";
      case "save_web_rule":
        return String((action.args as { status?: unknown }).status) === "paused" ? "pause" : "publish";
      case "reset_loop":
        return "reset";
      default:
        return undefined;
    }
  }
  return undefined;
}


/** Is this reversible enough for auto-safe? Dry-run GitHub writes are, real ones aren't. */
export function actionRisk(action: WatchAction, label = ""): ActionRisk {
  if (action.type === "open" || action.type === "dismiss") return "safe";
  if (HOT_WORDS.test(label)) return "drastic";
  if (action.type === "briefing") {
    // Stopping a test puts the original page back: reversible. Shipping is not.
    return action.action === "stop" ? "safe" : "drastic";
  }
  const { tool, args } = action;
  if (HOT_WORDS.test(JSON.stringify(args ?? {}))) return "drastic";
  if (SAFE_TOOLS.has(tool)) return "safe";
  if (tool === "save_web_rule") return String((args as { status?: unknown }).status) === "paused" ? "safe" : "drastic";
  // A repo Darwin can't actually write to (no token) is a preview, not a change.
  if ((tool === "open_pr" || tool === "propose_file_edit") && githubMode() !== "live") return "safe";
  return DRASTIC_TOOLS.has(tool) ? "drastic" : "drastic";
}

/* ------------------------------------------------------------------ compiling a policy */


export const PolicyGuardSchema = z.object({
  effect: z.enum(["allow", "deny"]),
  actions: z.array(z.enum(["ship", "stop", "pause", "publish", "open_pr", "merge", "reset"])).min(1).max(7),
  minProbability: z.number().min(0).max(1).optional(),
  minRealPerArm: z.number().int().min(0).max(1_000_000).optional(),
  areas: z.array(z.string().trim().min(2).max(40)).max(6).optional(),
  weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7).optional(),
  maxPerDay: z.number().int().min(1).max(50).optional(),
});


const ALL_ACTIONS: PolicyAction[] = ["ship", "stop", "pause", "publish", "open_pr", "merge", "reset"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_WORDS: Record<(typeof DAYS)[number], RegExp> = {
  mon: /\bmondays?\b/i,
  tue: /\btuesdays?\b/i,
  wed: /\bwednesdays?\b/i,
  thu: /\bthursdays?\b/i,
  fri: /\bfridays?\b/i,
  sat: /\bsaturdays?\b/i,
  sun: /\bsundays?\b/i,
};
const DAY_LABEL: Record<(typeof DAYS)[number], string> = { mon: "Mondays", tue: "Tuesdays", wed: "Wednesdays", thu: "Thursdays", fri: "Fridays", sat: "Saturdays", sun: "Sundays" };
const AREA_WORDS = ["checkout", "pricing", "payments", "homepage", "product page", "cart", "delivery", "returns", "store agent", "auth", "ci"];
const ACTION_LABEL: Record<PolicyAction, string> = {
  ship: "ship",
  stop: "stop",
  pause: "pause",
  publish: "publish",
  open_pr: "open a pull request",
  merge: "merge",
  reset: "reset",
};

/** Plain English for a compiled guard. This is the read-back the merchant confirms. */
export function describeGuard(guard: PolicyGuard): string {
  const actions = guard.actions.length === ALL_ACTIONS.length ? ALL_ACTIONS.map((a) => ACTION_LABEL[a]) : guard.actions.map((a) => ACTION_LABEL[a]);
  const list = actions.length === 1 ? actions[0] : `${actions.slice(0, -1).join(", ")} or ${actions[actions.length - 1]}`;
  const about = guard.areas?.length ? ` anything about ${guard.areas.join(", ")}` : "";
  const days = guard.weekdays?.length ? ` on ${guard.weekdays.map((d) => DAY_LABEL[d]).join(" and ")}` : "";
  if (guard.effect === "deny") return `Darwin must never ${list}${about}${days}.`;
  const conditions: string[] = [];
  if (guard.minProbability !== undefined) conditions.push(`the chance of beating the original is at least ${+(guard.minProbability * 100).toFixed(1)}%`);
  if (guard.minRealPerArm !== undefined) conditions.push(`there are at least ${guard.minRealPerArm} real visitors per arm`);
  if (guard.maxPerDay !== undefined) conditions.push(`it has done that at most ${guard.maxPerDay} times a day`);
  const when = conditions.length ? ` when ${conditions.join(" and ")}` : "";
  return `Darwin may ${list}${about}${days} on its own${when}.`;
}

/** The built-in compiler: the same phrasing `describeGuard` writes, plus the way merchants actually type. */
export function compileGuardHeuristic(text: string): PolicyGuard {
  const t = text.toLowerCase();
  const effect: PolicyGuard["effect"] = /\b(never|don't|do not|no\b.*\bwithout|must not|avoid)\b/.test(t) ? "deny" : "allow";

  const actions = new Set<PolicyAction>();
  if (/\bship(s|ping|ped)?\b|\bwinners?\b|\brolls? out\b/.test(t)) actions.add("ship");
  if (/\bstops?\b|\bkills?\b|\bends?\b/.test(t)) actions.add("stop");
  if (/\bpauses?\b/.test(t)) actions.add("pause");
  if (/\bpublish(es|ing)?\b|\blive for everyone\b/.test(t)) actions.add("publish");
  if (/\bpull requests?\b|\bprs?\b/.test(t)) actions.add("open_pr");
  if (/\bmerges?\b/.test(t)) actions.add("merge");
  if (/\bresets?\b/.test(t)) actions.add("reset");
  // "never touch checkout on Fridays": no verb named, so it covers everything.
  if (!actions.size) for (const a of ALL_ACTIONS) actions.add(a);

  const probability = t.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  const perArm = t.match(/(\d[\d,]*)\s*(?:real\s+)?(?:visitors|conversations|people|sessions)/);
  const perDay = t.match(/(?:at most|max(?:imum)?|no more than|up to)\s+(\d{1,2})\s*(?:times?|changes?|ships?)?\s*(?:a|per)\s*day/);
  const areas = AREA_WORDS.filter((w) => t.includes(w));
  const weekdays = DAYS.filter((d) => DAY_WORDS[d].test(t));


  const guard: PolicyGuard = {
    effect,
    actions: ALL_ACTIONS.filter((a) => actions.has(a)),
    ...(effect === "allow" && probability ? { minProbability: Math.min(1, Number(probability[1]) / 100) } : {}),
    ...(effect === "allow" && perArm ? { minRealPerArm: Number(perArm[1].replace(/,/g, "")) } : {}),
    ...(areas.length ? { areas } : {}),
    ...(weekdays.length ? { weekdays: [...weekdays] } : {}),
    ...(effect === "allow" && perDay ? { maxPerDay: Number(perDay[1]) } : {}),
  };
  return PolicyGuardSchema.parse(guard);
}

const COMPILE_SYSTEM = [
  "You turn a merchant's standing instruction to their AI store team into a strict machine-readable guard.",
  DARWIN_VOICE,
  'Output JSON: { "effect": "allow" | "deny", "actions": [...], "minProbability"?: 0..1, "minRealPerArm"?: integer, "areas"?: [string], "weekdays"?: ["mon"..."sun"], "maxPerDay"?: integer }.',
  'actions are from ship, stop, pause, publish, open_pr, merge, reset. "deny" with no verb named covers every action.',
  "Only encode what the merchant actually said. Percentages become fractions (95% → 0.95). Never invent a threshold.",
].join("\n");

/** Compile a plain-English policy. LLM when available, patterns otherwise; both land on the same schema. */
export async function compilePolicy(text: string, opts: { now?: number } = {}): Promise<Policy> {
  const trimmed = text.trim().slice(0, 400);
  const now = opts.now ?? Date.now();
  let guard = compileGuardHeuristic(trimmed);
  let source: Policy["source"] = "heuristic";
  if (llmAvailable()) {
    try {
      guard = await generateJson({
        system: COMPILE_SYSTEM,
        prompt: `Merchant's standing policy: "${trimmed}"`,
        schema: PolicyGuardSchema,
        maxTokens: 400,
      });
      source = "llm";
    } catch (err) {
      console.warn("[watch] policy compile fell back to patterns:", String(err).slice(0, 160));
    }
  }
  return {
    id: id("pol"),
    text: trimmed,
    guard,
    source,
    compiled: describeGuard(guard),
    createdAt: new Date(now).toISOString(),
    uses: 0,
  };
}


/* ------------------------------------------------------------------ deciding */

/** What a guard needs to know about the thing being acted on. */
export interface PolicyFacts {
  /** P(beat control) as the owning area reported it. */
  probability?: number;
  /** Real (non-simulated) visitors or conversations in the smaller arm. */
  realPerArm?: number;
  /** Title / target, for `areas` matching. */
  label: string;
  /** The facts are from simulated traffic (a policy about real visitors can never be met). */
  synthetic?: boolean;
}

export interface AutonomyDecision {
  allowed: boolean;
  /** Plain English: why Darwin may or may not do this by himself. */
  reason: string;
  risk: ActionRisk;
  /** The policy that allowed it (logged with the action). */
  policy?: Policy;
  /** The policy that forbade it. */
  blockedBy?: Policy;
}

function weekdayIn(timezone: string, now: number): (typeof DAYS)[number] {
  const short = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(new Date(now)).slice(0, 3).toLowerCase();
  return (DAYS as readonly string[]).includes(short) ? (short as (typeof DAYS)[number]) : "mon";
}

/** Does this policy apply to this action right now? (Ignores allow/deny: that's the caller's business.) */
export function policyMatches(policy: Policy, action: WatchAction, facts: PolicyFacts, opts: { now: number; timezone: string }): boolean {
  if (!policy.confirmedAt) return false;
  const verb = policyActionOf(action);
  if (!verb || !policy.guard.actions.includes(verb)) return false;
  const { areas, weekdays, minProbability, minRealPerArm, maxPerDay, effect } = policy.guard;
  if (areas?.length) {
    const hay = `${facts.label} ${JSON.stringify(action)}`.toLowerCase();
    if (!areas.some((a) => hay.includes(a.toLowerCase()))) return false;
  }
  if (weekdays?.length && !weekdays.includes(weekdayIn(opts.timezone, opts.now))) return false;
  if (effect === "deny") return true;
  if (minProbability !== undefined && !(facts.probability !== undefined && facts.probability >= minProbability)) return false;
  if (minRealPerArm !== undefined && !(facts.realPerArm !== undefined && facts.realPerArm >= minRealPerArm)) return false;
  if (maxPerDay !== undefined && policyUsesToday(policy.id, opts.now) >= maxPerDay) return false;
  return true;
}

/**
 * May Darwin run this action without asking? Deny policies win over everything; drastic actions need an
 * `allow` policy even on autopilot.
 */
export function canRunUnattended(
  action: WatchAction,
  facts: PolicyFacts,
  opts: { level?: AutonomyLevel; now?: number; timezone?: string; policies?: Policy[] } = {},
): AutonomyDecision {
  const settings = getWatchSettings();
  const level = opts.level ?? settings.autonomy;
  const now = opts.now ?? Date.now();
  const timezone = opts.timezone ?? settings.timezone;
  const policies = opts.policies ?? listPolicies();
  const risk = actionRisk(action, facts.label);

  const blockedBy = policies.find((p) => p.guard.effect === "deny" && policyMatches(p, action, facts, { now, timezone }));
  if (blockedBy) return { allowed: false, risk, reason: `Your standing policy says no: “${blockedBy.compiled}”`, blockedBy };

  if (level === "off" || level === "suggest") {
    return { allowed: false, risk, reason: level === "off" ? "Darwin's autonomy is off." : "Darwin is on suggest: it waits for your tap." };
  }
  if (risk === "safe") return { allowed: true, risk, reason: level === "auto-safe" ? "Reversible, so Darwin can do it and tell you after." : "Reversible: Darwin does it and reports." };
  if (level === "auto-safe") return { allowed: false, risk, reason: "That one isn't reversible, so it needs your tap." };

  const policy = policies.find((p) => p.guard.effect === "allow" && policyMatches(p, action, facts, { now, timezone }));
  if (policy) return { allowed: true, risk, reason: `Your standing policy allows it: “${policy.compiled}”`, policy };
  return { allowed: false, risk, reason: "Even on autopilot, a change this big needs your tap or a standing policy that covers it." };
}
