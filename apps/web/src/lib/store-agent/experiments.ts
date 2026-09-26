/**
 * A/B tests on how the store agent sells, judged on what matters: did the buyer agent's conversation end
 * in a payment?
 *
 * The pitch is a set of levers (facts up front, one best pick, structured buy instructions, upsell). Each
 * test turns ONE lever on for half the conversations (sticky per conversation) against the current
 * default. Autopilot ships a winner into the default, stops a loser, then tests the next lever, so wins
 * stack round after round. Same Bayesian comparison as the web tests.
 */
import type { AnalyticsEvent } from "@/lib/contracts";
import { kvGet, kvSet } from "@/lib/db/json-store";
import { hashToUnit } from "@/lib/experiments/assign";
import { id } from "@/lib/ids";
import { comparePosteriors } from "@/lib/optimizer";

export type Lever = "facts" | "one-pick" | "structured" | "upsell";

export const LEVERS: Record<Lever, { label: string; hypothesis: string }> = {
  facts: {
    label: "Facts up front",
    hypothesis: "Agents buy when they can answer their user's objections: instant access, cancel any time, payment handled by Whop.",
  },
  "one-pick": {
    label: "One best pick",
    hypothesis: "An agent acting for someone wants a decision, not a menu: one recommendation with the reason beats a list of three.",
  },
  structured: {
    label: "Structured buy instructions",
    hypothesis: "Programmatic agents read the data part: exact offer ids, prices and 'reply buy <id>' remove guesswork.",
  },
  upsell: {
    label: "Upsell the yearly plan",
    hypothesis: "Leading with the biggest plan raises order value (it may cost conversions: that's what the test is for).",
  },
};

export const LEVER_ORDER: Lever[] = ["facts", "one-pick", "structured", "upsell"];

/**
 * When a test may be called. Checked after every batch of conversations (peeking), so the bars are high:
 * 100 conversations and 30 payments before any call, 97% to ship, 3% to stop.
 */
export const AGENT_TEST_RULES = { minPerArm: 100, minPaid: 30, ship: 0.97, stop: 0.03, maxPerArm: 1500 } as const;

export interface AgentTest {
  id: string;
  lever: Lever;
  /** Levers both arms have (the default when the test started). */
  base: Lever[];
  status: "running" | "shipped" | "stopped";
  startedAt: string;
  endedAt?: string;
  reason?: string;
}

export interface AgentTestState {
  /** Levers in the default pitch (shipped winners). */
  levers: Lever[];
  tests: AgentTest[];
  autopilot: boolean;
  log: { at: string; text: string }[];
}

export interface AgentArm {
  conversations: number;
  paid: number;
  rate: number;
  revenue: number;
}

export interface AgentTestResult {
  testId: string;
  control: AgentArm;
  treatment: AgentArm;
  probabilityToBeat?: number;
  lift?: number;
  liftInterval?: [number, number];
}

const KEY = "store-agent-tests";
const fresh = (): AgentTestState => ({ levers: [], tests: [], autopilot: false, log: [] });

export function getAgentTests(): AgentTestState {
  return kvGet<AgentTestState>(KEY, fresh);
}

function save(s: AgentTestState): AgentTestState {
  return kvSet(KEY, { ...s, log: s.log.slice(0, 40) });
}

export function resetAgentTests() {
  kvSet(KEY, fresh());
}

const log = (s: AgentTestState, text: string): AgentTestState => ({ ...s, log: [{ at: new Date().toISOString(), text }, ...s.log] });

export function runningTest(s = getAgentTests()): AgentTest | undefined {
  return s.tests.find((t) => t.status === "running");
}

/** The pitch a new conversation gets: its arm in the running test (sticky by conversation id), else the default. */
export function pitchFor(contextId: string): { levers: Lever[]; testId?: string; variant?: "control" | "treatment" } {
  const s = getAgentTests();
  const t = runningTest(s);
  if (!t) return { levers: s.levers };
  const variant = hashToUnit(`${contextId}:${t.id}`) < 0.5 ? "treatment" : "control";
  return { levers: variant === "treatment" ? [...t.base, t.lever] : t.base, testId: t.id, variant };
}

export function startAgentTest(lever: Lever): AgentTest {
  const s = getAgentTests();
  if (runningTest(s)) throw new Error("A test is already running");
  const test: AgentTest = { id: id("at"), lever, base: s.levers, status: "running", startedAt: new Date().toISOString() };
  save(log({ ...s, tests: [...s.tests, test] }, `Started testing “${LEVERS[lever].label}”: ${LEVERS[lever].hypothesis}`));
  return test;
}

export function setAgentAutopilot(on: boolean): AgentTestState {
  const s = getAgentTests();
  return save(log({ ...s, autopilot: on }, on ? "Autopilot on: Darwin tests one lever at a time on your store agent and keeps the winners." : "Autopilot off."));
}

/** Per test: conversations and payments per arm (conversations tagged by the agent_variant event). */
export function agentTestResults(events: readonly AnalyticsEvent[], s = getAgentTests()): AgentTestResult[] {
  const arms = new Map<string, Map<string, "control" | "treatment">>(); // test → ref → variant
  const paid = new Map<string, number>(); // ref → revenue
  for (const e of events) {
    const p = e.properties ?? {};
    const meta = (p.whop_metadata ?? {}) as Record<string, unknown>;
    const ref = typeof p.darwin_ref === "string" ? p.darwin_ref : typeof meta.darwin_ref === "string" ? meta.darwin_ref : undefined;
    if (!ref) continue;
    if (e.event === "agent_variant" && typeof p.test_id === "string" && (p.variant === "control" || p.variant === "treatment")) {
      let m = arms.get(p.test_id);
      if (!m) arms.set(p.test_id, (m = new Map()));
      if (!m.has(ref)) m.set(ref, p.variant);
    }
    if (e.event === "order_completed") paid.set(ref, (paid.get(ref) ?? 0) + (Number(p.revenue) || 0));
  }
  return s.tests.map((t) => {
    const acc = { control: { conversations: 0, paid: 0, rate: 0, revenue: 0 }, treatment: { conversations: 0, paid: 0, rate: 0, revenue: 0 } };
    for (const [ref, variant] of arms.get(t.id) ?? []) {
      acc[variant].conversations++;
      if (paid.has(ref)) {
        acc[variant].paid++;
        acc[variant].revenue += paid.get(ref)!;
      }
    }
    for (const a of [acc.control, acc.treatment]) a.rate = a.conversations ? a.paid / a.conversations : 0;
    const both = acc.control.conversations > 0 && acc.treatment.conversations > 0;
    const cmp = both ? comparePosteriors({ visitors: acc.control.conversations, conversions: acc.control.paid }, { visitors: acc.treatment.conversations, conversions: acc.treatment.paid }, { draws: 8000, seed: 11 }) : undefined;
    return { testId: t.id, ...acc, probabilityToBeat: cmp?.probabilityToBeat, lift: cmp?.medianLift, liftInterval: cmp?.liftInterval };
  });
}

const pct = (x?: number) => (x === undefined ? "?" : `${Math.round(x * 100)}%`);
const numbersOf = (r: AgentTestResult) =>
  `${pct(r.control.rate)} → ${pct(r.treatment.rate)} of conversations paid, ${pct(r.probabilityToBeat)} chance better, ${r.control.conversations + r.treatment.conversations} conversations`;

/** Decide the running test; start the next lever when autopilot is on. Returns what happened. */
export function stepAgentTests(events: readonly AnalyticsEvent[]): string[] {
  let s = getAgentTests();
  const did: string[] = [];
  const t = runningTest(s);
  if (t) {
    const r = agentTestResults(events, s).find((x) => x.testId === t.id)!;
    const n = Math.min(r.control.conversations, r.treatment.conversations);
    const enough = n >= AGENT_TEST_RULES.minPerArm && r.control.paid + r.treatment.paid >= AGENT_TEST_RULES.minPaid;
    const p = r.probabilityToBeat;
    const numbers = numbersOf(r);
    let decision: "shipped" | "stopped" | undefined;
    if (enough && p !== undefined && p >= AGENT_TEST_RULES.ship) decision = "shipped";
    else if (enough && p !== undefined && p <= AGENT_TEST_RULES.stop) decision = "stopped";
    else if (n >= AGENT_TEST_RULES.maxPerArm) decision = "stopped";
    if (decision) {
      const reason = decision === "shipped" ? `Winner: ${numbers}` : p !== undefined && p <= AGENT_TEST_RULES.stop ? `Losing: ${numbers}` : `No clear winner: ${numbers}`;
      s = {
        ...s,
        levers: decision === "shipped" ? [...t.base, t.lever] : s.levers,
        tests: s.tests.map((x) => (x.id === t.id ? { ...x, status: decision!, endedAt: new Date().toISOString(), reason } : x)),
      };
      const text = decision === "shipped" ? `Shipped “${LEVERS[t.lever].label}” into the agent's pitch. ${reason}.` : `Stopped “${LEVERS[t.lever].label}”. ${reason}.`;
      s = log(s, text);
      did.push(text);
    }
  }
  if (s.autopilot && !runningTest(s)) {
    const next = LEVER_ORDER.find((l) => !s.levers.includes(l) && !s.tests.some((x) => x.lever === l));
    if (next) {
      const test: AgentTest = { id: id("at"), lever: next, base: s.levers, status: "running", startedAt: new Date().toISOString() };
      s = log({ ...s, tests: [...s.tests, test] }, `Started testing “${LEVERS[next].label}”: ${LEVERS[next].hypothesis}`);
      did.push(s.log[0].text);
    }
  }
  save(s);
  return did;
}

export interface AgentTestDecision {
  ok: boolean;
  /** Plain English: what happened, or why nothing did. */
  text: string;
  test?: AgentTest;
}

/**
 * The merchant's call on a running test (e.g. a "yes, ship it" to the briefing bot), ending it the same way
 * stepAgentTests does: shipping puts its lever into the default pitch, stopping leaves the pitch as it was.
 * Pass the events to write the test's numbers into its reason and the log.
 */
function decideAgentTest(testId: string, decision: "shipped" | "stopped", events: readonly AnalyticsEvent[]): AgentTestDecision {
  let s = getAgentTests();
  const t = s.tests.find((x) => x.id === testId);
  if (!t) return { ok: false, text: "There's no store agent test with that id." };
  const label = LEVERS[t.lever].label;
  if (t.status !== "running") return { ok: false, text: `“${label}” isn't running any more: it was already ${t.status}.`, test: t };
  const r = agentTestResults(events, s).find((x) => x.testId === t.id);
  const numbers = r && r.control.conversations + r.treatment.conversations > 0 ? numbersOf(r) : undefined;
  const reason = `${decision === "shipped" ? "Approved" : "Stopped"} by the merchant${numbers ? `: ${numbers}` : ""}`;
  const ended: AgentTest = { ...t, status: decision, endedAt: new Date().toISOString(), reason };
  s = {
    ...s,
    levers: decision === "shipped" ? [...t.base, t.lever] : s.levers,
    tests: s.tests.map((x) => (x.id === t.id ? ended : x)),
  };
  const text =
    decision === "shipped"
      ? `Shipped “${label}” (approved by the merchant): it's now part of the store agent's pitch.${numbers ? ` ${numbers}.` : ""}`
      : `Stopped “${label}” (stopped by the merchant): the store agent's pitch stays as it was.${numbers ? ` ${numbers}.` : ""}`;
  save(log(s, text));
  return { ok: true, text, test: ended };
}

/** Ship a running test's lever into the default pitch, on the merchant's say-so. */
export function shipAgentTest(testId: string, events: readonly AnalyticsEvent[] = []): AgentTestDecision {
  return decideAgentTest(testId, "shipped", events);
}

/** Stop a running test on the merchant's say-so; the default pitch doesn't change. */
export function stopAgentTest(testId: string, events: readonly AnalyticsEvent[] = []): AgentTestDecision {
  return decideAgentTest(testId, "stopped", events);
}
