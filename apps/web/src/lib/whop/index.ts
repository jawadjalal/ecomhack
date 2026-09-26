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
    const msg =
      res.status === 401 || res.status === 403
        ? "Whop rejected that API key. Create one under Developer → API keys on whop.com."
        : `Whop answered ${res.status}${detail ? `: ${detail}` : ""}`;
    throw new WhopError(msg, res.status === 401 || res.status === 403 ? 401 : 502);
  }
  return (await res.json()) as T;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Products are a nice-to-have for the onboarding summary: never fail the connection over them. */
async function listProducts(key: string, accountId: string): Promise<WhopProduct[]> {
  try {
    const j = await whopGet<{ data?: unknown[] }>(`/products?company_id=${encodeURIComponent(accountId)}&first=6`, key);
    return (j.data ?? [])
      .map((p) => p as Record<string, unknown>)
      .map((p) => ({ id: str(p.id) ?? "", title: str(p.title) ?? str(p.name) ?? "Untitled product" }))
      .filter((p) => p.id);
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

  const me = await whopGet<Record<string, unknown>>("/accounts/me", key);
  const accountId = str(me.id);
  if (pasted) secret.__darwinWhopKey = pasted;
  const products = accountId ? await listProducts(key, accountId) : [];
  return kvSet<WhopConnection>(KEY, {
    mode: "live",
    accountId,
    title: str(me.title) ?? str(me.name) ?? str(me.username) ?? accountId ?? "Whop business",
    products,
    connectedAt: now,
    notes: [],
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
