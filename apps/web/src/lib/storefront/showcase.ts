/**
 * What the demo storefront (/store) is: its brand name and, optionally, a strip of the live Whop catalog.
 *
 * /store is the store Darwin optimizes: the PageSpec, the simulator, the insights and the agent tools
 * (MCP / A2A / ACP on `pace-store`) are all built on the PACE running-shoes catalog (`lib/catalog`). So by
 * default the storefront is PACE, end to end, and the console's issues ("agents can't see delivery ETAs
 * for trail shoes") describe the page a visitor actually sees.
 *
 * The Whop catalog belongs where Whop is the subject: the store agent (/a2a/whop, /console/agents) and
 * onboarding. Set DARWIN_STORE_CATALOG=whop to also show a "Best of <Whop business>" strip on /store
 * (and use that business's name as the brand), e.g. for a Whop-only demo.
 */
import { getWhopShowcase, type WhopShowcase } from "@/lib/whop";

export const DEMO_STORE_BRAND = "PACE";

export type StoreCatalog = "pace" | "whop";

export function storeCatalog(env: Record<string, string | undefined> = process.env): StoreCatalog {
  return env.DARWIN_STORE_CATALOG?.trim().toLowerCase() === "whop" ? "whop" : "pace";
}

export interface StoreBranding {
  brand: string;
  /** The live Whop catalog strip; null unless DARWIN_STORE_CATALOG=whop and Whop answered with products. */
  showcase: WhopShowcase | null;
}

/** Brand + optional Whop strip for a storefront catalog mode (pure: the Whop call is injected). */
export function brandingFor(catalog: StoreCatalog, showcase: WhopShowcase | null): StoreBranding {
  if (catalog !== "whop" || !showcase || showcase.products.length === 0) return { brand: DEMO_STORE_BRAND, showcase: null };
  // Whop's fallback title is the generic "Store": keep PACE rather than a wordmark that says "STORE".
  const title = showcase.title?.trim();
  const brand = title && title.toLowerCase() !== "store" ? title : DEMO_STORE_BRAND;
  return { brand, showcase: { ...showcase, title: brand } };
}

export async function getStoreBranding(): Promise<StoreBranding> {
  const catalog = storeCatalog();
  if (catalog !== "whop") return brandingFor(catalog, null);
  return brandingFor(catalog, await getWhopShowcase().catch(() => null));
}
