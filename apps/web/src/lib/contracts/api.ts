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
// GET  /api/experiments                → { experiments: Experiment[] }
export interface ExperimentsResponse {
  experiments: Experiment[];
}

/* github PR */
// POST /api/github/connect  { repoUrl }        → PullRequestResult (analytics install PR)
// POST /api/github/ship     { experimentId? }  → PullRequestResult (winning spec PR)
// GET  /api/github/status                      → { configured: boolean, repo?: string }
export interface GithubStatusResponse {
  configured: boolean;
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
// POST /api/assistant  { messages, confirm?, context? } → AssistantResponse   (admin)
//      Darwin, the merchant's managing assistant: runs tools over the public module APIs.
//      Side-effecting tools (ship_winner, set_autopilot, reset_loop) come back as `pendingConfirm`;
//      send `confirm: { tool, args, approved }` to run (or cancel) them.
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
}
export interface AssistantResponse {
  reply: string;
  actions: AssistantAction[];
  pendingConfirm?: AssistantPendingConfirm;
  /** llmLabel() of the model that drove the turn, or "heuristic". */
  model: string;
  /** Follow-up prompts to offer as chips. */
  suggestions?: string[];
}

/* team (lib/team, /api/team/**) — see contracts/team.ts for every shape */
// POST /api/team/chat   TeamChatRequest { chatId?, agentId?, text, confirm?: { id, approved }, context? }
//      → NDJSON stream (application/x-ndjson) of TeamEvent: message | chat_created | agent_status | progress
//        | navigate | done | error. Darwin (manager) plans, delegates to specialists concurrently (group chats,
//        short progress messages), then reports back. Side-effecting tools come back as a `confirm` message with
//        `pendingConfirm`; nothing runs until the user sends `confirm: { id, approved: true }`. (admin)
// GET  /api/team               → TeamStateResponse { agents, chats (with lastMessage, messageCount), model }
// GET  /api/team/chats/[id]    → TeamChatResponse { chat, messages }   (404 { error } when unknown)
// POST /api/team/chats         CreateTeamChatRequest { title?, members } → { chat }   (user-created chat)

/* voice */
// GET  /api/voice            → VoiceStatusResponse                          (admin)
// POST /api/voice/tts        { text, agent? } → audio/mpeg stream (agent's ElevenLabs voice; admin, rate-limited)
// POST /api/voice/stt        multipart { audio, language? } → VoiceTranscriptResponse  (admin, rate-limited, 10 MB max)
export interface VoiceStatusResponse {
  available: boolean;
}
export interface VoiceTranscriptResponse {
  text: string;
  language?: string;
}

export type { PageSpec };
