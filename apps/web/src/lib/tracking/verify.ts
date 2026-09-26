/**
 * Does the merchant control the store they claimed? Onboarding shows the plan to anyone (it's a preview), but
 * the live "Recording" step waits for proof, either of:
 *
 *   1. events: darwin.js on that store already sent ≥1 real (non-simulated) event for the site id, from a page
 *      on the claimed host (www-insensitive);
 *   2. tag: the store's homepage has the darwin.js script tag with data-darwin-site="<site>" (or a darwin.js /
 *      runtime.js src naming the site).
 *
 * Results are cached for ~10 s per site + host, so polling the check is cheap. Unreachable stores are
 * "not verified yet", with a plain-English reason, never an error.
 */
import type { AnalyticsEvent } from "@/lib/contracts";
import type { Fetched } from "@/lib/readiness/checks";

export interface VerifyResult {
  verified: boolean;
  via?: "events" | "tag";
  host: string;
  checkedAt: string;
  detail: string;
}

export interface VerifyDeps {
  events: () => readonly AnalyticsEvent[];
  fetchPage: (url: string) => Promise<Fetched>;
  now?: () => number;
}

export const VERIFY_CACHE_MS = 10_000;

/** "WWW.Eastfork.com:443" → "eastfork.com". */
export function normHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

/** "www.eastfork.com" / "https://www.eastfork.com/x" → URL, or undefined for anything that isn't http(s) with a dotted host. */
export function storeUrl(raw: string): URL | undefined {
  const s = raw.trim();
  if (!s || s.length > 300) return undefined;
  if (!/^https?:\/\//i.test(s) && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".") && !u.username && !u.password ? u : undefined;
  } catch {
    return undefined;
  }
}

function hostOfUrl(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return normHost(new URL(v).host);
  } catch {
    return undefined;
  }
}

/** A real darwin.js event for `site` from a page on `host`, if there is one. */
export function realEventFrom(site: string, host: string, events: readonly AnalyticsEvent[]): AnalyticsEvent | undefined {
  const want = normHost(host);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const p = e.properties ?? {};
    if (p.darwin_site !== site || p.synthetic === true) continue;
    const from = hostOfUrl(p.$current_url) ?? (typeof p.$host === "string" ? normHost(p.$host) : undefined);
    if (from === want) return e;
  }
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What the homepage's darwin.js tags say: "match" when one names `site`, "other" (with the site ids found)
 * when darwin.js is there for a different site, "none" when there's no darwin.js at all.
 */
export function findDarwinTag(html: string, site: string): { found: "match" | "other" | "none"; sites: string[] } {
  const tags = html.slice(0, 1_500_000).match(/<script\b[^>]*>/gi) ?? [];
  const sites = new Set<string>();
  const want = new RegExp(`(?:^|[\\s"'])data-darwin-site\\s*=\\s*(["']?)${escapeRe(site)}\\1(?=[\\s>/]|$)`, "i");
  const srcSite = new RegExp(`/(?:darwin\\.js|api/web/runtime\\.js)[^"'\\s>]*[?&](?:amp;)?site=${escapeRe(encodeURIComponent(site))}(?:[&"'\\s>]|$)`, "i");
  let darwin = false;
  for (const tag of tags) {
    const isDarwin = /data-darwin-site|\/darwin\.js|\/api\/web\/runtime\.js/i.test(tag);
    if (!isDarwin) continue;
    darwin = true;
    if (want.test(tag) || srcSite.test(tag)) return { found: "match", sites: [site] };
    const named = tag.match(/data-darwin-site\s*=\s*["']?([\w.-]{1,64})/i)?.[1] ?? tag.match(/[?&](?:amp;)?site=([\w.-]{1,64})/i)?.[1];
    if (named) sites.add(named);
  }
  return { found: darwin ? (sites.size ? "other" : "none") : "none", sites: [...sites] };
}

const g = globalThis as unknown as { __darwinVerifyCache?: Map<string, { at: number; result: VerifyResult }> };
const cache = () => (g.__darwinVerifyCache ??= new Map());

export function resetVerifyCache() {
  cache().clear();
}

/** Check ownership of `url` for darwin.js site id `site` (see the file comment). Never throws. */
export async function verifyOwnership(site: string, url: URL, deps: VerifyDeps): Promise<VerifyResult> {
  const now = deps.now ?? Date.now;
  const host = normHost(url.host);
  const key = `${site}|${host}`;
  const hit = cache().get(key);
  if (hit && now() - hit.at < VERIFY_CACHE_MS) return hit.result;

  const done = (r: Omit<VerifyResult, "host" | "checkedAt">): VerifyResult => {
    const result = { ...r, host, checkedAt: new Date(now()).toISOString() };
    cache().set(key, { at: now(), result });
    if (cache().size > 2000) cache().delete(cache().keys().next().value!);
    return result;
  };

  const event = realEventFrom(site, host, deps.events());
  if (event) {
    return done({ verified: true, via: "events", detail: `darwin.js on ${host} is sending real visits for ${site} (last one ${event.timestamp}).` });
  }

  const home = `${url.protocol}//${url.host}/`;
  let page: Fetched;
  try {
    page = await deps.fetchPage(home);
  } catch (e) {
    page = { url: home, status: 0, headers: {}, body: "", error: (e as Error)?.message ?? "failed" };
  }
  if (page.status === 0 || page.error) {
    const why = page.error ? ` (${page.error.replace(/\.$/, "")})` : "";
    return done({
      verified: false,
      detail: `Couldn't reach ${host}${why}, and no real visits from it have arrived yet. Add the darwin.js tag, open any page of your store, then check again.`,
    });
  }
  if (page.status >= 400) {
    return done({ verified: false, detail: `${host} answered ${page.status}, and no real visits from it have arrived yet. Add the darwin.js tag, open any page of your store, then check again.` });
  }
  const tag = findDarwinTag(page.body, site);
  if (tag.found === "match") return done({ verified: true, via: "tag", detail: `Found the darwin.js tag for ${site} on ${host}'s homepage.` });
  if (tag.found === "other") {
    return done({ verified: false, detail: `${host} has darwin.js, but for ${tag.sites.join(", ")}, not ${site}. Use the tag Darwin gave you (data-darwin-site="${site}").` });
  }
  return done({
    verified: false,
    detail: `darwin.js isn't on ${host}'s homepage yet, and no real visits from it have arrived. Add the tag (data-darwin-site="${site}"), publish, then check again.`,
  });
}
