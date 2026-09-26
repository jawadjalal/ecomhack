import { PageSpecSchema, type PageSpec, type SpecPatch } from "@/lib/contracts";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** Apply a patch and validate. Throws a ZodError if the result is not a valid PageSpec. */
export function applyPatch(spec: PageSpec, patch: SpecPatch): PageSpec {
  return PageSpecSchema.parse(deepMerge(spec, patch));
}

/** Like applyPatch but returns null instead of throwing. */
export function tryApplyPatch(spec: PageSpec, patch: SpecPatch): PageSpec | null {
  const res = PageSpecSchema.safeParse(deepMerge(spec, patch));
  return res.success ? res.data : null;
}

/** Human-readable diff lines: ["cart.showShippingUpfront: false → true", ...]. */
export function describeDiff(before: PageSpec, after: PageSpec): string[] {
  const lines: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      lines.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const strip = ({ version: _v, label: _l, ...rest }: PageSpec) => rest;
  walk(strip(before), strip(after), "");
  return lines;
}
