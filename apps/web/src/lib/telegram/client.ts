/**
 * Telegram Bot API calls used by the webhook and `npm run telegram:setup`.
 * Reads the token at call time so an unset token never crashes import or `next build`.
 */
import { telegramMessages } from "./format";

export const DEFAULT_WEBHOOK_URL = "https://usedarwin.app/api/telegram";

/** Telegram allows only these characters in `secret_token` (1–256). */
const SECRET_TOKEN = /^[A-Za-z0-9_-]{1,256}$/;

export interface TelegramApiResult {
  ok: boolean;
  description?: string;
}

export function botToken(): string | undefined {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || undefined;
}

export function webhookSecret(): string | undefined {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return secret || undefined;
}

/** `null` when the allowlist is unset or empty (every chat is accepted). */
export function allowedChatIds(): string[] | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  if (raw === undefined || raw.trim() === "") return null;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

export function chatAllowed(chatId: string): boolean {
  const ids = allowedChatIds();
  if (!ids) return true;
  return ids.includes(chatId);
}

export function webhookUrl(): string {
  return process.env.TELEGRAM_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL;
}

function redact(message: string): string {
  const token = botToken();
  return (token ? message.replaceAll(token, "[token]") : message).slice(0, 200);
}

async function call(method: string, body: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = botToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!json?.ok) return { ok: false, description: redact(json?.description ?? `Telegram ${method} failed (${res.status})`) };
    return { ok: true };
  } catch (err) {
    return { ok: false, description: redact(String(err)) };
  }
}

/** Show "typing…" while Darwin is answering. Failures are ignored. */
export async function sendTyping(chatId: string): Promise<void> {
  const result = await call("sendChatAction", { chat_id: chatId, action: "typing" });
  if (!result.ok) console.warn("[telegram] typing failed:", result.description);
}

/** Send `plain`, split under 4096, MarkdownV2 first and plain text if Telegram rejects it. */
export async function sendText(chatId: string, plain: string): Promise<void> {
  for (const part of telegramMessages(plain)) {
    const markdown = await call("sendMessage", { chat_id: chatId, text: part.markdown, parse_mode: "MarkdownV2" });
    if (markdown.ok) continue;
    console.warn("[telegram] markdown send failed, retrying plain:", markdown.description);
    const plainSend = await call("sendMessage", { chat_id: chatId, text: part.plain.slice(0, 4096) });
    if (!plainSend.ok) console.warn("[telegram] sendMessage failed:", plainSend.description);
  }
}

/** `setWebhook` for the production bot. Used by GET /api/telegram and the setup script. */
export async function registerWebhook(url = webhookUrl()): Promise<TelegramApiResult> {
  if (!botToken()) return { ok: false, description: "TELEGRAM_BOT_TOKEN is not set" };
  const secret = webhookSecret();
  if (!secret) return { ok: false, description: "TELEGRAM_WEBHOOK_SECRET is not set" };
  if (!SECRET_TOKEN.test(secret)) {
    return { ok: false, description: "TELEGRAM_WEBHOOK_SECRET must be 1–256 characters: A–Z, a–z, 0–9, _ and -." };
  }
  return call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
  });
}
