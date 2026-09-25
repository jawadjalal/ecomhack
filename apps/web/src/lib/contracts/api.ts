/**
 * HTTP API contract. Route → owner → response shape.
 * The console builds against these; owners must return exactly these shapes.
 */
import type { AnalyticsEvent } from "./events";
import type { AnalyticsSummary } from "./analytics";
import type { Experiment, LoopState } from "./loop";
import type { AgentSessionSummary } from "./agent";
import type { PageSpec } from "./page-spec";

/* scaffold */
// POST /api/capture            body { events: AnalyticsEventInput[] } → { ok, count }
// GET  /api/spec[?distinct_id] → { spec } | ResolvedSpec

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
// MCP:        POST /api/mcp (JSON-RPC 2.0: initialize, tools/list, tools/call)
// Discovery:  GET /llms.txt, GET /.well-known/agent-card.json

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

export type { PageSpec };
