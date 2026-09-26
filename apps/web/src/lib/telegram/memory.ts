/**
 * Recent Telegram turns, keyed by chat id.
 *
 * Always written to the process KV (`lib/db/json-store.ts`). When Supabase is configured
 * (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) the same row is also read and
 * upserted into `public.telegram_chats` (see supabase/migrations/0002_telegram_chats.sql).
 * A missing table, a timeout, or any other error falls back to the KV copy and never throws:
 * on Vercel that copy may reset between instances.
 */
import type { AskTurn } from "@/lib/ask";
import { kvDelete, kvGet, kvSet } from "@/lib/db/json-store";

const KEY = "telegram_chats";
const TABLE = "telegram_chats";
const MAX_TURNS = 12;
const SUPABASE_MS = 2500;

/** A side-effecting tool the merchant has not answered yet (yes / no). */
export interface PendingTool {
  tool: string;
  args: Record<string, unknown>;
  prompt: string;
}

export interface ChatMemory {
  turns: AskTurn[];
  /** Already told this chat it isn't on the allowlist (reply once). */
  deniedNotice: boolean;
  /** Set while `runAssistant` is waiting for yes/no. Cleared once they answer or send a new request. */
  pending?: PendingTool;
}

type Store = Record<string, ChatMemory>;

function blank(): ChatMemory {
  return { turns: [], deniedNotice: false };
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function localGet(chatId: string): ChatMemory {
  const all = kvGet<Store>(KEY, () => ({}));
  return all[chatId] ?? blank();
}

function localSet(chatId: string, memory: ChatMemory): void {
  const all = kvGet<Store>(KEY, () => ({}));
  kvSet(KEY, { ...all, [chatId]: memory });
}

/** Test helper: drop every chat's memory from the process KV. */
export function resetTelegramMemory(): void {
  kvDelete(KEY);
}

function validTurn(t: unknown): t is AskTurn {
  if (!t || typeof t !== "object") return false;
  const o = t as AskTurn;
  return (o.role === "user" || o.role === "darwin") && typeof o.text === "string";
}

function validPending(raw: unknown): PendingTool | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const pending = raw as PendingTool;
  if (typeof pending.tool !== "string" || !pending.tool.trim() || typeof pending.prompt !== "string") return undefined;
  const args = pending.args && typeof pending.args === "object" && !Array.isArray(pending.args) ? pending.args : {};
  return { tool: pending.tool.slice(0, 60), args, prompt: pending.prompt.slice(0, 500) };
}

function trimMemory(memory: ChatMemory): ChatMemory {
  return {
    deniedNotice: memory.deniedNotice,
    turns: memory.turns.slice(-MAX_TURNS).map((t) => ({ role: t.role, text: t.text.slice(0, 2000) })),
    pending: memory.pending ? validPending(memory.pending) : undefined,
  };
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve(p);
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // If we already timed out, a later rejection must not surface as unhandled.
    work.catch(() => {});
  }
}

async function client() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function loadChat(chatId: string): Promise<ChatMemory> {
  if (!supabaseConfigured()) return localGet(chatId);
  try {
    const sb = await client();
    const { data, error } = await withTimeout(
      sb.from(TABLE).select("turns, denied_notice, pending").eq("chat_id", chatId).maybeSingle(),
      SUPABASE_MS,
    );
    if (error) {
      console.warn("[telegram] history read failed:", error.message);
      return localGet(chatId);
    }
    if (!data) return blank();
    const row = data as { turns?: unknown; denied_notice?: boolean; pending?: unknown };
    const turns = Array.isArray(row.turns) ? row.turns.filter(validTurn).slice(-MAX_TURNS) : [];
    const memory = { turns, deniedNotice: Boolean(row.denied_notice), pending: validPending(row.pending) };
    localSet(chatId, memory);
    return memory;
  } catch (err) {
    console.warn("[telegram] history read failed:", String(err).slice(0, 200));
    return localGet(chatId);
  }
}

export async function saveChat(chatId: string, memory: ChatMemory): Promise<void> {
  const trimmed = trimMemory(memory);
  localSet(chatId, trimmed);
  if (!supabaseConfigured()) return;
  try {
    const sb = await client();
    const { error } = await withTimeout(
      sb.from(TABLE).upsert({
        chat_id: chatId,
        turns: trimmed.turns,
        denied_notice: trimmed.deniedNotice,
        pending: trimmed.pending ?? null,
        updated_at: new Date().toISOString(),
      }),
      SUPABASE_MS,
    );
    if (error) console.warn("[telegram] history write failed:", error.message);
  } catch (err) {
    console.warn("[telegram] history write failed:", String(err).slice(0, 200));
  }
}
