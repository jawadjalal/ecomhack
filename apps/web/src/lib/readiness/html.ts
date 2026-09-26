/**
 * Just enough HTML reading for the audit, without a DOM: JSON-LD blocks, links, meta and platform hints.
 */
import type { StorePlatform } from "@/lib/contracts";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every JSON-LD node on the page, with @graph and arrays flattened. Invalid blocks are skipped. */
export function jsonLdNodes(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isObj(v)) return;
    out.push(v);
    if (Array.isArray(v["@graph"])) (v["@graph"] as unknown[]).forEach(visit);
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* invalid JSON-LD: ignore (reported as missing) */
    }
  }
  return out;
}

export function hasType(node: Json, type: string): boolean {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

export function findNode(nodes: Json[], ...types: string[]): Json | undefined {
  return nodes.find((n) => types.some((t) => hasType(n, t)));
}

/** The offer(s) of a Product node, flattening arrays and AggregateOffer.offers. */
export function offersOf(product: Json): Json[] {
  const raw = product.offers;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(isObj);
  return list.flatMap((o) => (hasType(o, "AggregateOffer") && Array.isArray(o.offers) ? (o.offers as unknown[]).filter(isObj) : [o]));
}

/** Absolute same-origin links on the page. */
export function links(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  const origin = new URL(base).origin;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin) out.add(u.href);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/** Heuristic product-page URL: /products/…, /product/…, /p/…, /shop/… with a slug. */
export function looksLikeProductUrl(href: string): boolean {
  const path = new URL(href).pathname;
  return /\/(products?|p|item|shop)\/[^/]+\/?$/i.test(path) && !/\/(collections?|categor(y|ies))\/?$/i.test(path);
}

export function title(html: string): string | undefined {
  return html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim();
}

export function metaDescription(html: string): string | undefined {
  return html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i)?.[1]?.trim();
}

/** Visible text length after dropping scripts, styles and tags: a rough "did the server render content?" signal. */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** A price-looking string in the server-rendered text (£12.00, $9.99, 12,00 €). */
export function hasVisiblePrice(html: string): boolean {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  return /[£$€]\s?\d{1,5}([.,]\d{2})?|\d{1,5}[.,]\d{2}\s?(€|EUR|GBP|USD)/.test(text);
}

export function detectPlatform(html: string, headers: Record<string, string>): StorePlatform {
  const h = (k: string) => headers[k.toLowerCase()] ?? "";
  if (h("x-shopid") || h("x-shopify-stage") || /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/.test(html)) return "shopify";
  if (/wp-content\/plugins\/woocommerce|woocommerce/i.test(html)) return "woocommerce";
  if (/cdn\d*\.bigcommerce\.com/i.test(html)) return "bigcommerce";
  if (/Magento_|mage\/cookies|x-magento/i.test(html) || h("x-magento-cache-debug")) return "magento";
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) return "wix";
  if (/squarespace(-cdn)?\.com/i.test(html)) return "squarespace";
  if (/\/_next\/static\//.test(html) || h("x-powered-by").includes("Next.js")) return "nextjs";
  return "unknown";
}

/** Links to returns / shipping / refund policies. */
export function policyLinks(allLinks: string[]): string[] {
  return allLinks.filter((l) => /(return|refund|shipping|delivery)/i.test(new URL(l).pathname));
}
