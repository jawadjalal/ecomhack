import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ask, runAssistant } = vi.hoisted(() => ({ ask: vi.fn(), runAssistant: vi.fn() }));

vi.mock("@/lib/ask", () => ({
  ask,
}));

vi.mock("@/lib/assistant/agent", () => ({
  runAssistant,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("relation telegram_chats does not exist");
  },
}));

import { isProtectedPath } from "@/lib/auth/admin";
import { GET, POST } from "@/app/api/telegram/route";
import { proxy, config as proxyConfig } from "@/proxy";
import { formatAssistantReply, TELEGRAM_TEXT_LIMIT, telegramMessages } from "./format";
import { confirmChoice } from "./handle";
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
  runAssistant.mockReset();
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

  it("turns tool results into readable text, including a link and a yes/no prompt", () => {
    const text = formatAssistantReply(
      {
        reply: "I stepped the loop.",
        actions: [
          {
            ok: true,
            summary: "Loop moved idle → observe (Gen 0).",
            synthetic: true,
            link: { label: "Open the console", href: "/console" },
          },
        ],
        pendingConfirm: { prompt: "Ship it?" },
      },
      "https://usedarwin.app",
    );
    expect(text).toContain("I stepped the loop.");
    expect(text).toContain("Loop moved idle → observe (Gen 0).");
    expect(text).toContain("(simulated)");
    expect(text).toContain("https://usedarwin.app/console");
    expect(text).toContain("Reply yes");
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
    expect(runAssistant).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("rejects a missing or wrong secret header", async () => {
    const missing = await POST(new Request("http://x/api/telegram", { method: "POST", body: JSON.stringify(telegramUpdate("hi")) }));
    expect(missing.status).toBe(401);
    const wrong = await post(telegramUpdate("hi"), "nope");
    expect(wrong.status).toBe(401);
    expect(ask).not.toHaveBeenCalled();
    expect(runAssistant).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("ignores chats that are not on the allowlist, and tells them their id once", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "999, 1001");
    const first = await post(telegramUpdate("run the loop", 42));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ignored: "allowlist", replied: true });
    expect(ask).not.toHaveBeenCalled();
    expect(runAssistant).not.toHaveBeenCalled();
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
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("answers only, via ask(), when the allowlist is empty", async () => {
    const first = await post(telegramUpdate("How is conversion?"));
    expect(first.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith({ question: "How is conversion?", history: [] });
    expect(runAssistant).not.toHaveBeenCalled();
    expect(await first.json()).toMatchObject({ mode: "ask" });
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
    expect(texts[1]).toMatch(/Tool use is off/);
    expect(runAssistant).not.toHaveBeenCalled();
  });

  it("routes every allowlisted message through runAssistant and shows the tool result", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "42");
    runAssistant.mockResolvedValue({
      reply: "Stepped the loop.",
      actions: [{ tool: "step_loop", args: {}, ok: true, summary: "Loop moved idle → observe (Gen 0).", synthetic: true }],
      model: "heuristic",
      suggestions: [],
    });
    const res = await post(telegramUpdate("step the loop"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "assistant" });
    expect(ask).not.toHaveBeenCalled();
    expect(runAssistant).toHaveBeenCalledTimes(1);
    expect(runAssistant).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "step the loop" }],
      confirm: undefined,
      origin: "http://x",
      context: { path: "/telegram" },
    });
    const body = sent.find((s) => s.method === "sendMessage")?.body.text ?? "";
    expect(body).toContain("Stepped the loop");
    expect(body).toContain("Loop moved idle");
    expect(body).toContain("simulated");

    runAssistant.mockResolvedValueOnce({
      reply: "One experiment is running.",
      actions: [{ tool: "list_experiments", args: {}, ok: true, summary: "1 experiment (1 running). Checkout copy." }],
      model: "heuristic",
    });
    await post(telegramUpdate("what experiments are running?"));
    expect(runAssistant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "step the loop" },
          { role: "assistant", content: expect.stringContaining("Loop moved idle") },
          { role: "user", content: "what experiments are running?" },
        ],
      }),
    );
  });

  it("confirms a pending tool on yes, cancels on no, and drops it when the next message is a new request", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "42, 7");
    const pending = { tool: "set_autopilot", args: { on: true }, prompt: "Turn autopilot on?" };
    runAssistant.mockResolvedValueOnce({ reply: "Turn autopilot on?", actions: [], pendingConfirm: pending, model: "heuristic" });
    await post(telegramUpdate("turn autopilot on"));
    expect(sent.find((s) => s.method === "sendMessage")?.body.text).toContain("Reply yes");

    runAssistant.mockResolvedValueOnce({
      reply: "Autopilot is on.",
      actions: [{ tool: "set_autopilot", args: { on: true }, ok: true, summary: "Autopilot is on: the console will keep stepping the loop." }],
      model: "heuristic",
    });
    await post(telegramUpdate("Yes!"));
    expect(runAssistant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        confirm: { tool: "set_autopilot", args: { on: true }, approved: true },
        messages: expect.arrayContaining([{ role: "user", content: "Yes, go ahead." }]),
      }),
    );
    expect(ask).not.toHaveBeenCalled();

    runAssistant.mockResolvedValueOnce({ reply: "Reset the store to Gen 0?", actions: [], pendingConfirm: { tool: "reset_loop", args: {}, prompt: "Reset?" }, model: "heuristic" });
    await post(telegramUpdate("reset everything", 7));
    runAssistant.mockResolvedValueOnce({ reply: "Okay, cancelled. Nothing changed.", actions: [], model: "heuristic" });
    await post(telegramUpdate("no", 7));
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: { tool: "reset_loop", args: {}, approved: false } }));

    runAssistant.mockResolvedValueOnce({
      reply: "Open a pull request shipping “Checkout copy”?",
      actions: [],
      pendingConfirm: { tool: "ship_winner", args: {}, prompt: "Open a pull request?" },
      model: "heuristic",
    });
    await post(telegramUpdate("ship the winner"));
    runAssistant.mockResolvedValueOnce({ reply: "The loop is idle.", actions: [{ tool: "loop_status", args: {}, ok: true, summary: "Phase idle, Gen 0." }], model: "heuristic" });
    await post(telegramUpdate("how are we doing?"));
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: undefined }));
    expect(confirmChoice("yes")).toBe(true);
    expect(confirmChoice("no")).toBe(false);
    expect(confirmChoice("how are we doing?")).toBeNull();
  });

  it("tells an allowlisted chat that it can act", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "42");
    const help = await post(telegramUpdate("/help"));
    expect(help.status).toBe(200);
    const text = sent.find((s) => s.method === "sendMessage")?.body.text ?? "";
    expect(text).toMatch(/Step the loop/);
    expect(text).toMatch(/reply yes or no/i);
    expect(ask).not.toHaveBeenCalled();
    expect(runAssistant).not.toHaveBeenCalled();
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
