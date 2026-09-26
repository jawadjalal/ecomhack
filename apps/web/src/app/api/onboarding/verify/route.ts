import { eventStore } from "@/lib/analytics/store";
import { safeFetch } from "@/lib/readiness/fetcher";
import { storeUrl, verifyOwnership } from "@/lib/tracking/verify";

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding/verify?site=<slug>&url=<store url> → { verified, via?, host, checkedAt, detail }
 * Proof the merchant controls the store before onboarding goes live: a real darwin.js event for the site from
 * that host, or the darwin.js tag for the site on its homepage (fetched SSRF-safe). Cached ~10 s.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const site = q.get("site") ?? "";
  if (!/^[\w.-]{1,64}$/.test(site)) return Response.json({ error: "?site= is required (the darwin.js site id)" }, { status: 400 });
  const url = storeUrl(q.get("url") ?? "");
  if (!url) return Response.json({ error: "?url= must be your store's address, like https://shop.example.com" }, { status: 400 });
  const result = await verifyOwnership(site, url, {
    events: () => eventStore().all(),
    fetchPage: (u) => safeFetch(u, { timeoutMs: 6000 }),
  });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
