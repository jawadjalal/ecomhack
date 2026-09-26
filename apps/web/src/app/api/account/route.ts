import { NextResponse } from "next/server";
import { z } from "zod";
import { ACCOUNT_COOKIE, AccountSiteSchema, accountCookieOptions, accountFrom, EmailSchema, initialsFor, sealAccount, withSite } from "@/lib/auth/account";
import { publicOrigin, requestOrigin } from "@/lib/github";

export const dynamic = "force-dynamic";

const Body = z.object({ email: EmailSchema, site: AccountSiteSchema.optional() });

/**
 * POST /api/account { email, site? } → { email, initials, resumeUrl }
 * Saves the merchant's email and their store (site id) in the sealed, httpOnly darwin_account cookie, and
 * returns a 30-day resume link that restores it on any browser. Nothing is emailed (no provider configured).
 */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 4000) return Response.json({ error: "Body too large" }, { status: 413 });
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "Body must be JSON: { email, site? }" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.path[0] === "site" ? "site must be a darwin.js site id" : "That doesn't look like an email address" }, { status: 400 });
  const { email, site } = parsed.data;
  const prior = accountFrom(req);
  const account = { email, sites: withSite(prior?.email === email ? prior.sites : [], site) };
  const token = sealAccount(account);
  const res = NextResponse.json({
    email,
    initials: initialsFor(email),
    resumeUrl: `${publicOrigin(req)}/api/account/resume?token=${encodeURIComponent(token)}`,
  });
  res.cookies.set(ACCOUNT_COOKIE, token, accountCookieOptions(requestOrigin(req).startsWith("https:")));
  return res;
}

/** GET /api/account → { email?, initials?, sites }: who's here (for the avatar), from the cookie. */
export function GET(req: Request) {
  const account = accountFrom(req);
  return Response.json(account ? { email: account.email, initials: initialsFor(account.email), sites: account.sites } : { sites: [] }, { headers: { "cache-control": "no-store" } });
}
