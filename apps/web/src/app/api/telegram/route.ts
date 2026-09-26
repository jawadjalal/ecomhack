/**
 * Telegram → Darwin.
 *
 * POST  Telegram Bot API updates (header `X-Telegram-Bot-Api-Secret-Token`).
 *       Allowlisted chats go through `runAssistant` (`POST /api/assistant`). With no allowlist,
 *       messages stay on `ask()` (`POST /api/ask`) and cannot run tools.
 * GET   Register the webhook (`setWebhook`). Requires `Authorization: Bearer <DARWIN_ADMIN_TOKEN>`.
 *
 * Unset `TELEGRAM_BOT_TOKEN` answers 503. Importing this module never reads the token, so
 * `next build` succeeds without it.
 */
import { adminToken, bearer, isAdminCredential, safeEqual } from "@/lib/auth/admin";
import { publicOrigin } from "@/lib/github";
import { botToken, handleTelegramUpdate, registerWebhook, webhookSecret, type TelegramUpdate } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function notConfigured(which: string) {
  return Response.json({ error: `Telegram is not configured. Set ${which}.` }, { status: 503 });
}

export async function POST(req: Request) {
  if (!botToken()) return notConfigured("TELEGRAM_BOT_TOKEN");
  const secret = webhookSecret();
  if (!secret) return notConfigured("TELEGRAM_WEBHOOK_SECRET");

  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!header || !safeEqual(header, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a Telegram Update JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a Telegram Update JSON body." }, { status: 400 });
  }

  const result = await handleTelegramUpdate(body as TelegramUpdate, { origin: publicOrigin(req) });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

/** Register `setWebhook` using the env already on this deployment. */
export async function GET(req: Request) {
  if (!adminToken()) {
    return Response.json({ error: "Set DARWIN_ADMIN_TOKEN to register the Telegram webhook." }, { status: 503 });
  }
  if (!isAdminCredential(bearer(req.headers.get("authorization")))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!botToken()) return notConfigured("TELEGRAM_BOT_TOKEN");

  const result = await registerWebhook();
  return Response.json(
    result.ok ? { ok: true, url: process.env.TELEGRAM_WEBHOOK_URL?.trim() || "https://usedarwin.app/api/telegram" } : { ok: false, error: result.description },
    { status: result.ok ? 200 : 502, headers: { "cache-control": "no-store" } },
  );
}
