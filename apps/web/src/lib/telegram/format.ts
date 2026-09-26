/**
 * Telegram message formatting. OWNED BY: telegram (calls the Overview Ask Darwin chat).
 *
 * Replies are sent as MarkdownV2, with every model/user character escaped, then split so each
 * `sendMessage` stays within Telegram's 4096-character limit. Callers keep the plain slice too,
 * so a rejected Markdown body can be retried as plain text.
 */

export const TELEGRAM_TEXT_LIMIT = 4096;

/** MarkdownV2 specials. https://core.telegram.org/bots/api#markdownv2-style */
const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MDV2_SPECIAL, (ch) => `\\${ch}`);
}

export function formatDarwinReply(answer: string, cards?: { label: string; value: string }[]): string {
  const body = answer.trim();
  const chips = (cards ?? []).filter((c) => c.label.trim() && c.value.trim()).map((c) => `${c.label}: ${c.value}`);
  return [body, chips.length ? chips.join("\n") : ""].filter(Boolean).join("\n\n");
}

export interface TelegramPart {
  /** Unescaped text, used if Telegram rejects the MarkdownV2 body. */
  plain: string;
  /** Escaped MarkdownV2, length ≤ limit. */
  markdown: string;
}

/**
 * Split `plain` so each escaped chunk is at most `limit` characters.
 * Prefers a paragraph, line, or space break in the last 40% of the chunk.
 */
export function telegramMessages(plain: string, limit = TELEGRAM_TEXT_LIMIT): TelegramPart[] {
  const clean = plain.replace(/\r\n/g, "\n").trim();
  const source = clean || "…";
  const parts: TelegramPart[] = [];
  let rest = source;
  while (rest.length) {
    if (escapeMarkdownV2(rest).length <= limit) {
      parts.push({ plain: rest, markdown: escapeMarkdownV2(rest) });
      break;
    }
    let lo = 1;
    let hi = Math.min(rest.length, limit);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (escapeMarkdownV2(rest.slice(0, mid)).length <= limit) lo = mid;
      else hi = mid - 1;
    }
    let cut = Math.max(1, lo);
    const slice = rest.slice(0, cut);
    const windowStart = Math.floor(cut * 0.6);
    const prefer = [slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" ")].find((i) => i >= windowStart);
    if (prefer && prefer > 0) cut = prefer;
    // Don't end on a dangling UTF-16 surrogate.
    const tail = rest.charCodeAt(cut - 1);
    if (tail >= 0xd800 && tail <= 0xdbff) cut = Math.max(1, cut - 1);
    const piece = rest.slice(0, cut).trimEnd();
    if (piece) parts.push({ plain: piece, markdown: escapeMarkdownV2(piece) });
    const next = rest.slice(cut).trimStart();
    if (next === rest) {
      // No progress (pathological limit < one escaped character): hard-cut one code unit.
      parts.push({ plain: rest.slice(0, 1), markdown: escapeMarkdownV2(rest.slice(0, 1)).slice(0, limit) });
      rest = rest.slice(1).trimStart();
    } else {
      rest = next;
    }
  }
  return parts;
}
