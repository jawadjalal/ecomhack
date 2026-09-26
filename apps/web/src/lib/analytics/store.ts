/**
 * Event store. Default: in-memory ring buffer + append-only NDJSON file in `.data/events.ndjson`.
 * The team's PostHog-derived pipeline / Supabase can replace this by implementing `EventStore`.
 * When Supabase env vars are set, appended events are also mirrored there (see ./supabase.ts).
 */
import fs from "node:fs";
import path from "node:path";
import type { AnalyticsEvent, AnalyticsEventInput } from "@/lib/contracts";
import { uuid } from "@/lib/ids";
import { mirrorEvents } from "./supabase";

export interface EventStore {
  append(events: AnalyticsEventInput[]): AnalyticsEvent[];
  /** All events, oldest first. Callers must not mutate. */
  all(): readonly AnalyticsEvent[];
  /** Events strictly after the given uuid (for live feeds). Newest last. */
  since(afterUuid: string | undefined, limit: number): AnalyticsEvent[];
  clear(): void;
}

const MAX_EVENTS = Number(process.env.DARWIN_MAX_EVENTS || 250_000);
const DATA_DIR = process.env.DARWIN_DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "events.ndjson");
const PERSIST = process.env.DARWIN_PERSIST !== "0";
const PERSIST_SYNTHETIC = process.env.DARWIN_PERSIST_SYNTHETIC === "1";
/** Events bigger than this (serialized) are dropped: nothing we track legitimately comes close. */
export const MAX_EVENT_BYTES = 32 * 1024;
/** The NDJSON file is rewritten from memory once it holds this many lines, so it can't grow forever. */
const MAX_FILE_LINES = Math.max(MAX_EVENTS * 1.5, 1000);
/** A file bigger than this is set aside on start instead of being read (a huge readFileSync throws). */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

class MemoryEventStore implements EventStore {
  private events: AnalyticsEvent[] = [];
  private index = new Map<string, number>(); // uuid -> absolute position
  private offset = 0; // absolute position of events[0]
  private fileLines = 0;

  constructor() {
    if (!PERSIST) return;
    try {
      if (fs.statSync(FILE).size > MAX_FILE_BYTES) {
        fs.renameSync(FILE, `${FILE}.${Date.now()}.bak`);
        console.warn("[events] events.ndjson was too large to load; moved it aside and started fresh");
        return;
      }
      const lines = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean);
      this.fileLines = lines.length;
      for (const line of lines.slice(-MAX_EVENTS)) {
        try {
          this.push(JSON.parse(line));
        } catch {
          /* skip a corrupt line */
        }
      }
    } catch {
      /* no file yet */
    }
  }

  /** Rewrite the file with just the events still in memory (keeps it bounded). */
  private compact() {
    const keep = PERSIST_SYNTHETIC ? this.events : this.events.filter((e) => !e.properties.synthetic);
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, keep.length ? keep.map((e) => JSON.stringify(e)).join("\n") + "\n" : "");
    fs.renameSync(tmp, FILE);
    this.fileLines = keep.length;
  }

  private push(e: AnalyticsEvent) {
    this.index.set(e.uuid, this.offset + this.events.length);
    this.events.push(e);
    // Trim in batches (10% slack): splicing on every push past the cap is O(n) per event.
    if (this.events.length > MAX_EVENTS * 1.1) {
      const dropped = this.events.splice(0, this.events.length - MAX_EVENTS);
      for (const d of dropped) this.index.delete(d.uuid);
      this.offset += dropped.length;
    }
  }

  append(inputs: AnalyticsEventInput[]): AnalyticsEvent[] {
    const now = new Date().toISOString();
    const out: AnalyticsEvent[] = [];
    let oversized = 0;
    for (const i of inputs) {
      // SDK retries resend the same uuid; keep the first copy.
      if (i.uuid && this.index.has(i.uuid)) continue;
      const e = { ...i, uuid: i.uuid ?? uuid(), timestamp: i.timestamp ?? now, properties: i.properties ?? {} };
      if (JSON.stringify(e).length > MAX_EVENT_BYTES) {
        oversized++;
        continue;
      }
      this.push(e);
      out.push(e);
    }
    // Simulated traffic is regenerable and can reach hundreds of MB during long autopilot runs,
    // so by default only real events hit disk (loop, spec and experiment state persist separately).
    const toPersist = PERSIST_SYNTHETIC ? out : out.filter((e) => !e.properties.synthetic);
    if (PERSIST && toPersist.length) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(FILE, toPersist.map((e) => JSON.stringify(e)).join("\n") + "\n");
        this.fileLines += toPersist.length;
        if (this.fileLines > MAX_FILE_LINES) this.compact();
      } catch (err) {
        console.warn("[events] persist failed", err);
      }
    }
    if (oversized) console.warn(`[events] dropped ${oversized} event(s) over ${MAX_EVENT_BYTES} bytes`);
    if (out.length) mirrorEvents(out);
    return out;
  }

  all() {
    return this.events;
  }

  since(afterUuid: string | undefined, limit: number) {
    const pos = afterUuid ? this.index.get(afterUuid) : undefined;
    // No cursor, or a cursor we no longer have (evicted / store reset): start from the latest events.
    if (pos === undefined) return this.events.slice(-limit);
    const start = pos - this.offset + 1;
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
