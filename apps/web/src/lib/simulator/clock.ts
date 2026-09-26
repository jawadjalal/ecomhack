import type { Rng } from "./rng";

export interface SimClock {
  /** Wall clock "now", ms. */
  now: number;
  /** Sessions end uniformly in [now - spreadMs, now]. 0 = live trickle. */
  spreadMs: number;
}

/**
 * Map a session's relative offsets (ms from session start) onto the wall clock.
 * With a spread, sessions END uniformly in [now - spread, now] with realistic dwell times.
 * With spread 0 (the console's live trickle) sessions end in the last ~3s and are compressed to at
 * most 10s, so the live feed reads as "just now".
 */
export function placeSession(offsets: number[], rng: Rng, clock: SimClock): string[] {
  const total = offsets.length ? offsets[offsets.length - 1] : 0;
  const end = clock.spreadMs > 0 ? clock.now - rng.next() * clock.spreadMs : clock.now - rng.next() * 3_000;
  const scale = clock.spreadMs > 0 || total <= 10_000 ? 1 : 10_000 / total;
  return offsets.map((o) => new Date(Math.round(end - (total - o) * scale)).toISOString());
}
