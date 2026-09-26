/**
 * Outbound channels for Darwin's Inbox. OWNED BY: team.
 *
 * One interface: `send(message, actions)` / `receive(reply)`. The in-app Inbox is always first (the watch
 * writes it directly). Everything else is off unless its env is set, and a reply from any of them comes back
 * through the same action-token confirm gate as a tap. Messages carry the sentence and the action labels,
 * never a secret.
 */
import type { InboxMessage, ProactiveAction } from "@/lib/contracts/watch";
import { runTeamTurn } from "./orchestrator";
import { getToken, openTokens } from "./watch-store";

export interface OutboundMessage {
  text: string;
  severity: string;
  synthetic: boolean;
  actions: ProactiveAction[];
  href?: string;
}

export interface ChannelResult {
  channel: string;
  ok: boolean;
  note?: string;
}

export interface ChannelAdapter {
  id: string;
  /** False unless this channel's env is set. Off channels are never called. */
  configured(): boolean;
  send(message: OutboundMessage): Promise<ChannelResult>;
}

export interface ChannelReply {
  /** An action token from a message Darwin sent. */
  token?: string;
  /** Free text, matched against the newest open actions ("ship it", "stop", "no", "show me"). */
  text?: string;
  approved?: boolean;
}

const YES = /^(yes|y|ship( it)?|do it|go|ok|okay|approve|show me|step it)\b/i;
const NO = /^(no|n|stop|keep( it| testing)?|not now|cancel|wait|later)\b/i;

/** The message a channel actually sends: the sentence, then how to answer. No args, no keys. */
export function renderOutbound(message: OutboundMessage): string {
  const lines = [message.text.trim()];
  if (message.synthetic && !/simulated/i.test(message.text)) lines.push("(simulated)");
  for (const action of message.actions) lines.push(`${action.label}: reply “${action.token}”`);
  if (message.href) lines.push(`Details: ${message.href}`);
  return lines.join("\n");
}

/** Pull channel: the Grok bot reads GET /api/team/inbox. Nothing is pushed. */
const grok: ChannelAdapter = {
  id: "grok",
  configured: () => process.env.DARWIN_GROK_BOT === "1",
  async send() {
    return { channel: "grok", ok: true, note: "Pull channel: the bot reads GET /api/team/inbox." };
  },
};

async function postWebhook(channel: string, url: string, text: string): Promise<ChannelResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, text }),
    });
    return res.ok ? { channel, ok: true } : { channel, ok: false, note: `Webhook answered ${res.status}.` };
  } catch (err) {
    return { channel, ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}

const slack: ChannelAdapter = {
  id: "slack",
  configured: () => /^https:\/\/hooks\.slack\.com\//.test(process.env.DARWIN_SLACK_WEBHOOK_URL?.trim() ?? ""),
  send: (message) => postWebhook("slack", process.env.DARWIN_SLACK_WEBHOOK_URL!.trim(), renderOutbound(message)),
};

const discord: ChannelAdapter = {
  id: "discord",
  configured: () => /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(process.env.DARWIN_DISCORD_WEBHOOK_URL?.trim() ?? ""),
  send: (message) => postWebhook("discord", process.env.DARWIN_DISCORD_WEBHOOK_URL!.trim(), renderOutbound(message)),
};

const email: ChannelAdapter = {
  id: "email",
  configured: () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.DARWIN_EMAIL_TO?.trim()),
  async send(message) {
    const to = process.env.DARWIN_EMAIL_TO!.trim();
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.DARWIN_EMAIL_FROM?.trim() || "Darwin <darwin@notifications.local>",
          to: [to],
          subject: message.synthetic ? "Darwin (simulated traffic)" : "Darwin",
          text: renderOutbound(message),
        }),
      });
      return res.ok ? { channel: "email", ok: true } : { channel: "email", ok: false, note: `Email provider answered ${res.status}.` };
    } catch (err) {
      return { channel: "email", ok: false, note: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const CHANNELS: ChannelAdapter[] = [grok, slack, discord, email];

export function configuredChannels(): ChannelAdapter[] {
  return CHANNELS.filter((c) => {
    try {
      return c.configured();
    } catch {
      return false;
    }
  });
}

/** Fan a message out to every channel that is actually configured. Failures are reported, never thrown. */
export async function deliver(message: OutboundMessage): Promise<ChannelResult[]> {
  const channels = configuredChannels();
  if (!channels.length) return [];
  return Promise.all(channels.map((c) => c.send(message).catch((err: unknown) => ({ channel: c.id, ok: false, note: err instanceof Error ? err.message : String(err) }))));
}

/**
 * A reply from Slack, Discord, email or the Grok bot. Resolves to one action token and runs it through the
 * same confirm gate as a tap in the console.
 */
export async function receive(reply: ChannelReply, opts: { origin?: string } = {}): Promise<{ ok: boolean; text: string }> {
  const token = resolveReply(reply);
  if (!token) return { ok: false, text: "I couldn't tell which action you meant. Reply with the action id from the message." };
  const stored = getToken(token);
  if (!stored) return { ok: false, text: "That action isn't open any more." };
  const approved = reply.approved ?? !isNo(reply.text);
  const events: { type: string; message?: { text: string; from: string; kind: string } }[] = [];
  await runTeamTurn({ confirm: { id: token, approved }, text: "", origin: opts.origin }, (event) => {
    if (event.type === "message") events.push(event);
  });
  const last = [...events].reverse().find((e) => e.message?.from === "darwin" && (e.message.kind === "report" || e.message.kind === "text"));
  return { ok: approved, text: last?.message?.text ?? (approved ? "Done." : "Okay, cancelled.") };
}

/** Match a reply to the newest still-open token, by id or by what the merchant said. */
export function resolveReply(reply: ChannelReply): string | undefined {
  const explicit = reply.token?.trim();
  if (explicit && getToken(explicit)) return explicit;
  const text = reply.text?.trim() ?? "";
  const mentioned = text.match(/\bact_[a-z0-9]+\b/i)?.[0];
  if (mentioned && getToken(mentioned)) return mentioned;
  const open = openTokens();
  if (!open.length || !text) return undefined;
  if (YES.test(text)) return open.find((t) => t.action.type !== "dismiss")?.token ?? open[0].token;
  if (NO.test(text)) {
    // "stop" approves a stop action when that's what Darwin asked; otherwise it's a no.
    if (/^stop\b/i.test(text)) {
      const stop = open.find((t) => t.action.type === "briefing" && t.action.action === "stop");
      if (stop) return stop.token;
    }
    return open.find((t) => t.action.type === "dismiss")?.token ?? open[0].token;
  }
  const byLabel = open.find((t) => text.toLowerCase().includes(t.label.toLowerCase()));
  return byLabel?.token;
}

function isNo(text: string | undefined): boolean {
  return !!text && NO.test(text.trim()) && !YES.test(text.trim());
}

/** Newest inbox-shaped message, for tests and the Grok bot's "what did you just say". */
export function latestOpenAction(): ProactiveAction | undefined {
  const token = openTokens()[0];
  if (!token) return undefined;
  return { token: token.token, label: token.label, risk: token.risk, kind: token.action.type, expiresAt: token.expiresAt };
}

export function channelStatus(): { id: string; on: boolean }[] {
  return CHANNELS.map((c) => ({ id: c.id, on: c.configured() }));
}

/** Used by the inbox route to describe a stored message without leaking token arguments. */
export type { InboxMessage, ProactiveAction };
