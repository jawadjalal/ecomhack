/**
 * Tiny persisted key-value store for hackathon state.
 *
 * - Lives on `globalThis` so it survives Next.js dev hot reloads.
 * - Persists each key to `.data/<key>.json` (debounced) so a server restart keeps the demo state.
 * - Swap for Supabase later by keeping this interface (see src/lib/analytics/supabase.ts).
 *
 * Not safe across multiple server instances. Run the demo on one process (`npm run dev` / `next start`).
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DARWIN_DATA_DIR ?? path.join(process.cwd(), ".data");
const PERSIST = process.env.DARWIN_PERSIST !== "0";

type Registry = { values: Map<string, unknown>; timers: Map<string, NodeJS.Timeout> };
const g = globalThis as unknown as { __darwinKv?: Registry };
const registry: Registry = (g.__darwinKv ??= { values: new Map(), timers: new Map() });

function filePath(key: string) {
  return path.join(DATA_DIR, `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

/** Read a value, loading it from disk (or `initial()`) the first time. */
export function kvGet<T>(key: string, initial: () => T): T {
  if (registry.values.has(key)) return registry.values.get(key) as T;
  let value: T | undefined;
  if (PERSIST) {
    try {
      value = JSON.parse(fs.readFileSync(filePath(key), "utf8")) as T;
    } catch {
      value = undefined;
    }
  }
  if (value === undefined) value = initial();
  registry.values.set(key, value);
  return value;
}

/** Replace a value and schedule a write to disk. */
export function kvSet<T>(key: string, value: T): T {
  registry.values.set(key, value);
  if (PERSIST) scheduleWrite(key);
  return value;
}

/** Read-modify-write helper. */
export function kvUpdate<T>(key: string, initial: () => T, fn: (current: T) => T): T {
  return kvSet(key, fn(kvGet(key, initial)));
}

/** Forget a key (memory and disk). */
export function kvDelete(key: string) {
  registry.values.delete(key);
  if (PERSIST) {
    try {
      fs.unlinkSync(filePath(key));
    } catch {
      /* not persisted yet */
    }
  }
}

function scheduleWrite(key: string) {
  const existing = registry.timers.get(key);
  if (existing) clearTimeout(existing);
  registry.timers.set(
    key,
    setTimeout(() => {
      registry.timers.delete(key);
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(filePath(key), JSON.stringify(registry.values.get(key)));
      } catch (err) {
        console.warn(`[kv] failed to persist ${key}:`, err);
      }
    }, 250),
  );
}
