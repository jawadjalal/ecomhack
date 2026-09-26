import { NextResponse } from "next/server";
import { PREVIEW_COOKIE, PRESETS } from "@/lib/spec";

/**
 * GET /preview?config=fixed → view the site with presets/fixed.json (a cookie, this browser only).
 * GET /preview?config=off   → back to storefront.config.json.
 * For the before/after demo without merging a PR. The real fix is Darwin's PR editing storefront.config.json.
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const config = url.searchParams.get("config") ?? "off";
  const back = url.searchParams.get("to")?.startsWith("/") ? url.searchParams.get("to")! : "/";
  const res = NextResponse.redirect(new URL(back, url));
  if ((PRESETS as readonly string[]).includes(config)) res.cookies.set(PREVIEW_COOKIE, config, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 8 });
  else res.cookies.delete(PREVIEW_COOKIE);
  return res;
}
