/**
 * The page Darwin last read for each site (its outline), remembered so every path that makes a rule live
 * (create, start, ship, autopilot, the briefing) can check its copy against what the page says (claims.ts),
 * even when it can't fetch the page right then. Kept in the kv store ("web-pages"), so it survives restarts.
 */
import type { PageElement } from "@/lib/contracts";
import { kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import { pageOutline } from "./outline";

const KEY = "web-pages";
type Pages = Record<string, { outline: PageElement[]; at: string }>;

/** Remember what a site's page says. An empty outline (page unreadable right now) keeps what we had. */
export function rememberPage(site: string, outline: readonly PageElement[]): void {
  if (!outline.length) return;
  const known = kvGet<Pages>(KEY, () => ({}))[site];
  if (known && JSON.stringify(known.outline) === JSON.stringify(outline)) return;
  kvUpdate<Pages>(KEY, () => ({}), (all) => ({ ...all, [site]: { outline: [...outline], at: new Date().toISOString() } }));
}

/** The site's page as Darwin last read it, if it ever could. */
export function knownPage(site: string): PageElement[] | undefined {
  return kvGet<Pages>(KEY, () => ({}))[site]?.outline;
}

/** The page to check copy against: the outline just read, else the one Darwin last read ([] = never read). */
export function pageFor(site: string, outline?: readonly PageElement[]): PageElement[] {
  return outline?.length ? [...outline] : (knownPage(site) ?? []);
}

/** Read a site's page (cached 5 min), remember it, and return what to check copy against. */
export async function readSitePage(site: string, url: string | undefined): Promise<PageElement[]> {
  const outline = await pageOutline(url);
  rememberPage(site, outline);
  return pageFor(site, outline);
}

/** Tests and demo resets. */
export function forgetPages(site?: string) {
  if (!site) {
    kvSet<Pages>(KEY, {});
    return;
  }
  kvUpdate<Pages>(KEY, () => ({}), (all) => {
    const { [site]: _gone, ...rest } = all; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });
}
