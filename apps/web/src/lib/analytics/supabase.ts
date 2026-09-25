/**
 * Optional Supabase mirror for the event store.
 *
 * If `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, every event appended to the
 * in-memory store is also upserted into `public.events` (see supabase/migrations/0001_events.sql),
 * batched and fire-and-forget. Reads still come from memory, so the demo never waits on the network.
 * Set `DARWIN_SUPABASE_MIRROR=0` to switch it off while keeping the env vars.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsEvent } from "@/lib/contracts";

const BATCH_MAX = 500;
const FLUSH_MS = 1_000;
const RETRY_MS = 5_000;
const QUEUE_MAX = 50_000;
const WARN_EVERY_MS = 60_000;

interface MirrorState {
  queue: AnalyticsEvent[];
  timer?: ReturnType<typeof setTimeout>;
  flushing: boolean;
  client?: Promise<SupabaseClient | null>;
  lastWarnAt: number;
  mirrored: number;
  dropped: number;
}

const g = globalThis as unknown as { __darwinSupabaseMirror?: MirrorState };
const state = (): MirrorState =>
  (g.__darwinSupabaseMirror ??= { queue: [], flushing: false, lastWarnAt: 0, mirrored: 0, dropped: 0 });

export const SUPABASE_EVENTS_TABLE = process.env.SUPABASE_EVENTS_TABLE ?? "events";

export function supabaseMirrorEnabled(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DARWIN_SUPABASE_MIRROR !== "0",
  );
}

/** Mirror stats for debugging (`mirrored`, `dropped`, `queued`). */
export function supabaseMirrorStats() {
  const s = state();
  return { enabled: supabaseMirrorEnabled(), mirrored: s.mirrored, dropped: s.dropped, queued: s.queue.length };
}

function warn(message: string) {
  const s = state();
  if (Date.now() - s.lastWarnAt < WARN_EVERY_MS) return;
  s.lastWarnAt = Date.now();
  console.warn(`[events→supabase] ${message}`);
}

function getClient(): Promise<SupabaseClient | null> {
  const s = state();
  return (s.client ??= import("@supabase/supabase-js")
    .then(({ createClient }) =>
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    )
    .catch((err) => {
      warn(`client init failed: ${String(err)}`);
      return null;
    }));
}

function schedule(ms: number) {
  const s = state();
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = undefined;
    void flushSupabaseMirror();
  }, ms);
  s.timer.unref?.();
}

/** Queue events for mirroring. Never throws, never blocks. */
export function mirrorEvents(events: readonly AnalyticsEvent[]) {
  if (!events.length || !supabaseMirrorEnabled()) return;
  const s = state();
  for (const e of events) s.queue.push(e);
  if (s.queue.length > QUEUE_MAX) {
    const drop = s.queue.length - QUEUE_MAX;
    s.queue.splice(0, drop);
    s.dropped += drop;
    warn(`queue full, dropped ${drop} events (Supabase unreachable?)`);
  }
  if (s.queue.length >= BATCH_MAX) void flushSupabaseMirror();
  else schedule(FLUSH_MS);
}

/** Flush everything queued. Safe to call concurrently; exported for tests and shutdown hooks. */
export async function flushSupabaseMirror(): Promise<void> {
  const s = state();
  if (s.flushing) return;
  s.flushing = true;
  try {
    const client = await getClient();
    if (!client) {
      s.dropped += s.queue.length;
      s.queue = [];
      return;
    }
    while (s.queue.length) {
      const batch = s.queue.splice(0, BATCH_MAX);
      const rows = batch.map((e) => ({
        uuid: e.uuid,
        event: e.event,
        distinct_id: e.distinct_id,
        timestamp: e.timestamp,
        properties: e.properties,
      }));
      let error: string | undefined;
      try {
        const res = await client.from(SUPABASE_EVENTS_TABLE).upsert(rows, { onConflict: "uuid", ignoreDuplicates: true });
        error = res.error?.message;
      } catch (err) {
        error = String(err);
      }
      if (error) {
        s.queue.unshift(...batch);
        warn(`insert failed, retrying in ${RETRY_MS / 1000}s: ${error}`);
        schedule(RETRY_MS);
        return;
      }
      s.mirrored += batch.length;
    }
  } finally {
    s.flushing = false;
  }
}
