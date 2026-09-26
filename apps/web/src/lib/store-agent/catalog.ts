/**
 * What the store sells, as offers an agent can quote and buy: the Whop business's plans (price, billing,
 * product), read with the connected Whop API key. Without a key it's a clearly labelled demo catalog so
 * the agent can still be tried; nothing pretends to be a real store.
 *
 * Whop API v1 (https://docs.whop.com/api-reference): GET /plans?account_id=… lists plans with their
 * product; POST /checkout_configurations { plan_id, metadata } returns a purchase_url whose payment
 * carries the metadata back in the payment webhook (lib/whop/map.ts reads visitor_kind / agent_name).
 */
import { kvGet, kvSet } from "@/lib/db/json-store";
import { getWhopStatus, whopKey } from "@/lib/whop";

const WHOP_API = (process.env.WHOP_API_BASE || "https://api.whop.com/api/v1").replace(/\/$/, "");
const CACHE_MS = 5 * 60_000;
const KEY = "store-agent-catalog";

export interface Offer {
  /** Whop plan id (what checkout needs). */
  id: string;
  productId?: string;
  title: string;
  description?: string;
  /** Minor units (pence / cents). 0 = free. */
  price: number;
  currency: string;
  /** "one_time", or the billing period for memberships ("month", "year", "week"…). */
  billing: string;
  /** Plain checkout link, used when a tagged checkout can't be created. */
  checkoutUrl: string;
  available: boolean;
}

export interface Catalog {
  source: "whop" | "demo";
  /** The business the agent sells for. */
  business: string;
  offers: Offer[];
  fetchedAt: string;
  /** Non-secret connection identity used to invalidate a catalog cached before Whop connected. */
  cacheContext?: string;
  /** Why it's the demo catalog, or what went wrong reading Whop. */
  note?: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);

/** Whop amounts are in major units ("19.99"); zero-decimal currencies stay as they are. */
export function minorUnits(amount: number, currency: string): number {
  return /^(jpy|krw|vnd|clp|isk|huf)$/i.test(currency) ? Math.round(amount) : Math.round(amount * 100);
}

/** One Whop plan (v1 shape, tolerant of v5 field names) → an offer. */
export function offerFromPlan(raw: unknown): Offer | undefined {
  const p = rec(raw);
  const id = str(p?.id);
  if (!p || !id) return undefined;
  const product = rec(p.product) ?? rec(p.access_pass);
  const currency = (str(p.currency) ?? "usd").toLowerCase();
  const oneTime = str(p.plan_type) === "one_time" || (p.billing_period === undefined && num(p.renewal_price) === undefined);
  const amount = (oneTime ? num(p.initial_price) : (num(p.renewal_price) ?? num(p.initial_price))) ?? 0;
  const period = num(p.billing_period);
  const billing = oneTime ? "one_time" : period === 30 || period === 31 ? "month" : period === 365 ? "year" : period === 7 ? "week" : period ? `${period} days` : (str(p.billing_period) ?? "month");
  const hidden = /hidden|archived|quick_link/i.test(str(p.visibility) ?? "");
  const stock = num(p.stock);
  return {
    id,
    productId: str(product?.id) ?? str(p.product_id),
    title: str(p.title) ?? str(product?.title) ?? str(product?.name) ?? "Untitled",
    description: str(p.description) ?? str(product?.description) ?? str(product?.headline),
    price: minorUnits(amount, currency),
    currency,
    billing,
    checkoutUrl: str(p.purchase_url) ?? str(p.direct_link) ?? `https://whop.com/checkout/${id}`,
    available: !hidden && (stock === undefined || stock > 0 || p.unlimited_stock === true),
  };
}

/** Until the team's Whop store is live: a labelled demo catalog, so the agent can be tried. */
export const DEMO_CATALOG: Omit<Catalog, "fetchedAt"> = {
  source: "demo",
  business: "Demo Whop store",
  note: "No Whop key or business yet: these are demo offers, and checkouts go to a demo page that records a labelled (simulated) payment.",
  offers: [
    { id: "plan_demo_coaching", title: "Trail Running Coaching (monthly)", description: "Weekly plans, form reviews and a private Discord with coaches.", price: 2900, currency: "gbp", billing: "month", checkoutUrl: "", available: true },
    { id: "plan_demo_race", title: "Race-Day Pack", description: "12-week marathon plan, pacing calculator and fuelling guide.", price: 4900, currency: "gbp", billing: "one_time", checkoutUrl: "", available: true },
    { id: "plan_demo_gear", title: "Gear Guide 2026", description: "Tested picks for trail shoes, vests and watches, updated monthly.", price: 900, currency: "gbp", billing: "one_time", checkoutUrl: "", available: true },
    { id: "plan_demo_club", title: "Club Membership (yearly)", description: "Everything above, plus live group runs and early access to drops.", price: 19900, currency: "gbp", billing: "year", checkoutUrl: "", available: true },
  ],
};

async function whopGet(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${WHOP_API}${path}`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Whop answered ${res.status} for ${path.split("?")[0]}`);
  return res.json();
}

export function companyId(): string | undefined {
  return process.env.WHOP_COMPANY_ID?.trim() || getWhopStatus().connection?.accountId || undefined;
}

/** The store's offers: cached 5 minutes; demo when there's no key or business. */
export async function getCatalog(opts: { fresh?: boolean; now?: number } = {}): Promise<Catalog> {
  const now = opts.now ?? Date.now();
  const key = whopKey();
  const company = companyId();
  const cacheContext = `${key ? "key" : "no-key"}:${company ?? ""}:${getWhopStatus().connection?.connectedAt ?? ""}`;
  const cached = kvGet<Catalog | null>(KEY, () => null);
  if (!opts.fresh && cached?.cacheContext === cacheContext && now - Date.parse(cached.fetchedAt) < CACHE_MS) return cached;
  const fetchedAt = new Date(now).toISOString();
  if (!key || !company) {
    return kvSet(KEY, { ...DEMO_CATALOG, fetchedAt, cacheContext, note: !key ? DEMO_CATALOG.note : "Whop key found but no business id: set WHOP_COMPANY_ID (biz_…) or connect Whop in onboarding." });
  }
  try {
    const plans = rec(await whopGet(`/plans?account_id=${encodeURIComponent(company)}&first=50`, key))?.data;
    const offers = (Array.isArray(plans) ? plans : []).map(offerFromPlan).filter((o): o is Offer => !!o && o.available);
    // The connected business's name, never the raw business id (it's the agent's public name on its A2A card).
    const business = getWhopStatus().connection?.title ?? "Whop store";
    if (!offers.length) return kvSet(KEY, { ...DEMO_CATALOG, fetchedAt, cacheContext, note: `${business} has no public plans yet: showing demo offers until it does.` });
    return kvSet(KEY, { source: "whop", business, offers, fetchedAt, cacheContext });
  } catch (err) {
    return kvSet(KEY, { ...DEMO_CATALOG, fetchedAt, cacheContext, note: `Couldn't read Whop (${(err as Error).message}): showing demo offers.` });
  }
}

/**
 * A checkout link for one offer, tagged so the payment comes back as this agent's sale: Whop checkout
 * configuration with metadata, else the plan's plain link; demo offers use Darwin's demo checkout page.
 */
export async function createCheckout(offer: Offer, catalog: Catalog, meta: { ref: string; agentName: string; synthetic?: boolean }, origin: string): Promise<{ url: string; tagged: boolean }> {
  if (catalog.source === "demo") return { url: `${origin}/checkout/demo?offer=${encodeURIComponent(offer.id)}&ref=${encodeURIComponent(meta.ref)}`, tagged: true };
  // Simulated buyers never touch the merchant's Whop account (no checkout configurations created for them).
  if (meta.synthetic) return { url: offer.checkoutUrl, tagged: false };
  const key = whopKey();
  if (key) {
    try {
      const res = await fetch(`${WHOP_API}/checkout_configurations`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ plan_id: offer.id, metadata: { visitor_kind: "agent", agent_name: meta.agentName, darwin_ref: meta.ref, darwin_site: "whop" } }),
        signal: AbortSignal.timeout(8000),
      });
      const url = res.ok ? str(rec(await res.json())?.purchase_url) : undefined;
      if (url) return { url, tagged: true };
    } catch {
      /* fall back to the plain link */
    }
  }
  return { url: offer.checkoutUrl, tagged: false };
}

export function resetCatalog() {
  kvSet<Catalog | null>(KEY, null);
}

export const formatPrice = (o: Pick<Offer, "price" | "currency" | "billing">) => {
  const money = o.price === 0 ? "Free" : new Intl.NumberFormat("en-GB", { style: "currency", currency: o.currency.toUpperCase(), maximumFractionDigits: o.price % 100 ? 2 : 0 }).format(o.price / 100);
  return o.billing === "one_time" || o.price === 0 ? money : `${money}/${o.billing}`;
};
