/**
 * Darwin's watch: the always-on side of the team. OWNED BY: team.
 *
 * Every 15 minutes a `watch` run asks the team to look at the store with their real tools, turns what they
 * find into **signals**, decides whether any of them is worth the merchant's attention, and (when it is)
 * writes one short message into the Inbox chat with one-tap actions.
 *
 * API (all admin; /api/team is behind the admin gate):
 *   POST /api/team/watch      { reason? } → WatchRunResponse   (also accepts Vercel Cron's CRON_SECRET bearer)
 *   GET  /api/team/watch                 → WatchStateResponse  (the console's "Darwin's watch" strip)
 *   GET  /api/team/inbox                 → TeamInboxResponse   (what the Grok bot reads)
 *   POST /api/team/chat  { confirm: { id: <action token>, approved } } → the usual TeamEvent stream
 *   POST /api/team/autonomy   { level? , policy? , policyId? } → AutonomyResponse
 */
import type { AgentId, ChatMessage } from "./team";

/* ------------------------------------------------------------------ signals */

export type SignalKind =
  /** A test reached a decision (ready to ship, clearly losing, just shipped). */
  | "experiment_decided"
  /** A KPI moved outside the band of what this store usually does (real traffic only). */
  | "kpi_band"
  /** The AI-shopper funnel is losing agents at one step. */
  | "agent_funnel_drop"
  /** A pull request merged, failed its checks, or has been waiting. */
  | "pr_state"
  /** The agent-readiness score of the connected store moved. */
  | "readiness_change"
  /** New competitor / market research landed. */
  | "research_finding"
  /** The optimisation loop hasn't moved on from a phase. */
  | "loop_stuck"
  /** A week after a ship: is it still winning? */
  | "ship_followup";

export type SignalSeverity = "low" | "normal" | "high" | "urgent";

/** What one tap does. Each maps onto the public API of the area that owns it. */
export type WatchAction =
  /** Ship or stop a briefing item (a store page test, a web test or a store-agent pitch test). */
  | { type: "briefing"; id: string; action: "ship" | "stop"; title: string }
  /** Run one of the team's tools (validated against that agent's registry when it runs). */
  | { type: "tool"; agent: AgentId; tool: string; args: Record<string, unknown> }
  /** Open a page in the console. */
  | { type: "open"; href: string }
  /** "Not now": remember the no, change nothing. */
  | { type: "dismiss" };

/** Drastic actions (merge, real PR, publish to real traffic, ship, reset) always need a tap or a policy. */
export type ActionRisk = "safe" | "drastic";

/** A proposed one-tap action, as it appears on a message. The token is single-use and expires. */
export interface ProactiveAction {
  /** Send it back as `confirm.id` on POST /api/team/chat (or `token` on MCP `team_decide`). */
  token: string;
  label: string;
  risk: ActionRisk;
  /** Approving is the point of the action; "dismiss" actions record a no instead. */
  kind: WatchAction["type"];
  expiresAt: string;
}

/** One thing the team noticed in a watch run. Facts and sources come from that run's tool results. */
export interface Signal {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  /** Which teammate found it. */
  agent: AgentId;
  /** Short headline, Darwin's voice. */
  title: string;
  /** The numbers, in plain English, exactly as the tools reported them. */
  facts: string[];
  /** Tool names (or public APIs) the facts came from, in this run. */
  sources: string[];
  /** The facts involve simulated traffic or simulated buyers. */
  synthetic: boolean;
  /** Same signal twice = same fingerprint (used to dedupe for 24 hours). */
  fingerprint: string;
  /** How pressing the underlying number is, 0-1, higher = worse. Lets "it got worse" beat the dedupe. */
  score?: number;
  /** The numbers behind the facts, as the tools reported them (never recomputed). */
  data?: Record<string, unknown>;
  suggestedAction?: WatchAction;
  /** Console page with the details. */
  href?: string;
  /** Group chat the team opened while working on this signal. */
  chatId?: string;
  at: string;
}

/* ------------------------------------------------------------------ the gate */

export type QuietReason =
  | "nothing-notable"
  | "duplicate"
  | "rate-limited"
  | "quiet-hours"
  | "autonomy-off"
  | "cooldown"
  | "budget";

/** Why a signal did or didn't become a message. */
export interface SignalVerdict {
  signalId: string;
  /** severity × novelty × actionability. */
  score: number;
  spoke: boolean;
  /** Set when it stayed quiet, or when it went into the digest instead. */
  reason?: QuietReason;
  digested?: boolean;
}

/* ------------------------------------------------------------------ runs */

export interface WatchCheckReport {
  id: string;
  agent: AgentId;
  label: string;
  ok: boolean;
  ms: number;
  signals: number;
  /** What the check couldn't read (Darwin says so rather than guessing). */
  error?: string;
}

export interface WatchBudget {
  toolCalls: number;
  llmCalls: number;
  wallMs: number;
}

export interface WatchRun {
  id: string;
  at: string;
  reason: "cron" | "manual" | "dev";
  durationMs: number;
  checks: WatchCheckReport[];
  signals: Signal[];
  verdicts: SignalVerdict[];
  /** Message ids Darwin posted in the Inbox this run (usually 0 or 1). */
  messageIds: string[];
  /** Set when the run stopped early because it hit a budget. */
  budgetHit?: keyof WatchBudget;
  used: WatchBudget;
  /** Outbound channels that took a copy (in-app Inbox is always first). */
  delivered?: { channel: string; ok: boolean; note?: string }[];
  /** Nothing was sent, and why. */
  quiet?: QuietReason;
}

/* ------------------------------------------------------------------ autonomy */

/** How much Darwin may do on his own. */
export type AutonomyLevel = "off" | "suggest" | "auto-safe" | "autopilot";

/** A standing policy the merchant wrote in plain English, compiled into a guard. */
export interface PolicyGuard {
  effect: "allow" | "deny";
  /** Which actions it covers. */
  actions: ("ship" | "stop" | "pause" | "publish" | "open_pr" | "merge" | "reset")[];
  /** Minimum P(beat control) before the action may run by itself. */
  minProbability?: number;
  /** Minimum real (non-simulated) visitors or conversations per arm. */
  minRealPerArm?: number;
  /** Only for things whose title/target mentions one of these words (e.g. "checkout"). */
  areas?: string[];
  /** Days it applies on, in the merchant's timezone. Empty = every day. */
  weekdays?: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
  /** At most this many policy-driven actions a day. */
  maxPerDay?: number;
}

export interface Policy {
  id: string;
  /** What the merchant typed. */
  text: string;
  guard: PolicyGuard;
  /** How it was compiled (an LLM, or the built-in patterns). */
  source: "llm" | "heuristic";
  /** Plain English read back from the compiled guard, for the merchant to confirm. */
  compiled: string;
  createdAt: string;
  /** The merchant agreed the compiled form is right. Until then it never fires. */
  confirmedAt?: string;
  uses: number;
  lastUsedAt?: string;
}

export interface WatchSettings {
  autonomy: AutonomyLevel;
  /** IANA timezone for quiet hours and the digest (default Europe/London). */
  timezone: string;
  /** Local hours [start, end) when Darwin only speaks for "urgent" signals. */
  quietHours: { start: number; end: number };
  /** Local hour the daily digest goes out. */
  digestHour: number;
  /** Off: the heartbeat still runs and logs, but nothing is ever sent. */
  enabled: boolean;
}

/** POST /api/team/autonomy */
export interface AutonomyResponse {
  settings: WatchSettings;
  policies: Policy[];
  /** Set after compiling a new policy: read it back to the merchant before it counts. */
  compiled?: Policy;
  text: string;
}

/* ------------------------------------------------------------------ responses */

/** GET /api/team/watch — everything the console's "Darwin's watch" strip shows. */
export interface WatchStateResponse {
  settings: WatchSettings;
  policies: Policy[];
  /** Newest first. */
  runs: WatchRun[];
  lastRunAt?: string;
  nextRunAt?: string;
  /** Watch runs in the last 24 hours. */
  runsToday: number;
  signalsToday: number;
  messagesToday: number;
  /** The Inbox chat id (so the console can open it). */
  inboxChatId: string;
  unread: number;
  /** Actions still open (not used, not expired). */
  openActions: ProactiveAction[];
  /** The heartbeat is scheduled (Vercel Cron in production, DARWIN_WATCH=1 in dev). */
  scheduled: boolean;
}

/** POST /api/team/watch */
export interface WatchRunResponse {
  ok: boolean;
  /** False when another run held the lease (idempotency), with `text` saying so. */
  ran: boolean;
  text: string;
  run?: WatchRun;
}

/** One message in the Inbox, as an outside channel (the Grok bot) sees it. */
export interface InboxMessage {
  id: string;
  at: string;
  /** One or two sentences in Darwin's voice. Forward it as-is. */
  text: string;
  severity: SignalSeverity;
  synthetic: boolean;
  signalId?: string;
  kind?: SignalKind;
  /** Tap one: POST /api/team/chat { confirm: { id: <token>, approved: true } }. */
  actions: ProactiveAction[];
  sources: string[];
  href?: string;
}

/** GET /api/team/inbox */
export interface TeamInboxResponse {
  chatId: string;
  unread: number;
  /** Newest last (so a bot can forward the last one). */
  messages: InboxMessage[];
  /** Nothing new since `since`. */
  lastAt?: string;
  autonomy: AutonomyLevel;
  nextRunAt?: string;
}

/** The raw chat message an Inbox entry came from (the console renders these). */
export type InboxChatMessage = ChatMessage;
