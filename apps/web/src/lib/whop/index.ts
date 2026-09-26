/**
 * Whop integration — public API. OWNED BY: onboarding PR.
 *
 *   connectWhop     verify a Whop API key against /accounts/me, remember the connected business
 *   getWhopStatus   what onboarding shows (configured?, connection)
 *
 * Same key the Whop CLI uses: `whop login --method api-key --api-key whop_xxx`, or WHOP_API_KEY.
 * Modes:
 *   offline — no key anywhere: no network; returns a clearly labelled demo business.
 *   live    — key from the request or WHOP_API_KEY: real account lookup.
 * Which business: WHOP_COMPANY_ID (biz_…) when set, read via /companies/{id}; else /accounts/me.
 * (A key can often *see* other businesses' products, so we never guess the business from a product list.)
 * The key itself is kept in memory only (never written to .data/, never returned to the browser).
 */
import { kvGet, kvSet } from "@/lib/db/json-store";

const WHOP_API = (process.env.WHOP_API_BASE || "https://api.whop.com/api/v1").replace(/\/$/, "");

export type WhopMode = "offline" | "live";

export interface WhopProduct {
  id: string;
  title: string;
}

export interface WhopConnection {
  mode: WhopMode;
  accountId?: string;
  title: string;
  products: WhopProduct[];
  connectedAt: string;
  notes: string[];
}

export interface WhopStatus {
  /** WHOP_API_KEY is set on the server. */
  configured: boolean;
  connection?: WhopConnection;
}

export class WhopError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhopError";
  }
}

const KEY = "whop-connection";
const secret = globalThis as unknown as { __darwinWhopKey?: string };

function companyId(): string | undefined {
  return process.env.WHOP_COMPANY_ID?.trim() || undefined;
}

function serverKey(): string | undefined {
  return process.env.WHOP_API_KEY?.trim() || undefined;
}

/** The key to call Whop with: the one pasted in onboarding, else WHOP_API_KEY. */
export function whopKey(): string | undefined {
  return secret.__darwinWhopKey || serverKey();
}

async function whopGet<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${WHOP_API}${path}`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
      detail = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? "");
    } catch {
      /* not json */
    }
    if (res.status === 401) throw new WhopError("Whop rejected that API key. Create one under Developer → API keys on whop.com.", 401);
    // 403 = the key is real but lacks a scope; callers may fall back to an endpoint it can read.
    throw new WhopError(`Whop answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status === 403 ? 403 : 502);
  }
  return (await res.json()) as T;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

type RawProduct = Record<string, unknown> & { account?: { id?: unknown; title?: unknown } };

function toProducts(data: RawProduct[]): WhopProduct[] {
  return data
    .map((p) => ({ id: str(p.id) ?? "", title: str(p.title) ?? str(p.name) ?? "Untitled product" }))
    .filter((p) => p.id);
}

/** Products are a nice-to-have for the onboarding summary: never fail the connection over them. */
async function listProducts(key: string, accountId?: string): Promise<RawProduct[]> {
  try {
    const q = accountId ? `account_id=${encodeURIComponent(accountId)}&first=6` : "first=6";
    return ((await whopGet<{ data?: unknown[] }>(`/products?${q}`, key)).data ?? []) as RawProduct[];
  } catch {
    return [];
  }
}

export async function connectWhop(opts: { apiKey?: string } = {}): Promise<WhopConnection> {
  const pasted = opts.apiKey?.trim();
  const key = pasted || whopKey();
  const now = new Date().toISOString();

  if (!key) {
    return kvSet<WhopConnection>(KEY, {
      mode: "offline",
      title: "Demo business",
      products: [],
      connectedAt: now,
      notes: ["No Whop key: running offline. Paste an API key or set WHOP_API_KEY to connect a real business."],
    });
  }

  let accountId: string | undefined;
  let title: string | undefined;
  let raw: RawProduct[];
  const notes: string[] = [];
  const configuredCompany = companyId();
  try {
    const me = await whopGet<Record<string, unknown>>(
      configuredCompany ? `/companies/${encodeURIComponent(configuredCompany)}` : "/accounts/me",
      key,
    );
    accountId = str(me.id);
    title = str(me.title) ?? str(me.name) ?? str(me.username);
    raw = await listProducts(key, accountId);
  } catch (err) {
    // Scoped keys (e.g. no company:balance:read) can't read /accounts/me but can list products,
    // and each product carries its business ({ account: { id, title } }). Only a guess, so it's
    // labelled in notes; set WHOP_COMPANY_ID to pin the business.
    if (!(err instanceof WhopError) || err.status !== 403 || configuredCompany) throw err;
    raw = ((await whopGet<{ data?: unknown[] }>("/products?first=6", key)).data ?? []) as RawProduct[];
    accountId = str(raw[0]?.account?.id);
    title = str(raw[0]?.account?.title);
    raw = raw.filter((p) => !accountId || str(p.account?.id) === accountId);
    notes.push("Key is scoped and WHOP_COMPANY_ID isn't set: business read from the first visible product. Set WHOP_COMPANY_ID to pin it.");
  }
  if (pasted) secret.__darwinWhopKey = pasted;
  return kvSet<WhopConnection>(KEY, {
    mode: "live",
    accountId,
    // Never the raw business id: the title becomes the store agent's public name.
    title: title ?? "Whop business",
    // Whop doesn't always honour company_id for every key type: keep only this business's products.
    products: toProducts(raw.filter((p) => !accountId || !p.account?.id || str(p.account.id) === accountId)),
    connectedAt: now,
    notes,
  });
}

/**
 * A WHOP_API_KEY on the server counts as connected, without the merchant pasting it again in onboarding:
 * looks the business up once, so Settings says "Connected" and the store agent uses the business's name.
 * No-op without a server key or when a live connection is already stored. Throws what connectWhop throws.
 */
export async function connectServerWhop(): Promise<WhopConnection | undefined> {
  if (!serverKey()) return undefined;
  const existing = getWhopStatus().connection;
  // Older connections could be titled with the raw id: look the business up again.
  if (existing?.mode === "live" && existing.title !== existing.accountId) return existing;
  return connectWhop();
}

export function getWhopStatus(): WhopStatus {
  const connection = kvGet<WhopConnection | null>(KEY, () => null) ?? undefined;
  return { configured: !!serverKey(), connection };
}

export interface WhopShowcaseProduct {
  id: string;
  title: string;
  headline: string | null;
  image: string | null;
  href: string;
  priceLabel: string | null;
}

export interface WhopShowcase {
  title: string;
  storeUrl: string | null;
  products: WhopShowcaseProduct[];
}

const showcaseMem = globalThis as unknown as {
  __darwinWhopShowcase?: { at: number; key: string; value: WhopShowcase | null };
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function httpsUrl(v: unknown): string | null {
  const raw = str(v);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstImage(product: Record<string, unknown>): string | null {
  if (!Array.isArray(product.gallery_images)) return null;
  for (const item of product.gallery_images) {
    const image = asRecord(item);
    if (!image) continue;
    const type = str(image.content_type);
    if (type && !type.startsWith("image/")) continue;
    const url = httpsUrl(image.url);
    if (url) return url;
  }
  return null;
}

async function whopGetOptional<T>(path: string, key: string): Promise<T | null> {
  try {
    return await whopGet<T>(path, key);
  } catch {
    return null;
  }
}

/** Storefront catalog filter. Override with WHOP_COMPANY_ID; not a secret. */
const DEFAULT_WHOP_COMPANY_ID = "biz_2LT2agoxggS3Hr";

function showcaseCompanyId(): string {
  return process.env.WHOP_COMPANY_ID?.trim() || DEFAULT_WHOP_COMPANY_ID;
}

async function loadWhopShowcase(key: string): Promise<WhopShowcase | null> {
  const pinnedId = showcaseCompanyId();
  const me = await whopGetOptional<Record<string, unknown>>("/accounts/me", key);

  const productsJson =
    (await whopGetOptional<{ data?: unknown[] }>(`/products?company_id=${encodeURIComponent(pinnedId)}&first=8`, key)) ??
    (await whopGetOptional<{ data?: unknown[] }>(`/products?account_id=${encodeURIComponent(pinnedId)}&first=8`, key));
  if (!productsJson) return null;

  const plansJson =
    (await whopGetOptional<{ data?: unknown[] }>(`/plans?company_id=${encodeURIComponent(pinnedId)}&first=30`, key)) ??
    (await whopGetOptional<{ data?: unknown[] }>(`/plans?account_id=${encodeURIComponent(pinnedId)}&first=30`, key));

  const prices = new Map<string, string>();
  for (const item of plansJson?.data ?? []) {
    const plan = asRecord(item);
    if (!plan || str(plan.visibility) === "hidden" || str(plan.visibility) === "archived") continue;
    const productId = str(asRecord(plan.product)?.id);
    const label = str(plan.formatted_price);
    if (productId && label && !prices.has(productId)) prices.set(productId, label);
  }

  let companyTitle: string | undefined;
  let companyRoute: string | undefined;
  if (me && str(me.id) === pinnedId) {
    companyTitle = str(me.title) ?? str(me.name) ?? str(me.username);
    companyRoute = str(me.route);
  }

  const products: WhopShowcaseProduct[] = [];
  for (const item of productsJson.data ?? []) {
    const product = asRecord(item);
    if (!product) continue;
    const id = str(product.id);
    const title = str(product.title) ?? str(product.name);
    const visibility = str(product.visibility);
    if (!id || !title || visibility === "hidden" || visibility === "archived") continue;
    // Whop ignores company_id/account_id for some keys and returns other businesses' marketplace
    // products (seen live: "Forex Trading Cheat Code" on the running-shoe store). Only show ours.
    const owner = str(asRecord(product.account)?.id) ?? str(asRecord(product.company)?.id);
    if (owner && owner !== pinnedId) continue;
    const company = asRecord(product.company);
    companyTitle = companyTitle ?? str(company?.title);
    companyRoute = companyRoute ?? str(company?.route);
    const route = str(product.route);
    const href = httpsUrl(
      companyRoute && route
        ? `https://whop.com/${companyRoute}/${route}`
        : route
          ? `https://whop.com/${route}`
          : undefined,
    );
    if (!href) continue;
    products.push({
      id,
      title,
      headline: str(product.headline) ?? null,
      image: firstImage(product),
      href,
      priceLabel: prices.get(id) ?? null,
    });
  }

  return {
    title: companyTitle ?? "Store",
    storeUrl: companyRoute ? httpsUrl(`https://whop.com/${companyRoute}`) : null,
    products,
  };
}

/** Live Whop catalog for the storefront. Null when no key, or Whop doesn't answer. */
export async function getWhopShowcase(): Promise<WhopShowcase | null> {
  const key = whopKey();
  if (!key) return null;
  const pinnedId = showcaseCompanyId();
  const cacheKey = `${key}:${pinnedId}`;
  const hit = showcaseMem.__darwinWhopShowcase;
  if (hit && hit.key === cacheKey && Date.now() - hit.at < 60_000) return hit.value;
  const value = await loadWhopShowcase(key);
  showcaseMem.__darwinWhopShowcase = { at: Date.now(), key: cacheKey, value };
  return value;
}

export function whopErrorStatus(err: unknown): { status: number; error: string } {
  if (err instanceof WhopError) return { status: err.status, error: err.message };
  const e = err as Error;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { status: 504, error: "Whop didn't answer in time." };
  return { status: 502, error: e?.message || "Couldn't reach Whop." };
}
