/**
 * Event store. Default: in-memory ring buffer + append-only NDJSON file in `.data/events.ndjson`.
 * The team's PostHog-derived pipeline / Supabase can replace this by implementing `EventStore`.
 */
import fs from "node:fs";
import path from "node:path";
import type { AnalyticsEvent, AnalyticsEventInput } from "@/lib/contracts";
import { uuid } from "@/lib/ids";

export interface EventStore {
  append(events: AnalyticsEventInput[]): AnalyticsEvent[];
  /** All events, oldest first. Callers must not mutate. */
  all(): readonly AnalyticsEvent[];
  /** Events strictly after the given uuid (for live feeds). Newest last. */
  since(afterUuid: string | undefined, limit: number): AnalyticsEvent[];
  clear(): void;
}

const MAX_EVENTS = Number(process.env.DARWIN_MAX_EVENTS ?? 250_000);
const DATA_DIR = process.env.DARWIN_DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "events.ndjson");
const PERSIST = process.env.DARWIN_PERSIST !== "0";

class MemoryEventStore implements EventStore {
  private events: AnalyticsEvent[] = [];
  private index = new Map<string, number>(); // uuid -> absolute position
  private offset = 0; // absolute position of events[0]

  constructor() {
    if (!PERSIST) return;
    try {
      const lines = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean);
      for (const line of lines.slice(-MAX_EVENTS)) this.push(JSON.parse(line));
    } catch {
      /* no file yet */
    }
  }

  private push(e: AnalyticsEvent) {
    this.index.set(e.uuid, this.offset + this.events.length);
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) {
      const dropped = this.events.splice(0, this.events.length - MAX_EVENTS);
      for (const d of dropped) this.index.delete(d.uuid);
      this.offset += dropped.length;
    }
  }

  append(inputs: AnalyticsEventInput[]): AnalyticsEvent[] {
    const now = new Date().toISOString();
    const out = inputs.map((i) => ({
      ...i,
      uuid: i.uuid ?? uuid(),
      timestamp: i.timestamp ?? now,
      properties: i.properties ?? {},
    }));
    for (const e of out) this.push(e);
    if (PERSIST && out.length) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(FILE, out.map((e) => JSON.stringify(e)).join("\n") + "\n");
      } catch (err) {
        console.warn("[events] persist failed", err);
      }
    }
    return out;
  }

  all() {
    return this.events;
  }

  since(afterUuid: string | undefined, limit: number) {
    if (!afterUuid) return this.events.slice(-limit);
    const pos = this.index.get(afterUuid);
    const start = pos === undefined ? 0 : pos - this.offset + 1;
    return this.events.slice(start, start + limit);
  }

  clear() {
    this.events = [];
    this.index.clear();
    this.offset = 0;
    if (PERSIST) {
      try {
        fs.rmSync(FILE, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

const g = globalThis as unknown as { __darwinEvents?: EventStore };

/** The process-wide event store. */
export function eventStore(): EventStore {
  return (g.__darwinEvents ??= new MemoryEventStore());
}

/** Convenience: append events and return them. */
export function track(events: AnalyticsEventInput | AnalyticsEventInput[]) {
  return eventStore().append(Array.isArray(events) ? events : [events]);
}
