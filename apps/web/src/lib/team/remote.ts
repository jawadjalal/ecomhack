/**
 * Darwin's team, for an agent that isn't in the console. OWNED BY: team.
 *
 * MCP (`POST /api/team/mcp`) and A2A (`POST /a2a/team`) both sit on these three calls, and both require the
 * admin token. `team_ask` is a normal turn, `team_inbox` is what the watch wrote, `team_decide` spends one
 * action token through the same confirm gate as a tap.
 */
import type { TeamEvent } from "@/lib/contracts/team";
import type { TeamInboxResponse } from "@/lib/contracts/watch";
import { receive } from "./channels";
import { runTeamTurn } from "./orchestrator";
import { inboxView } from "./watch";

export async function teamAsk(text: string, origin?: string): Promise<{ text: string; chatId: string }> {
  const events: TeamEvent[] = [];
  await runTeamTurn({ text, origin }, (event) => events.push(event));
  const done = events.find((e) => e.type === "done");
  const chatId = done && done.type === "done" ? done.chatId : "";
  const replies = events.flatMap((e) => (e.type === "message" && e.message.from === "darwin" && (e.message.kind === "report" || e.message.kind === "text") ? [e.message.text] : []));
  return { text: replies.at(-1) ?? "I didn't manage a reply.", chatId };
}

export function teamInbox(opts: { since?: string; limit?: number } = {}): TeamInboxResponse {
  return inboxView(opts);
}

export async function teamDecide(token: string, approved: boolean, origin?: string): Promise<{ ok: boolean; text: string }> {
  return receive({ token, approved }, { origin });
}
