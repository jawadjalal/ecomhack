/**
 * Per-agent-session state in the KV store: carts/deals/orders and session summaries.
 * Always read through kvGet (never hold references across calls) so a reset elsewhere is seen.
 */
import type { AgentSessionSummary, NegotiationTurn } from "@/lib/contracts";
import { kvDelete, kvGet, kvSet } from "@/lib/db/json-store";
import type { NegotiationState } from "./negotiation";
import type { AgentOrder, CartLine } from "./types";

/** KV keys owned by this module (the optimizer's reset clears them). */
export const AGENT_KV_KEYS = { sessions: "agent-sessions", carts: "agent-carts" } as const;

export const MAX_SESSIONS = 300;
const MAX_CARTS = 500;
const MAX_TOOL_CALLS = 40;
const MAX_TURNS = 30;

export interface SessionCommerceState {
  cart: CartLine[];
  /** Negotiated unit prices by product id (pence). Honoured by add_to_cart and checkout. */
  deals: Record<string, number>;
  negotiations: Record<string, NegotiationState>;
  orders: AgentOrder[];
  updatedAt: string;
}

type CartStore = Record<string, SessionCommerceState>;

const emptyCarts = (): CartStore => ({});
const emptySessions = (): AgentSessionSummary[] => [];

export function emptyCommerceState(): SessionCommerceState {
  return { cart: [], deals: {}, negotiations: {}, orders: [], updatedAt: new Date(0).toISOString() };
}

/** A copy of the session's commerce state (safe to mutate; persist with saveCommerceState). */
export function getCommerceState(sessionId: string): SessionCommerceState {
  const s = kvGet(AGENT_KV_KEYS.carts, emptyCarts)[sessionId];
  return s ? structuredClone(s) : emptyCommerceState();
}

export function saveCommerceState(sessionId: string, state: SessionCommerceState) {
  const store = kvGet(AGENT_KV_KEYS.carts, emptyCarts);
  // Delete + re-insert keeps insertion order == recency, so trimming drops the stalest sessions.
  delete store[sessionId];
  store[sessionId] = state;
  const keys = Object.keys(store);
  for (let i = 0; i < keys.length - MAX_CARTS; i++) delete store[keys[i]];
  kvSet(AGENT_KV_KEYS.carts, store);
}

/** How long a real (non-simulated) agent session stays at the front of the list after its last tool call. */
export const REAL_SESSION_PIN_MS = 3 * 60_000;
const MAX_PINNED_REAL = 3;

function lastActivity(s: AgentSessionSummary): number {
  return Date.parse(s.toolCalls.at(-1)?.at ?? s.startedAt);
}

/**
 * Recent agent sessions, newest first. Real agents (Cursor, Claude, … over MCP) active in the last
 * few minutes come first, so they aren't buried under simulated traffic.
 */
export function listAgentSessions(limit = 20, now = Date.now()): AgentSessionSummary[] {
  const list = kvGet(AGENT_KV_KEYS.sessions, emptySessions);
  const live = list.filter((s) => !s.synthetic && now - lastActivity(s) < REAL_SESSION_PIN_MS).slice(0, MAX_PINNED_REAL);
  const ordered = live.length ? [...live, ...list.filter((s) => !live.includes(s))] : list;
  return ordered.slice(0, Math.max(0, limit));
}

export function getAgentSession(sessionId: string): AgentSessionSummary | undefined {
  return kvGet(AGENT_KV_KEYS.sessions, emptySessions).find((s) => s.sessionId === sessionId);
}

/**
 * Create-or-update a session summary in place. `init` builds a new one when the session is unseen.
 * New sessions go to the front; the list is capped at MAX_SESSIONS.
 */
export function upsertAgentSession(
  sessionId: string,
  init: () => AgentSessionSummary,
  update: (s: AgentSessionSummary) => void,
): AgentSessionSummary {
  const list = kvGet(AGENT_KV_KEYS.sessions, emptySessions);
  let session = list.find((s) => s.sessionId === sessionId);
  if (!session) {
    session = init();
    list.unshift(session);
    if (list.length > MAX_SESSIONS) {
      // Drop the oldest simulated session first so a real agent's session survives heavy synthetic traffic.
      const oldestSim = list.findLastIndex((s) => s.synthetic);
      list.splice(oldestSim > 0 ? oldestSim : list.length - 1, 1);
    }
  }
  update(session);
  if (session.toolCalls.length > MAX_TOOL_CALLS) session.toolCalls.splice(0, session.toolCalls.length - MAX_TOOL_CALLS);
  if (session.negotiation && session.negotiation.length > MAX_TURNS) {
    session.negotiation.splice(0, session.negotiation.length - MAX_TURNS);
  }
  kvSet(AGENT_KV_KEYS.sessions, list);
  return session;
}

export function appendNegotiation(session: AgentSessionSummary, turns: NegotiationTurn[]) {
  session.negotiation = [...(session.negotiation ?? []), ...turns];
}

/** Forget every agent cart and session (used by the demo reset). */
export function resetAgentState() {
  kvDelete(AGENT_KV_KEYS.sessions);
  kvDelete(AGENT_KV_KEYS.carts);
}
