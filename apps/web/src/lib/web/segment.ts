/**
 * Server-side twin of the browser runtime's segmenting (runtime.ts): traffic source, search query,
 * audience matching and variant assignment. Results and the simulator use these, so they agree with
 * what visitors actually saw. Keep the two in sync (segment.test.ts checks the same cases).
 */
import type { TrafficSource, WebAudience, WebRule } from "@/lib/contracts";
import { hashToUnit } from "@/lib/experiments/assign";

export interface Segment {
  source: TrafficSource;
  /** Lower-case search query ("" when none). */
  query: string;
}

const AI = /chatgpt|openai|perplexity|claude|anthropic|gemini|copilot|you\.com|phind|mistral|grok|meta\.ai/;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid_social|display|cpm)$/;
const SEARCH_HOST = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage)\./;
const SOCIAL = /instagram|facebook|fb\.com|tiktok|twitter|(^|\.)x\.com|linkedin|pinterest|reddit|youtube|threads|snapchat/;

function parse(u: string | undefined): URL | undefined {
  try {
    return u ? new URL(u) : undefined;
  } catch {
    return undefined;
  }
}

const bareHost = (u: URL | undefined) => (u ? u.hostname.replace(/^www\./, "").toLowerCase() : "");

/** Where a visitor came from, from their landing URL and document.referrer. */
export function classifySource(input: { url?: string; referrer?: string }): Segment {
  const page = parse(input.url);
  const param = (k: string) => page?.searchParams.get(k) ?? "";
  let ref = bareHost(parse(input.referrer));
  if (ref && ref === bareHost(page)) ref = "";
  const us = param("utm_source").toLowerCase();
  const um = param("utm_medium").toLowerCase();
  const query = (param("utm_term") || param("q") || param("query") || param("s")).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  const both = `${ref} ${us}`;

  let source: TrafficSource;
  if (AI.test(both)) source = "ai";
  else if (param("gclid") || param("fbclid") || param("msclkid") || param("ttclid") || PAID_MEDIUM.test(um)) source = "paid";
  else if (um === "email" || /klaviyo|mailchimp|newsletter|email/.test(us)) source = "email";
  else if (SEARCH_HOST.test(`${ref}.`) || /^(google|bing|duckduckgo|yahoo)$/.test(us) || (!ref && !us && param("utm_term"))) source = "search";
  else if (ref === "t.co" || SOCIAL.test(both) || um === "social") source = "social";
  else if (ref || us) source = "referral";
  else source = "direct";
  return { source, query };
}

export function matchesAudience(audience: WebAudience | undefined, seg: Segment, pathname = "/"): boolean {
  const a = audience ?? {};
  if (a.sources?.length && !a.sources.includes(seg.source)) return false;
  if (a.queryIncludes?.length && !a.queryIncludes.some((w) => seg.query && seg.query.includes(w.toLowerCase()))) return false;
  if (a.paths?.length && !a.paths.some((p) => pathname.startsWith(p))) return false;
  return true;
}

/** The arm a visitor sees: shipped and "always" rules show the change to everyone in the audience. */
export function assignWebVariant(visitorId: string, rule: Pick<WebRule, "id" | "mode" | "status" | "allocation">): "control" | "treatment" {
  if (rule.status === "shipped" || rule.mode === "always") return "treatment";
  return hashToUnit(`${visitorId}:${rule.id}`) < rule.allocation ? "treatment" : "control";
}

/** Title Case, as the runtime renders `{query}`. */
export function titleCase(s: string): string {
  return s.replace(/(^|\s)(\S)/g, (_m, sp: string, c: string) => sp + c.toUpperCase());
}

/** A change value with `{query}` filled in, or null when it needs a query and there isn't one. */
export function fillValue(value: string | undefined, seg: Segment): string | null {
  const v = value ?? "";
  if (!v.includes("{query}")) return v;
  return seg.query ? v.replace(/\{query\}/g, titleCase(seg.query)) : null;
}
