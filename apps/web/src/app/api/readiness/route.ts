import { z } from "zod";
import type { ReadinessReport } from "@/lib/contracts";
import { auditStore, BlockedUrlError, normaliseStoreUrl } from "@/lib/readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ url: z.string().min(1).max(500) });

const CACHE_MS = 10 * 60_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 20;

const g = globalThis as unknown as {
  __darwinReadiness?: { cache: Map<string, { at: number; report: ReadinessReport }>; hits: Map<string, number[]> };
};
const state = () => (g.__darwinReadiness ??= { cache: new Map(), hits: new Map() });

function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** POST /api/readiness { url } → ReadinessReport. `?fresh=1` skips the 10-minute cache. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Send { url }." }, { status: 400 });

  let url: string;
  try {
    url = normaliseStoreUrl(parsed.data.url);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const s = state();
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const cached = s.cache.get(url);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return Response.json(cached.report);

  const key = clientKey(req);
  const now = Date.now();
  const recent = (s.hits.get(key) ?? []).filter((t: number) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    return Response.json({ error: "Too many checks from this address. Try again in a few minutes." }, { status: 429 });
  }
  s.hits.set(key, [...recent, now]);
  if (s.hits.size > 5000) s.hits.delete(s.hits.keys().next().value!);

  try {
    const report = await auditStore(url);
    s.cache.set(url, { at: Date.now(), report });
    if (s.cache.size > 500) s.cache.delete(s.cache.keys().next().value!);
    return Response.json(report);
  } catch (e) {
    if (e instanceof BlockedUrlError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[readiness] audit failed", e);
    return Response.json({ error: "The audit failed. Try again." }, { status: 500 });
  }
}
