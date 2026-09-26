/**
 * One Telegram update → the Overview "Ask Darwin" chat.
 *
 * Calls `ask()` from `lib/ask` — the same function `POST /api/ask` uses — so the system prompt,
 * shopper context, heuristic and LLM client are not reimplemented here. This is the chat the
 * redesigned console (PR #37) shows on Overview. It does not call `runAssistant` (`/api/assistant`).
 */
import { ask, type AskTurn } from "@/lib/ask";
import { chatAllowed, sendText, sendTyping } from "./client";
import { formatDarwinReply } from "./format";
import { loadChat, saveChat } from "./memory";

const MAX_QUESTION = 2000;

export const START_TEXT = `Hi, I'm Darwin — the same assistant as Ask Darwin on your store overview.

Text me about your shoppers: conversion, agents versus people, the current test, or what to do next.

/help lists a few examples.`;

export const HELP_TEXT = `Ask in plain English. I use the live store numbers, the same way the Ask Darwin chat in the console does.

Try:
- How is conversion?
- Do agents buy more than people?
- Which agent buys most?
- Is the test winning?
- What should I do next?

I answer questions from here. Shipping a change or running the loop still happens in the console.`;

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
}

/** `/start`, `/start@BotName`, `/help`. Anything else is a question for Darwin. */
export function commandOf(text: string): string | null {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function deniedText(chatId: string): string {
  return `This chat isn't allowed to use Darwin yet. Your chat id is ${chatId}. Add it to TELEGRAM_ALLOWED_CHAT_IDS, then redeploy.`;
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<HandleResult> {
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

  const command = commandOf(text);
  if (command === "start") {
    await sendText(chatId, START_TEXT);
    return { ok: true, replied: true };
  }
  if (command === "help") {
    await sendText(chatId, HELP_TEXT);
    return { ok: true, replied: true };
  }

  await sendTyping(chatId);
  const memory = await loadChat(chatId);
  const history: AskTurn[] = memory.turns;
  const question = text.slice(0, MAX_QUESTION);

  let answer: string;
  let cards: { label: string; value: string }[] | undefined;
  try {
    const res = await ask({ question, history });
    answer = res.answer;
    cards = res.cards;
  } catch (err) {
    console.warn("[telegram] ask failed:", String(err).slice(0, 200));
    await sendText(chatId, "I couldn't answer that just now. Try again in a moment.");
    return { ok: true, replied: true };
  }

  const reply = formatDarwinReply(answer, cards) || "I don't have an answer for that yet.";
  memory.turns = [...history, { role: "user", text: question }, { role: "darwin", text: answer.slice(0, 2000) }];
  await saveChat(chatId, memory);
  await sendText(chatId, reply);
  return { ok: true, replied: true };
}
