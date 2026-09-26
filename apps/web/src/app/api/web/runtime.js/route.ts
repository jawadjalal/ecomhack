import { buildRuntime, listRules, SiteSchema } from "@/lib/web";

export const dynamic = "force-dynamic";

const JS_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GET /api/web/runtime.js?site=… — the personalization runtime with the site's live rules inlined.
 * Public: darwin.js loads it on merchant storefronts. Rule changes reach browsers within ~15 s
 * (short cache); append any `&v=` to bust it. `&darwin_preview=<rule id>` adds a draft for previews.
 */
export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const parsed = SiteSchema.safeParse(params.get("site") ?? "");
  if (!parsed.success) {
    return new Response("/* Darwin: ?site= must be the data-darwin-site of your darwin.js tag */\n", { status: 400, headers: JS_HEADERS });
  }
  const preview = params.get("darwin_preview") ?? undefined;
  return new Response(buildRuntime(parsed.data, listRules(parsed.data), preview), {
    headers: { ...JS_HEADERS, "Cache-Control": preview ? "no-store" : "public, max-age=15, stale-while-revalidate=60" },
  });
}
