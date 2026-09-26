/**
 * What's on a page that a rule could change: headings, buttons, popups, prices, and the strips where a
 * store states its facts (delivery, returns, reviews). Found in the raw HTML with a few regexes (no DOM),
 * so drafts point at real selectors on any store, not guesses, and reuse the page's own words (claims.ts).
 */
import type { PageElement } from "@/lib/contracts";
import { safeFetch } from "@/lib/readiness";

const MAX_ELEMENTS = 30;
/** Class names that say what an element is for. Preferred when building a selector. */
const MEANINGFUL = /hero|title|head|sub|tagline|lede|cta|cart|buy|add|checkout|popup|modal|newsletter|promo|announce|banner|price|badge|review|rating|usp|benefit|perk|trust|guarantee|shipping|delivery|returns/i;
const INTERESTING_CLASS = /popup|modal|newsletter|promo|announce|banner|price|hero|sub(title|head)|tagline|lede|review|rating|usp|benefit|perk|trust|guarantee|shipping|delivery|returns|testimonial/i;
/** Closing block tags: kept as " · " so "<div>Free returns</div><div>Ships in 24h</div>" stays two statements. */
const BLOCK_END = /<\/(?:div|p|li|dt|dd|td|th|tr|h[1-6]|section|aside|header|footer|article|button|label|ul|ol)\s*>|<br\s*\/?>/gi;

/** Visible text, at most 80 characters; a cut text ends in "…" (so nothing reads a half claim as whole). */
function clean(html: string): string {
  const text = html
    .replace(BLOCK_END, " · ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/^[\s·]+|[\s·]+$/g, "");
  return text.length > 80 ? `${text.slice(0, 79).replace(/[\s·]+$/, "")}…` : text;
}

function attr(attrs: string, name: string): string | undefined {
  // (^|\s) not \b: "data-id" must not count as "id".
  return attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined);
}

/** A readable, reasonably specific selector: tag#id, tag.meaningful-class, or tag. */
export function selectorFor(tag: string, attrs: string): string {
  const t = tag.toLowerCase();
  const idv = attr(attrs, "id");
  if (idv && /^[A-Za-z][\w-]*$/.test(idv)) return `${t}#${idv}`;
  const classes = (attr(attrs, "class") ?? "").split(/\s+/).filter((c) => /^[A-Za-z_][\w-]*$/.test(c));
  const best = classes.find((c) => MEANINGFUL.test(c)) ?? classes[0];
  if (best) return `${t}.${best}`;
  const name = attr(attrs, "name");
  if (name && /^[\w-]+$/.test(name)) return `${t}[name="${name}"]`;
  return t;
}

export function outlineFromHtml(html: string): PageElement[] {
  const body = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, "");
  const found: (PageElement & { at: number })[] = [];
  const add = (at: number, tag: string, attrs: string, inner: string) => {
    const text = clean(inner);
    const selector = selectorFor(tag, attrs);
    // A bare "button" or "a" would match every one on the page: not a useful target.
    if (selector === tag.toLowerCase() && tag.toLowerCase() !== "h1") return;
    if (found.some((f) => f.selector === selector)) return;
    found.push({ at, selector, tag: tag.toLowerCase(), text });
  };

  for (const m of body.matchAll(/<(h1|h2|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) add(m.index ?? 0, m[1], m[2], m[3]);
  for (const m of body.matchAll(/<(a|input)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const cls = attr(attrs, "class") ?? "";
    if (m[1].toLowerCase() === "input" && /type\s*=\s*["']?submit/i.test(attrs)) add(m.index ?? 0, "input", attrs, attr(attrs, "value") ?? "");
    if (m[1].toLowerCase() === "a" && /\b(btn|button|cta)\b|shop|buy/i.test(cls)) {
      const inner = body.slice((m.index ?? 0) + m[0].length).split(/<\/a>/i)[0];
      add(m.index ?? 0, "a", attrs, inner);
    }
  }
  // One pass per tag, so a <p> inside a matched <section> is still found.
  for (const tag of ["div", "section", "aside", "p", "span", "dialog"]) {
    for (const m of body.matchAll(new RegExp(`<${tag}\\b([^>]*\\sclass\\s*=\\s*["'][^"']*["'][^>]*)>([\\s\\S]{0,400}?)</${tag}>`, "gi"))) {
      if (INTERESTING_CLASS.test(attr(m[1], "class") ?? "")) add(m.index ?? 0, tag, m[1], m[2]);
    }
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_ELEMENTS)
    .map(({ selector, tag, text }) => ({ selector, tag, text }));
}

const CACHE_MS = 5 * 60_000;
const g = globalThis as unknown as { __darwinOutlines?: Map<string, { at: number; outline: PageElement[] }> };

/** Fetch a public page (SSRF-safe) and outline it, cached for 5 minutes. Never throws: [] when it can't be read. */
export async function pageOutline(url: string | undefined, now = Date.now()): Promise<PageElement[]> {
  if (!url) return [];
  const cache = (g.__darwinOutlines ??= new Map());
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.outline;
  const res = await safeFetch(url, { timeoutMs: 6000 });
  const outline = res.error || res.status >= 400 || !res.body ? [] : outlineFromHtml(res.body);
  cache.set(url, { at: now, outline });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return outline;
}
