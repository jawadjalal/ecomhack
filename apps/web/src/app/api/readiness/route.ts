import { z } from "zod";
import type { ReadinessReport } from "@/lib/contracts";
import { auditStore, BlockedUrlError, clientKey, normaliseStoreUrl, takeToken } from "@/lib/readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const Body = z.object({ url: z.string().min(1).max(500) });

const CACHE_MS = 10 * 60_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 20;

const g = globalThis as unknown as {
  __darwinReadinessCache?: Map<string, { at: number; report: ReadinessReport }>;
};
const cache = () => (g.__darwinReadinessCache ??= new Map());

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

  const c = cache();
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const cached = c.get(url);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return Response.json(cached.report);

  if (!takeToken("audit", clientKey(req), MAX_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ error: "Too many checks from this address. Try again in a few minutes." }, { status: 429 });
  }

  try {
    const report = await auditStore(url);
    c.set(url, { at: Date.now(), report });
    if (c.size > 500) c.delete(c.keys().next().value!);
    return Response.json(report);
  } catch (e) {
    if (e instanceof BlockedUrlError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[readiness] audit failed", e);
    return Response.json({ error: "The audit failed. Try again." }, { status: 500 });
  }
}
