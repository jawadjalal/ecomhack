import { safeFetch } from "@/lib/readiness/fetcher";
import { inspectStore } from "@/lib/tracking/inspect";
import { storeUrl } from "@/lib/tracking/verify";

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding/inspect?url=<store url> → { host, reachable, platform, signals, title? }
 * platform: shopify | webflow | wordpress | squarespace | wix | bigcommerce | custom | unknown, from the
 * homepage (fetched SSRF-safe), with the evidence in `signals`. Cached per host for 10 minutes.
 */
export async function GET(req: Request) {
  const url = storeUrl(new URL(req.url).searchParams.get("url") ?? "");
  if (!url) return Response.json({ error: "?url= must be your store's address, like https://shop.example.com" }, { status: 400 });
  const result = await inspectStore(url, { fetchPage: (u) => safeFetch(u, { timeoutMs: 6000 }) });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
