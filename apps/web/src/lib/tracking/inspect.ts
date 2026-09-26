/**
 * What is the merchant's store built on? One look at the homepage (fetched SSRF-safe) so onboarding can show the
 * right install steps (Shopify theme.liquid, Webflow custom code, WordPress header…). detectPlatform() is a pure
 * function of the page; inspectStore() fetches and caches per host for 10 minutes.
 */
import type { Fetched } from "@/lib/readiness/checks";
import { normHost } from "./verify";

export type StorePlatform = "shopify" | "webflow" | "wordpress" | "squarespace" | "wix" | "bigcommerce" | "custom" | "unknown";

export interface StoreInspection {
  host: string;
  reachable: boolean;
  platform: StorePlatform;
  signals: string[];
  title?: string;
}

type Known = Exclude<StorePlatform, "custom" | "unknown">;

/** Tell-tale strings in the page (case-insensitive), and headers, per platform. */
const BODY: Record<Known, { label: string; re: RegExp }[]> = {
  shopify: [
    { label: "cdn.shopify.com", re: /cdn\.shopify\.com/i },
    { label: "Shopify.theme", re: /Shopify\.theme\b/ },
    { label: "myshopify.com", re: /[\w-]+\.myshopify\.com/i },
  ],
  webflow: [
    { label: "data-wf-site", re: /\bdata-wf-site\b/i },
    { label: "webflow.js", re: /webflow(?:\.[\w-]+)*\.js/i },
  ],
  wordpress: [
    { label: "wp-content", re: /\/wp-content\//i },
    { label: "wp-json", re: /\/wp-json\b/i },
  ],
  squarespace: [{ label: "static1.squarespace.com", re: /static1\.squarespace\.com/i }],
  wix: [{ label: "wixstatic", re: /wixstatic\.com/i }],
  bigcommerce: [{ label: "bigcommerce", re: /bigcommerce\.com|\bbigcommerce\b/i }],
};

const HEADERS: Record<Known, { label: string; test: (h: Record<string, string>) => boolean }[]> = {
  shopify: [
    { label: "x-shopid header", test: (h) => "x-shopid" in h },
    { label: "powered-by: Shopify", test: (h) => /shopify/i.test(h["powered-by"] ?? "") },
  ],
  webflow: [],
  wordpress: [{ label: "x-powered-by: WordPress", test: (h) => /wordpress|wp engine/i.test(`${h["x-powered-by"] ?? ""} ${h.link ?? ""}`) || /wp-json/i.test(h.link ?? "") }],
  squarespace: [{ label: "server: Squarespace", test: (h) => /squarespace/i.test(h.server ?? "") }],
  wix: [{ label: "x-wix-request-id header", test: (h) => "x-wix-request-id" in h }],
  bigcommerce: [{ label: "x-bc-* header", test: (h) => Object.keys(h).some((k) => k.startsWith("x-bc-")) }],
};

const ORDER: Known[] = ["shopify", "webflow", "wordpress", "squarespace", "wix", "bigcommerce"];

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d{1,5});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** The platform a page was built with, the evidence, and the page title. Pure. */
export function detectPlatform(html: string, headers: Record<string, string> = {}): { platform: StorePlatform; signals: string[]; title?: string } {
  const body = html.slice(0, 1_500_000);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  let best: { platform: Known; signals: string[] } | undefined;
  for (const p of ORDER) {
    const signals = [...BODY[p].filter((s) => s.re.test(body)).map((s) => s.label), ...HEADERS[p].filter((s) => s.test(h)).map((s) => s.label)];
    if (signals.length && (!best || signals.length > best.signals.length)) best = { platform: p, signals };
  }
  const raw = body.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i)?.[1];
  const title = raw ? decode(raw).slice(0, 120) || undefined : undefined;
  if (best) return { platform: best.platform, signals: best.signals, title };
  return { platform: /<html|<body|<head/i.test(body) ? "custom" : "unknown", signals: [], title };
}

export const INSPECT_CACHE_MS = 10 * 60_000;
/** A store we couldn't reach is retried sooner. */
const UNREACHABLE_CACHE_MS = 30_000;
const g = globalThis as unknown as { __darwinInspectCache?: Map<string, { at: number; ttl: number; result: StoreInspection }> };
const cache = () => (g.__darwinInspectCache ??= new Map());

export function resetInspectCache() {
  cache().clear();
}

/** Fetch the store's homepage and detect its platform. Cached per host for 10 minutes. Never throws. */
export async function inspectStore(url: URL, deps: { fetchPage: (url: string) => Promise<Fetched>; now?: () => number }): Promise<StoreInspection> {
  const now = deps.now ?? Date.now;
  const host = normHost(url.host);
  const hit = cache().get(host);
  if (hit && now() - hit.at < hit.ttl) return hit.result;

  let page: Fetched;
  try {
    page = await deps.fetchPage(`${url.protocol}//${url.host}/`);
  } catch (e) {
    page = { url: url.href, status: 0, headers: {}, body: "", error: (e as Error)?.message ?? "failed" };
  }
  const reachable = !page.error && page.status >= 200 && page.status < 400;
  const found = detectPlatform(reachable ? page.body : "", page.headers ?? {});
  // Blocked or down: headers may still name the platform; otherwise we can't tell.
  const platform = !reachable && found.platform === "custom" ? "unknown" : found.platform;
  const result: StoreInspection = { host, reachable, platform, signals: found.signals, ...(found.title ? { title: found.title } : {}) };
  cache().set(host, { at: now(), ttl: reachable ? INSPECT_CACHE_MS : UNREACHABLE_CACHE_MS, result });
  if (cache().size > 1000) cache().delete(cache().keys().next().value!);
  return result;
}
