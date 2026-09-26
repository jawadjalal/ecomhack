/**
 * Seeded randomness for the simulator. Every random choice in a simulation run goes through one
 * `Rng`, so a run is fully reproducible from its seed (ids, personas, choices, outcomes).
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick. Weights need not sum to 1. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** Log-normal-ish duration: median `median`, multiplicative spread `spread` (e.g. 1.6). */
  duration(median: number, spread?: number): number;
  /** `n` chars of base36, deterministic from the stream. */
  token(n: number): string;
}

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    chance: (p) => next() < p,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted(entries) {
      let total = 0;
      for (const [, w] of entries) total += Math.max(0, w);
      let r = next() * total;
      for (const [item, w] of entries) {
        r -= Math.max(0, w);
        if (r < 0) return item;
      }
      return entries[entries.length - 1][0];
    },
    duration(median, spread = 1.6) {
      // Box-Muller normal → log-normal around the median.
      const u = Math.max(1e-9, next());
      const v = next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return median * Math.pow(spread, Math.max(-2.5, Math.min(2.5, z)));
    },
    token(n) {
      let s = "";
      for (let i = 0; i < n; i++) s += B36[Math.floor(next() * 36)];
      return s;
    },
  };
  return rng;
}

/** murmur3 finaliser: good avalanche for deriving independent sub-seeds. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Derive an independent seed from a run seed and a path (e.g. stream id, visitor index).
 * Visitor i of a given run seed is therefore "the same person" whatever else the run contains.
 */
export function deriveSeed(seed: number, ...parts: number[]): number {
  let h = fmix32(seed >>> 0);
  for (const p of parts) h = fmix32((h ^ Math.imul(p >>> 0, 0x9e3779b1)) >>> 0);
  return h;
}

/** Random 32-bit seed for runs where the caller did not ask for determinism. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** Stable 32-bit hash of a string (FNV-1a). Used for tiny, deterministic copy effects. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
