import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));

vi.mock("@/lib/ask", () => ({
  ask,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("relation telegram_chats does not exist");
  },
}));

import { isProtectedPath } from "@/lib/auth/admin";
import { GET, POST } from "@/app/api/telegram/route";
import { proxy, config as proxyConfig } from "@/proxy";
import { TELEGRAM_TEXT_LIMIT, telegramMessages } from "./format";
import { resetTelegramMemory } from "./memory";

interface Sent {
  method: string;
  body: { text?: string; chat_id?: string; action?: string; parse_mode?: string; url?: string; secret_token?: string };
}

const sent: Sent[] = [];

function telegramUpdate(text: string, chatId: number | string = 42) {
  return {
    update_id: 1,
    message: { message_id: 1, text, chat: { id: chatId, type: "private" }, from: { id: 7, is_bot: false } },
  };
}

function post(body: unknown, secret = "sekret") {
  return POST(
    new Request("http://x/api/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  ask.mockReset();
  ask.mockResolvedValue({
    answer: "Your store converts 5%.",
    cards: [{ label: "Converts", value: "5%" }],
    source: "heuristic",
  });
  sent.length = 0;
  resetTelegramMemory();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "sekret");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "");
  vi.stubEnv("DARWIN_ADMIN_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split("/").pop() ?? "";
      sent.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
      return Response.json({ ok: true, result: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetTelegramMemory();
});

describe("telegram message formatting", () => {
  it("escapes MarkdownV2 and splits on the 4096 limit", () => {
    const parts = telegramMessages(`${"a_b. ".repeat(2000)}`);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.markdown.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
      expect(part.markdown.length).toBeGreaterThan(0);
      expect(part.markdown).not.toMatch(/(?<!\\)[_.]/);
    }
    expect(parts.map((p) => p.plain).join(" ").replace(/\s+/g, " ").trim().length).toBeGreaterThan(1000);
  });
});

describe("POST /api/telegram", () => {
  it("stays off the admin gate so Telegram can deliver updates", () => {
    expect(isProtectedPath("/api/telegram")).toBe(false);
    expect(proxyConfig.matcher).not.toContain("/api/telegram");
  });

  it("returns 503 when the bot token or webhook secret is unset", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const noToken = await post(telegramUpdate("hi"));
    expect(noToken.status).toBe(503);
    expect(await noToken.json()).toMatchObject({ error: expect.stringMatching(/TELEGRAM_BOT_TOKEN/) });

    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    const noSecret = await post(telegramUpdate("hi"));
    expect(noSecret.status).toBe(503);
    expect(await noSecret.json()).toMatchObject({ error: expect.stringMatching(/TELEGRAM_WEBHOOK_SECRET/) });
    expect(ask).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing or wrong secret header", async () => {
    const missing = await POST(new Request("http://x/api/telegram", { method: "POST", body: JSON.stringify(telegramUpdate("hi")) }));
    expect(missing.status).toBe(401);
    const wrong = await post(telegramUpdate("hi"), "nope");
    expect(wrong.status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("ignores chats that are not on the allowlist, and tells them their id once", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "999, 1001");
    const first = await post(telegramUpdate("run the loop", 42));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ignored: "allowlist", replied: true });
    expect(ask).not.toHaveBeenCalled();
    const notices = sent.filter((s) => s.method === "sendMessage");
    expect(notices).toHaveLength(1);
    expect(notices[0].body.text).toContain("42");
    expect(notices[0].body.text).toContain("TELEGRAM\\_ALLOWED\\_CHAT\\_IDS");

    sent.length = 0;
    const second = await post(telegramUpdate("hello again", 42));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ignored: "duplicate_notice" });
    expect(sent.filter((s) => s.method === "sendMessage")).toHaveLength(0);
    expect(ask).not.toHaveBeenCalled();
  });

  it("routes text through ask(), remembers the chat, and sends typing", async () => {
    const first = await post(telegramUpdate("How is conversion?"));
    expect(first.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith({ question: "How is conversion?", history: [] });
    expect(sent.map((s) => s.method)).toEqual(["sendChatAction", "sendMessage"]);
    expect(sent[0].body).toMatchObject({ chat_id: "42", action: "typing" });
    expect(sent[1].body.parse_mode).toBe("MarkdownV2");
    expect(sent[1].body.text).toContain("converts 5%");
    expect(sent[1].body.text).toContain("Converts");

    ask.mockResolvedValueOnce({ answer: "Agents buy more often.", source: "heuristic" });
    const second = await post(telegramUpdate("What about agents?"));
    expect(ask).toHaveBeenLastCalledWith({
      question: "What about agents?",
      history: [
        { role: "user", text: "How is conversion?" },
        { role: "darwin", text: "Your store converts 5%." },
      ],
    });
    expect(second.status).toBe(200);
  });

  it("splits a long reply across sendMessage calls under 4096 characters", async () => {
    ask.mockResolvedValueOnce({ answer: `${"word ".repeat(3000)}done.`, source: "heuristic" });
    const res = await post(telegramUpdate("Tell me everything"));
    expect(res.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    const messages = sent.filter((s) => s.method === "sendMessage");
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.body.text?.length ?? 0).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
      expect(message.body.text?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("answers /start and /help without calling ask", async () => {
    const start = await post(telegramUpdate("/start@DarwinBot"));
    expect(start.status).toBe(200);
    const help = await post(telegramUpdate("/help"));
    expect(help.status).toBe(200);
    expect(ask).not.toHaveBeenCalled();
    const texts = sent.filter((s) => s.method === "sendMessage").map((s) => s.body.text ?? "");
    expect(texts[0]).toMatch(/Ask Darwin/i);
    expect(texts[1]).toMatch(/plain English/i);
  });

  it("still answers when Supabase history fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    const res = await post(telegramUpdate("How is conversion?"));
    expect(res.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(sent.some((s) => s.method === "sendMessage")).toBe(true);
  });

  it("is not blocked by the console admin proxy", async () => {
    vi.stubEnv("DARWIN_ADMIN_TOKEN", "s3cret");
    const { NextRequest } = await import("next/server");
    const res = proxy(new NextRequest("https://usedarwin.app/api/telegram", { method: "POST" }));
    expect(res.status).not.toBe(401);
  });
});

describe("GET /api/telegram", () => {
  it("registers the webhook only with the admin token", async () => {
    const locked = await GET(new Request("http://x/api/telegram"));
    expect(locked.status).toBe(503);

    vi.stubEnv("DARWIN_ADMIN_TOKEN", "s3cret");
    const denied = await GET(new Request("http://x/api/telegram", { headers: { authorization: "Bearer wrong" } }));
    expect(denied.status).toBe(401);

    const ok = await GET(new Request("http://x/api/telegram", { headers: { authorization: "Bearer s3cret" } }));
    expect(ok.status).toBe(200);
    const hook = sent.find((s) => s.method === "setWebhook");
    expect(hook?.body.url).toBe("https://usedarwin.app/api/telegram");
    expect(hook?.body.secret_token).toBe("sekret");
    expect(hook?.body).not.toHaveProperty("parse_mode");
  });
});
