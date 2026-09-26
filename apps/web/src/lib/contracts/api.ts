/**
 * HTTP API contract. Route → owner → response shape.
 * The console builds against these; owners must return exactly these shapes.
 */
import type { AnalyticsEvent } from "./events";
import type { AnalyticsSummary } from "./analytics";
import type { Experiment, LoopState } from "./loop";
import type { AgentSessionSummary } from "./agent";
import type { PageSpec } from "./page-spec";
import type { ReadinessCertificate } from "./readiness";

/* scaffold */
// POST /api/capture            body { events: AnalyticsEventInput[] } → { ok, count }
// GET  /api/spec[?distinct_id] → { spec } | ResolvedSpec
// POST /api/whop/webhook       Whop Standard Webhooks → track() purchase funnel (see lib/whop)

/* analytics PR */
// GET  /api/analytics/summary?experimentId=&variant=&visitorKind=&specVersion=
export type AnalyticsSummaryResponse = AnalyticsSummary;
// GET  /api/analytics/events?after=<uuid>&limit=100   (live feed, newest last)
export interface AnalyticsEventsResponse {
  events: AnalyticsEvent[];
  cursor?: string;
}
// POST /ingest/e, /ingest/batch, /ingest/i/v0/e, /ingest/flags, /ingest/decide  (posthog-js compatible)

/* agent-commerce PR */
// GET  /api/agent/sessions?limit=20
export interface AgentSessionsResponse {
  sessions: AgentSessionSummary[];
}
// REST tools: GET /api/agent/products, GET /api/agent/products/:id, POST /api/agent/cart,
//             POST /api/agent/negotiate, POST /api/agent/checkout
//             (+ POST /api/agent/availability, GET /api/agent/cart, POST /api/agent/abandon)
//             Every REST tool returns AgentToolResult { ok, data?, error?, missing?, code? }.
// MCP:        POST /api/mcp (JSON-RPC 2.0: initialize, tools/list, tools/call)
// A2A:        POST /api/a2a (A2A 1.0 SendMessage / 0.3 message/send: plain-English conversation with the merchant agent)
// Discovery:  GET /llms.txt, GET /.well-known/agent-card.json
// POST /api/agent/shop  { brief? | goal?: ShoppingGoal, useLlm?, agentName?, via?: "tools" | "a2a" } → AgentShopResponse
//      (runs one in-process buyer agent; console "send a shopper" button; synthetic = true.
//       via "a2a": the buyer talks to the merchant agent in plain English instead of calling tools)
export interface AgentShopResponse {
  session: AgentSessionSummary;
}

/* simulator PR */
// POST /api/simulate  body SimulationOptions → SimulationResult

/* optimizer PR */
// GET  /api/loop                       → LoopState
// POST /api/loop/step                  → LoopState   (advance one phase)
// POST /api/loop/autopilot {on:boolean}→ LoopState
// POST /api/loop/reset                 → LoopState
export type LoopResponse = LoopState;

/* demo store mode (lib/demo) */
// GET  /api/demo → DemoResponse   (is Darwin on the demo store, or on a connected site?)
// POST /api/demo → DemoResponse   ("explore with the demo store": fills the console with labelled simulated shoppers)
export interface DemoConnections {
  /** Connected GitHub repo ("owner/repo"). */
  github?: string;
  /** darwin.js sites with a tracking plan (from onboarding). */
  sites: string[];
  /** Live Whop business title (not the offline "Demo business"). */
  whop?: string;
}
export interface DemoStatus {
  /** "demo": no repo or darwin.js site connected; the console is about the demo store at /store. (Whop alone feeds the store agent.) */
  mode: "demo" | "connected";
  store: { name: string; url: "/store"; catalog: "pace" | "whop" };
  connections: DemoConnections;
  /** The demo store has simulated shoppers in memory (what the Overview's cards read next to the loop history). */
  hasSimulatedTraffic: boolean;
  generation: number;
  /** The demo store is being filled right now. */
  seeding: boolean;
}
export interface DemoResponse {
  status: DemoStatus;
  /** POST only: what it did. "seeded" = ran the loop on a fresh store, "refilled" = one round of shoppers after a restart. */
  action?: "seeded" | "refilled" | "none";
  steps?: number;
}

// GET  /api/experiments               → { experiments: Experiment[] }
export interface ExperimentsResponse {
  experiments: Experiment[];
}

/* github PR */
// POST /api/github/connect  { repoUrl }        → PullRequestResult (analytics install PR)
// POST /api/github/ship     { experimentId? }  → PullRequestResult (winning spec PR)
// GET  /api/github/status                      → { configured, valid, login?, error?, repo? }
export interface GithubStatusResponse {
  /** GITHUB_TOKEN is set on the server (says nothing about whether GitHub accepts it: see `valid`). */
  configured: boolean;
  /** GitHub accepted the token (GET /user, checked at most every 5 minutes). */
  valid?: boolean;
  /** The GitHub account the token belongs to, when valid. */
  login?: string;
  /** Why the token can't be used: "GitHub rejected the token (401)", "Couldn't reach GitHub …". PRs are previews. */
  error?: string;
  repo?: string;
}

/* readiness PR */
// POST /api/readiness                    { url } → ReadinessReport   (429 rate limited, 400 bad/private URL)
// POST /api/readiness/certify            { url } → ReadinessCertificate
//      (audit + AI agent trial; heuristic level from the score when no LLM key. Rate limited per IP
//       and globally; a certificate for the same URL issued in the last 10 minutes is returned as is.)
export type CertifyResponse = ReadinessCertificate;
// GET  /api/readiness/certificate/:id    → ReadinessCertificate (404 { error } when unknown)
// GET  /api/readiness/badge/:id          → image/svg+xml badge ("expired" / "unknown" variants)
// POST /api/leads                        { email, storeUrl?, score?, source? } → { ok, pilotUrl }

/* assistant */
// POST /api/research  { kind: "competitors"|"question", query, store?, parentId? } → ResearchReport  (admin, rate-limited)
//      Tavily web search + extract, summarised by the LLM (heuristic fallback). With parentId, answers a follow-up
//      and returns the parent report with the new entry in `followUps`. Accept: application/x-ndjson streams
//      ResearchStreamEvent lines (steps, then the report). No TAVILY_API_KEY → a labelled demo report.
// GET  /api/research       → { reports: ResearchListItem[], status: ResearchStatus }  (admin)
// GET  /api/research/[id]  → ResearchReport                                          (admin)
// POST /api/assistant  { messages, confirm?, context?, agent? } → AssistantResponse   (admin)
//      `agent` (a CrewId) talks to one crew member directly; without it Darwin (the lead) answers and may consult
//      the others with ask_agent (their exchanges come back as `threads`).
//      Darwin, the merchant's managing assistant: runs tools over the public module APIs.
//      Side-effecting tools (ship_winner, set_autopilot, reset_loop, run_simulation, and step_loop when the next
//      step ships or rolls back) come back as `pendingConfirm`; send `confirm: { tool, args, approved }` to run
//      (or cancel) them. The response never names a model: `source` is "ai" | "rules".
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}
export interface AssistantAction {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  /** The result involves simulated (synthetic) traffic or buyers. */
  synthetic?: boolean;
  link?: { label: string; href: string };
  /** Set by the `navigate` tool: the UI should open `link.href` (a console path starting with "/"). */
  navigate?: boolean;
}

/** The Darwin crew (names, roles, mascots: lib/crew). "darwin" is the lead; the others are specialists. */
export type CrewId = "darwin" | "iris" | "theo" | "ada" | "max" | "mika" | "grok";

/** One message in an agent-to-agent exchange. `from` / `to` are crew names ("Darwin", "Mika", "Shopper"). */
export interface AgentThreadMessage {
  from: string;
  to: string;
  text: string;
  /** ISO-8601. */
  at: string;
}
/** An agent-to-agent exchange run during a turn (Darwin consulting a specialist, a simulated shopper talking to Mika…). */
export interface AgentThread {
  id: string;
  /** Crew names in the exchange, lead first, e.g. ["Darwin", "Mika"]. */
  agents: string[];
  messages: AgentThreadMessage[];
  /** Involves a simulated shopper or simulated data: label it. */
  synthetic?: boolean;
}
export interface AssistantPendingConfirm {
  tool: string;
  args: Record<string, unknown>;
  /** The question to show with Confirm / Cancel. */
  prompt: string;
}
export interface AssistantRequest {
  messages: AssistantMessage[];
  confirm?: { tool: string; args?: Record<string, unknown>; approved: boolean };
  /** Where the merchant is asking from (console path, darwin.js site). */
  context?: { path?: string; site?: string };
  /** Talk to one crew member directly (its persona and its own tools, same confirm rules). Omitted or "darwin": the lead answers and may consult the others. */
  agent?: CrewId;
}
export interface AssistantResponse {
  reply: string;
  actions: AssistantAction[];
  pendingConfirm?: AssistantPendingConfirm;
  /** "ai" when an LLM drove the turn, else "heuristic". Never a model or provider name (those stay in server logs). */
  model: string;
  /** Who answered, for the UI: "ai" (an LLM drove the turn) or "rules" (the built-in keyword router). */
  source?: "ai" | "rules";
  /** Follow-up prompts to offer as chips. */
  suggestions?: string[];
  /** Agent-to-agent exchanges run this turn (ask_agent), in order. */
  threads?: AgentThread[];
  /** Who answered: "darwin" (the lead) or the crew member the request was addressed to. */
  agent?: CrewId;
}

/* team — see contracts/team.ts */
// GET  /api/team             → TeamStateResponse { agents, chats (last message + unread), model }        (admin)
// GET  /api/team/chats/[id]  → TeamChatResponse { chat, messages }                                       (admin)
// POST /api/team/chats       { title?, members } → Chat   (the user starts a direct/group chat)          (admin)
// POST /api/team/chat        { chatId?, agentId?, text, confirm?: { id, approved }, context? }           (admin)
//      → application/x-ndjson stream of TeamEvent (message | chat_created | agent_status | progress | navigate | done).
//      Darwin (manager) plans and delegates to Iris/Pixel/Fizz/Dash concurrently in a group chat; side-effecting
//      tools come back as a `confirm` message with pendingConfirm and run only after `confirm.approved`.
//      No LLM key → keyword routing to the right specialist, results from real tools.

export type { PageSpec };
