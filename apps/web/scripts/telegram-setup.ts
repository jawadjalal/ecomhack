/**
 * Register the Telegram webhook for the production bot.
 *
 *   cd apps/web
 *   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… npm run telegram:setup
 *
 * Reads `.env.local` and `.env` when those files exist. The URL defaults to
 * https://usedarwin.app/api/telegram (override with TELEGRAM_WEBHOOK_URL).
 */
import { registerWebhook, webhookUrl } from "../src/lib/telegram/client";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* optional */
  }
}

const result = await registerWebhook();
if (!result.ok) {
  console.error(result.description ?? "setWebhook failed");
  process.exit(1);
}
console.log(`Webhook registered: ${webhookUrl()}`);
