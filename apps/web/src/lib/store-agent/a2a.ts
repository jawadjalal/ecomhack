/**
 * A2A (agent-to-agent) for the store agent: JSON-RPC 2.0 on one URL, speaking
 *   v1.0  SendMessage   { message: { role: "ROLE_USER", parts: [{ text }] } } → { message: { role: "ROLE_AGENT", parts } }
 *   v0.3  message/send  { message: { kind: "message", role: "user", parts: [{ kind: "text", text }] } } → { kind: "message", … }
 * Replies carry a text part (for LLM agents) and a data part (offers / checkout) for programmatic ones.
 */
import { id } from "@/lib/ids";
import { replyTo, type AgentTurn } from "./agent";
import { getCatalog } from "./catalog";

type Json = Record<string, unknown>;

const rpcError = (reqId: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: reqId ?? null, error: { code, message } });

function textOf(message: Json | undefined): string {
  const parts = Array.isArray(message?.parts) ? (message!.parts as Json[]) : [];
  return parts
    .map((p) => (typeof p.text === "string" ? p.text : p.kind === "data" || p.data ? JSON.stringify(p.data) : ""))
    .filter(Boolean)
    .join("\n");
}

function v1(turn: AgentTurn) {
  return { message: { messageId: id("msg"), contextId: turn.contextId, role: "ROLE_AGENT", parts: [{ text: turn.text }, { data: turn.data }] } };
}

function v03(turn: AgentTurn) {
  return { kind: "message", messageId: id("msg"), contextId: turn.contextId, role: "agent", parts: [{ kind: "text", text: turn.text }, { kind: "data", data: turn.data }] };
}

/** Handle one JSON-RPC request body. `agentName` comes from the X-Agent-Name header or the message metadata. */
export async function handleA2a(body: unknown, opts: { origin: string; agentName?: string; synthetic?: boolean }): Promise<Json> {
  const req = (body && typeof body === "object" ? body : {}) as Json;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(req.id, -32600, "Invalid request: expected JSON-RPC 2.0");
  const params = (req.params && typeof req.params === "object" ? req.params : {}) as Json;
  const message = (params.message && typeof params.message === "object" ? params.message : undefined) as Json | undefined;
  const meta = { ...((params.metadata as Json) ?? {}), ...((message?.metadata as Json) ?? {}) };
  const agentName = opts.agentName ?? (typeof meta.agent_name === "string" ? meta.agent_name : undefined) ?? (typeof meta.agentName === "string" ? meta.agentName : undefined);

  switch (req.method) {
    case "SendMessage":
    case "message/send": {
      const text = textOf(message);
      if (!text.trim()) return rpcError(req.id, -32602, "message.parts needs at least one text part");
      const contextId = typeof message?.contextId === "string" ? message.contextId : undefined;
      const turn = await replyTo(text, { contextId, agentName, origin: opts.origin, synthetic: opts.synthetic });
      return { jsonrpc: "2.0", id: req.id ?? null, result: req.method === "SendMessage" ? v1(turn) : v03(turn) };
    }
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}. Use SendMessage (A2A v1.0) or message/send (v0.3).`);
  }
}

/** The agent card buyer agents discover it by. */
export async function storeAgentCard(origin: string) {
  const catalog = await getCatalog();
  const url = `${origin}/a2a/whop`;
  const acp = `${origin}/acp/checkout_sessions`;
  const mcp = `${origin}/api/store-agent/mcp`;
  return {
    name: `${catalog.business} · store agent`,
    description: `Ask what ${catalog.business} sells, with prices and billing, and get a checkout link to buy. Payments happen on Whop.${catalog.source === "demo" ? " (Demo catalog: no real charges.)" : ""}`,
    url,
    version: "1.0.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    supportedInterfaces: ["1.0", "0.3"].map((v) => ({ url, protocolBinding: "JSONRPC", protocolVersion: v })),
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    provider: { organization: catalog.business, url: origin },
    skills: [
      {
        id: "find_offers",
        name: "Find offers",
        description: "Search the store by need, budget and one-off vs membership. Returns up to 3 offers with price and billing.",
        tags: ["catalog", "search", "pricing"],
        examples: ["Trail running coaching under £40 a month", "Something one-off under £20"],
      },
      {
        id: "checkout",
        name: "Checkout",
        description: "Returns a checkout link for an offer (by name, or 'the first one'). The payment is credited to your agent.",
        tags: ["checkout", "purchase"],
        examples: ["Buy the first one", "Buy Race-Day Pack"],
      },
      {
        id: "checkout_acp",
        name: "Checkout via ACP",
        description: `Agentic Commerce Protocol checkout sessions at ${acp}: POST { items: [{ id, quantity }] } with offer ids, then /complete. Amounts in minor units.`,
        tags: ["checkout", "acp", "agentic-commerce-protocol"],
        examples: [`POST ${acp} {"items":[{"id":"${catalog.offers[0]?.id ?? "plan_…"}","quantity":1}]}`],
      },
      {
        id: "mcp_tools",
        name: "MCP tools",
        description: `The same store as MCP tools at ${mcp} (Streamable HTTP, JSON-RPC): search_offers, get_offer, create_checkout, store_info.`,
        tags: ["mcp", "tools", "checkout"],
        examples: ["search_offers { query: 'coaching under £40 a month' }", "create_checkout { offer_id }"],
      },
    ],
    /** Other ways to buy: ACP checkout sessions and MCP tools (same catalog, same funnel). */
    links: [
      { type: "acp", url: acp, description: "Agentic Commerce Protocol checkout sessions" },
      { type: "mcp", url: mcp, description: "MCP server (Streamable HTTP, JSON responses)" },
    ],
  };
}
