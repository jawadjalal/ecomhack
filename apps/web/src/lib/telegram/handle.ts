/**
 * One Telegram update → Darwin.
 *
 * Allowlisted chats (`TELEGRAM_ALLOWED_CHAT_IDS`) go through `runAssistant`, the same function
 * as the console assistant panel (`POST /api/assistant`): every message, same tools, same
 * confirm-before-acting rule. Yes / no replies the pending tool; any other message supersedes
 * it, matching the panel.
 *
 * With no allowlist, messages stay on `ask()` (Overview Ask Darwin, `POST /api/ask`). That path
 * only answers. `/help` says tools are off.
 */
import type { AssistantMessage, AssistantPendingConfirm } from "@/lib/contracts";
import { ask, type AskTurn } from "@/lib/ask";
import { runAssistant } from "@/lib/assistant/agent";
import { chatAllowed, sendText, sendTyping, toolsEnabled } from "./client";
import { formatAssistantReply, formatDarwinReply } from "./format";
import { loadChat, saveChat, type ChatMemory } from "./memory";

const MAX_QUESTION = 2000;

export function startText(tools: boolean): string {
  const shared = `Hi, I'm Darwin — the same assistant as Ask Darwin in the console.`;
  if (!tools) {
    return `${shared}

Ask about your shoppers: conversion, agents versus people, the current test, or what to do next.

Acting is off until this chat is listed in TELEGRAM_ALLOWED_CHAT_IDS. /help has more.`;
  }
  return `${shared}

Ask a question, or tell me to act: step the loop, check experiments, ship a winner, turn autopilot on. Anything that changes the store asks you to reply yes or no first.

/help lists examples.`;
}

export function helpText(tools: boolean): string {
  if (!tools) {
    return `Ask in plain English. I use the live store numbers, the same way the Ask Darwin chat in the console does.

Try:
- How is conversion?
- Do agents buy more than people?
- Which agent buys most?
- Is the test winning?
- What should I do next?

Tool use is off because TELEGRAM_ALLOWED_CHAT_IDS is empty. I can answer, but I won't step the loop, ship, or change anything until this chat is on that list.`;
  }
  return `You can ask and act, the same way as the assistant in the console.

Try:
- How are we doing?
- Step the loop
- What experiments are running?
- Ship the winner
- Turn autopilot on
- Reset everything

Shipping, autopilot and reset wait for you to reply yes or no. Any other message cancels that prompt and is taken as a new request.`;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    from?: { is_bot?: boolean };
    chat?: { id?: number | string };
  };
}

export interface HandleResult {
  ok: true;
  ignored?: "no_text" | "bot" | "allowlist" | "duplicate_notice";
  replied?: boolean;
  /** Which chat handled the message, when one did. */
  mode?: "ask" | "assistant";
}

export interface HandleOptions {
  /** Darwin's public origin, for tools that link back to the console. */
  origin?: string;
}

/** `/start`, `/start@BotName`, `/help`. Anything else is a message for Darwin. */
export function commandOf(text: string): string | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

/** Yes / no only when the whole message is a confirmation. Anything longer is a new request. */
export function confirmChoice(text: string): boolean | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!.]+$/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(y|yes|yeah|yep|ok|okay|confirm|confirmed|go ahead|do it|ship it|sure|yes go ahead)$/.test(normalized)) return true;
  if (/^(n|no|nope|nah|cancel|stop|dont|don't|no cancel that)$/.test(normalized)) return false;
  return null;
}

function deniedText(chatId: string): string {
  return `This chat isn't allowed to use Darwin yet. Your chat id is ${chatId}. Add it to TELEGRAM_ALLOWED_CHAT_IDS, then redeploy.`;
}

function toAssistantMessages(turns: AskTurn[]): AssistantMessage[] {
  return turns.map((turn) => ({ role: turn.role === "user" ? "user" : "assistant", content: turn.text }));
}

function asPending(confirm: AssistantPendingConfirm): NonNullable<ChatMemory["pending"]> {
  return { tool: confirm.tool, args: confirm.args, prompt: confirm.prompt };
}

export async function handleTelegramUpdate(update: TelegramUpdate, opts: HandleOptions = {}): Promise<HandleResult> {
  const message = update.message;
  const text = message?.text?.trim() ?? "";
  const rawId = message?.chat?.id;
  if (rawId === undefined || rawId === null || !text) return { ok: true, ignored: "no_text" };
  if (message?.from?.is_bot) return { ok: true, ignored: "bot" };

  const chatId = String(rawId);

  if (!chatAllowed(chatId)) {
    const memory = await loadChat(chatId);
    if (memory.deniedNotice) return { ok: true, ignored: "duplicate_notice" };
    await sendText(chatId, deniedText(chatId));
    memory.deniedNotice = true;
    await saveChat(chatId, memory);
    return { ok: true, ignored: "allowlist", replied: true };
  }

  const tools = toolsEnabled();
  const command = commandOf(text);
  if (command === "start") {
    await sendText(chatId, startText(tools));
    return { ok: true, replied: true };
  }
  if (command === "help") {
    await sendText(chatId, helpText(tools));
    return { ok: true, replied: true };
  }

  await sendTyping(chatId);
  const memory = await loadChat(chatId);
  const question = text.slice(0, MAX_QUESTION);

  if (!tools) return answerOnly(chatId, memory, question);

  const choice = memory.pending ? confirmChoice(question) : null;
  const userLine = choice === true ? "Yes, go ahead." : choice === false ? "No, cancel that." : question;
  const messages = [...toAssistantMessages(memory.turns), { role: "user" as const, content: userLine }];
  const confirm =
    memory.pending && choice !== null ? { tool: memory.pending.tool, args: memory.pending.args, approved: choice } : undefined;

  let res;
  try {
    res = await runAssistant({ messages, confirm, origin: opts.origin, context: { path: "/telegram" } });
  } catch (err) {
    console.warn("[telegram] assistant failed:", String(err).slice(0, 200));
    await sendText(chatId, "I couldn't do that just now. Try again in a moment.");
    return { ok: true, replied: true, mode: "assistant" };
  }

  const reply = formatAssistantReply(res, opts.origin);
  memory.turns = [...memory.turns, { role: "user", text: userLine }, { role: "darwin", text: reply.slice(0, 2000) }];
  memory.pending = res.pendingConfirm ? asPending(res.pendingConfirm) : undefined;
  await saveChat(chatId, memory);
  await sendText(chatId, reply);
  return { ok: true, replied: true, mode: "assistant" };
}

async function answerOnly(chatId: string, memory: ChatMemory, question: string): Promise<HandleResult> {
  let answer: string;
  let cards: { label: string; value: string }[] | undefined;
  try {
    const res = await ask({ question, history: memory.turns });
    answer = res.answer;
    cards = res.cards;
  } catch (err) {
    console.warn("[telegram] ask failed:", String(err).slice(0, 200));
    await sendText(chatId, "I couldn't answer that just now. Try again in a moment.");
    return { ok: true, replied: true, mode: "ask" };
  }

  const reply = formatDarwinReply(answer, cards) || "I don't have an answer for that yet.";
  memory.turns = [...memory.turns, { role: "user", text: question }, { role: "darwin", text: answer.slice(0, 2000) }];
  memory.pending = undefined;
  await saveChat(chatId, memory);
  await sendText(chatId, reply);
  return { ok: true, replied: true, mode: "ask" };
}
