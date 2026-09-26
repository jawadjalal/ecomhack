/**
 * A2A agent card and handler for Darwin's team. OWNED BY: team.
 *
 * GET  /a2a/team and /a2a/team/agent-card.json → the card.
 * POST /a2a/team → one turn. Plain text asks Darwin; a message that is an action token (or "yes"/"no")
 * decides it. Admin token, same as the MCP server. Not the shopper agent at /a2a/whop.
 */
import { bearer, isAdminCredential } from "@/lib/auth/admin";
import { teamAsk, teamDecide, teamInbox } from "./remote";
import { resolveReply } from "./channels";

export function teamAgentCard(origin: string) {
  const url = `${origin}/a2a/team`;
  return {
    protocolVersion: "1.0",
    name: "Darwin's team",
    description: "The merchant's always-on team. Ask Darwin about the store, read what he noticed, and approve a one-tap action. Requires the admin token.",
    url,
    preferredTransport: "JSONRPC",
    provider: { organization: "Darwin" },
    capabilities: { streaming: false, pushNotifications: false },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      { id: "team_ask", name: "Ask Darwin", description: "Talk to Darwin. He delegates to Iris, Pixel, Fizz and Dash." },
      { id: "team_inbox", name: "Read the inbox", description: "What Darwin noticed since you last asked, with action tokens." },
      { id: "team_decide", name: "Decide", description: "Approve or decline one action token from the inbox." },
    ],
    supportedInterfaces: [
      { url, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ],
  };
}

export function teamA2aAuthorized(authorization: string | null): boolean {
  return isAdminCredential(bearer(authorization));
}

function textOf(body: Record<string, unknown>): string {
  const params = body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
  const message = (params.message ?? params) as Record<string, unknown>;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const texts = parts.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).filter(Boolean);
  return texts.join("\n").trim() || (typeof message.text === "string" ? message.text.trim() : "");
}

/** One A2A message. Returns a JSON-RPC response. */
export async function handleTeamA2a(body: unknown, opts: { origin: string }): Promise<Record<string, unknown>> {
  const msg = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const id = msg.id ?? null;
  const method = typeof msg.method === "string" ? msg.method : "";
  if (method !== "SendMessage" && method !== "message/send") {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Darwin's team speaks SendMessage (v1.0) and message/send (v0.3)." } };
  }
  const text = textOf(msg).slice(0, 2000);
  if (!text) return { jsonrpc: "2.0", id, error: { code: -32602, message: "Send a text part." } };

  const lower = text.toLowerCase();
  let reply: string;
  let data: unknown;
  if (lower === "inbox" || lower.startsWith("inbox")) {
    const inbox = teamInbox({ limit: 10 });
    reply = inbox.messages.length ? inbox.messages.slice(-3).map((m) => m.text).join("\n\n") : "Nothing in the inbox.";
    data = { intent: "inbox", unread: inbox.unread, messages: inbox.messages };
  } else if (resolveReply({ text }) || /^act_[a-z0-9]+$/i.test(text)) {
    const token = resolveReply({ text }) ?? text;
    const approved = !/^(no|stop|keep|not now|cancel)\b/i.test(text) || /^stop the test\b/i.test(lower);
    const res = await teamDecide(token, text.trim().toLowerCase() === "no" ? false : approved, opts.origin);
    reply = res.text;
    data = { intent: "decide", ...res };
  } else {
    const res = await teamAsk(text, opts.origin);
    reply = res.text;
    data = { intent: "ask", chatId: res.chatId };
  }

  if (method === "message/send") {
    return { jsonrpc: "2.0", id, result: { kind: "message", role: "agent", messageId: `m_${Date.now()}`, parts: [{ kind: "text", text: reply }, { kind: "data", data }] } };
  }
  return {
    jsonrpc: "2.0",
    id,
    result: { message: { messageId: `m_${Date.now()}`, role: "ROLE_AGENT", parts: [{ text: reply }, { data }] } },
  };
}
