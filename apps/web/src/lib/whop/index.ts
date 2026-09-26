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
    const q = accountId ? `company_id=${encodeURIComponent(accountId)}&first=6` : "first=6";
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
    title: title ?? accountId ?? "Whop business",
    // Whop doesn't always honour company_id for every key type: keep only this business's products.
    products: toProducts(raw.filter((p) => !accountId || !p.account?.id || str(p.account.id) === accountId)),
    connectedAt: now,
    notes,
  });
}

export function getWhopStatus(): WhopStatus {
  const connection = kvGet<WhopConnection | null>(KEY, () => null) ?? undefined;
  return { configured: !!serverKey(), connection };
}

export function whopErrorStatus(err: unknown): { status: number; error: string } {
  if (err instanceof WhopError) return { status: err.status, error: err.message };
  const e = err as Error;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { status: 504, error: "Whop didn't answer in time." };
  return { status: 502, error: e?.message || "Couldn't reach Whop." };
}
