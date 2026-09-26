/**
 * Small helpers shared by the optimizer: number formatting for log/insight copy,
 * canonical patch keys, patch diffing and a seeded PRNG.
 */
import type { PageSpec, SpecPatch } from "@/lib/contracts";
import { tryApplyPatch } from "@/lib/spec/patch";

/* ------------------------------------------------------------------ formatting */

/** 0.583 → "58%", 0.024 → "2.4%". One decimal below 10%. */
export function pct(x: number): string {
  if (!Number.isFinite(x)) return "–";
  const v = x * 100;
  return Math.abs(v) < 10 && v !== 0 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

/** Relative change with a sign: 0.12 → "+12%", -0.08 → "-8%". */
export function signedPct(x: number): string {
  if (!Number.isFinite(x)) return "–";
  const s = pct(Math.abs(x));
  return x > 0 ? `+${s}` : x < 0 ? `-${s}` : s;
}

/** 1200 → "1,200". */
export function num(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Round to one decimal (for impact scores). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/* ------------------------------------------------------------------ patches */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Stable JSON (sorted keys) so equal patches get equal keys regardless of key order. */
export function canonicalKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalKey(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The minimal patch that turns `before` into `after` (only changed leaves; never version/label). */
export function diffPatch(before: PageSpec, after: PageSpec): SpecPatch {
  const walk = (a: unknown, b: unknown): unknown => {
    if (isPlainObject(a) && isPlainObject(b)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(b)) {
        const d = walk(a[key], b[key]);
        if (d !== undefined) out[key] = d;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(a) === JSON.stringify(b) ? undefined : b;
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const strip = ({ version: _v, label: _l, ...rest }: PageSpec) => rest;
  return (walk(strip(before), strip(after)) as SpecPatch | undefined) ?? {};
}

/**
 * Validate a patch against a spec and reduce it to the knobs that actually change.
 * Returns null when the patch is invalid or a no-op. Unknown keys are dropped.
 */
export function normalizePatch(spec: PageSpec, patch: SpecPatch): { patch: SpecPatch; next: PageSpec } | null {
  const next = tryApplyPatch(spec, patch);
  if (!next) return null;
  const minimal = diffPatch(spec, next);
  if (!Object.keys(minimal).length) return null;
  return { patch: minimal, next };
}

/* ------------------------------------------------------------------ randomness */

/** FNV-1a 32-bit hash → unsigned int. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG in [0, 1). */
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

/** Numbers mentioned in a string, normalised ("1,200" → "1200", "58.0" → "58"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((m) => String(Number(m.replace(/,/g, ""))));
}

/** Reject after `ms`. Used to keep LLM calls from stalling a live demo. */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
