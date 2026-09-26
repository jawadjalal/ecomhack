import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE, accountCookieOptions, sealAccount, unsealAccount } from "@/lib/auth/account";
import { requestOrigin } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/resume?token=… — the link from POST /api/account. Restores the darwin_account cookie on this
 * browser and opens the merchant's first store's dashboards (or onboarding when they have none). An expired or
 * tampered token just opens onboarding.
 */
export function GET(req: Request) {
  const origin = requestOrigin(req);
  const account = unsealAccount(new URL(req.url).searchParams.get("token"));
  if (!account) return NextResponse.redirect(`${origin}/onboarding?resume=expired`);
  const first = account.sites[0];
  const res = NextResponse.redirect(first ? `${origin}/console/dashboards?site=${encodeURIComponent(first)}` : `${origin}/onboarding`);
  // A fresh seal, so the cookie's 30 days start now.
  res.cookies.set(ACCOUNT_COOKIE, sealAccount(account), accountCookieOptions(origin.startsWith("https:")));
  return res;
}
