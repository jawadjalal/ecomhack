/**
 * darwin.js site ids: the one way an id is derived from a store address, and the one list of sites every
 * picker shows (onboarding, Dashboards, Personalize, Traffic): tracking-plan sites ∪ web-rule sites ∪ sites
 * with events.
 */
import type { AnalyticsEvent } from "@/lib/contracts";

/**
 * "https://WWW.Shop.Example.com/x" → "shop-example-com": the darwin.js site id for a store address.
 * Case- and www-insensitive, so shop.example.com and www.Shop.example.com are the same site.
 * Returns "" for something that isn't a URL with a host.
 */
export function siteIdForUrl(url: string): string {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).hostname;
  } catch {
    return "";
  }
  return host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** The darwin.js site an event came from, if it says. */
export function eventSite(e: AnalyticsEvent): string | undefined {
  const s = e.properties?.darwin_site;
  return typeof s === "string" && s ? s : undefined;
}

/**
 * Every site Darwin knows, sorted and without duplicates: tracking-plan sites ∪ web-rule sites ∪ sites with
 * events ∪ any extra (e.g. the demo store). Callers pass what they have; lib/web doesn't import lib/tracking.
 */
export function siteDirectory(input: {
  plans?: readonly string[];
  rules?: readonly { site: string }[];
  events?: readonly AnalyticsEvent[];
  extra?: readonly (string | undefined)[];
}): string[] {
  const out = new Set<string>();
  for (const s of input.plans ?? []) if (s) out.add(s);
  for (const r of input.rules ?? []) if (r.site) out.add(r.site);
  for (const e of input.events ?? []) {
    const s = eventSite(e);
    if (s) out.add(s);
  }
  for (const s of input.extra ?? []) if (s) out.add(s);
  return [...out].sort();
}
