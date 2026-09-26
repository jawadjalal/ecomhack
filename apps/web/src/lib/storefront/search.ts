/**
 * Store search: `/store?q=…` (the URL the home page's schema.org SearchAction advertises). Pure.
 *
 * Every word of the query must match the start of a word in the product's name, category, tagline,
 * features, attributes or description ("wat" finds "waterproof"; "trail shoes" finds trail shoes).
 * Matches in the name rank first, then category, then the rest; ties keep the incoming (spec) order.
 */
import type { Product } from "@/lib/catalog/products";
import { categoryLabel } from "./products";

/** Longest query we act on or record (anything past this is noise, or a paste). */
export const MAX_QUERY_LENGTH = 80;

/** Words that describe the whole catalogue: they never narrow a search on their own. */
const GENERIC = new Set(["a", "an", "the", "for", "and", "with", "in", "of", "pace", "running", "run", "runner", "runners"]);

/** Words that mean "shoes" / "accessories", so "trail shoes" or "running accessory" work. */
const KIND_WORDS: Record<"shoe" | "accessory", string[]> = {
  shoe: ["shoe", "shoes", "trainer", "trainers", "sneaker", "sneakers", "footwear"],
  accessory: ["accessory", "accessories", "gear"],
};

/** Trim, collapse whitespace and cap the length. Returns "" for nothing searchable. */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/** Singular-ish form so "socks" matches "sock" and "vests" matches "vest". */
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function tokens(query: string): string[] {
  return [...new Set(words(query).filter((w) => !GENERIC.has(w)))];
}

interface Fields {
  name: string[];
  category: string[];
  rest: string[];
}

function fieldsOf(p: Product): Fields {
  const kind = p.category === "accessories" ? KIND_WORDS.accessory : KIND_WORDS.shoe;
  const attrs = Object.entries(p.attributes).flatMap(([k, v]) => (v === true ? words(k) : typeof v === "string" ? words(v) : []));
  return {
    name: words(p.name),
    category: [...words(p.category), ...words(categoryLabel(p.category)), ...kind],
    rest: [...words(p.tagline), ...p.features.flatMap(words), ...attrs, ...words(p.description), ...p.colors.flatMap((c) => words(c.name))],
  };
}

function hit(field: string[], token: string): boolean {
  const t = stem(token);
  return field.some((w) => w.startsWith(token) || stem(w) === t || (t.length >= 3 && w.startsWith(t)));
}

/** Relevance of one product for the query's tokens: 0 = not a match. */
export function scoreProduct(p: Product, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const f = fieldsOf(p);
  let score = 0;
  for (const t of queryTokens) {
    if (hit(f.name, t)) score += 10;
    else if (hit(f.category, t)) score += 5;
    else if (hit(f.rest, t)) score += 1;
    else return 0; // every word must match somewhere
  }
  return score;
}

/**
 * Products matching `query`, best first. `products` is the already-sorted list (spec sort), which
 * breaks ties. A query made only of generic words ("running shoes") returns every product it names.
 */
export function searchProducts(query: string, products: readonly Product[]): Product[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const ts = tokens(q);
  if (!ts.length) return words(q).length ? [...products] : [];
  return products
    .map((p, i) => ({ p, i, s: scoreProduct(p, ts) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}
