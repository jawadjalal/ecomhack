import { TRACKER_JS } from "@/lib/github/tracker";

/** GET /darwin.js — the analytics tag Darwin's install PR adds to a merchant storefront. */
export function GET() {
  return new Response(TRACKER_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short cache so tracker fixes roll out within minutes; SWR keeps it fast.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
