/**
 * A merchant account without a database: the email and the stores they set up, sealed (AES-256-GCM, see
 * oauth.ts seal/unseal) into the httpOnly darwin_account cookie, so it works on any server instance.
 *
 * The same sealed payload is the resume link (/api/account/resume?token=…): open it on another browser or
 * device to get the account back. Both last 30 days. No email is sent: there's no email provider configured,
 * so the merchant copies the link themselves.
 *
 * Needs DARWIN_SESSION_SECRET (or DARWIN_ADMIN_TOKEN) in production, else each instance has its own key.
 */
import { z } from "zod";
import { seal, unseal } from "./oauth";

export const ACCOUNT_COOKIE = "darwin_account";
export const ACCOUNT_DAYS = 30;
const MAX_SITES = 20;

const EMAIL_HINT = "That doesn't look like an email address";
export const EmailSchema = z.string(EMAIL_HINT).trim().toLowerCase().max(254, EMAIL_HINT).pipe(z.email(EMAIL_HINT));
export const AccountSiteSchema = z.string().regex(/^[\w.-]{1,64}$/);

export interface Account {
  email: string;
  sites: string[];
}

const Stored = z.object({
  v: z.literal(1),
  email: EmailSchema,
  sites: z.array(AccountSiteSchema).max(MAX_SITES),
  iat: z.number(),
});

/** "jawad.jalal@x.com" → "JJ", "sam@x.com" → "S". */
export function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._+\-\d]+/).filter(Boolean);
  const letters = (parts.length > 1 ? [parts[0][0], parts[1][0]] : [parts[0]?.[0] ?? local[0] ?? "?"]).join("");
  return letters.toUpperCase();
}

/** Add a site (most recent first), keeping at most 20. */
export function withSite(sites: string[], site?: string): string[] {
  if (!site) return sites.slice(0, MAX_SITES);
  return [site, ...sites.filter((s) => s !== site)].slice(0, MAX_SITES);
}

export function sealAccount(account: Account, now = Date.now()): string {
  return seal(JSON.stringify({ v: 1, email: account.email, sites: account.sites.slice(0, MAX_SITES), iat: now }));
}

/** The account in a sealed token (cookie or resume link), if it's ours, well-formed and under 30 days old. */
export function unsealAccount(token: string | null | undefined, now = Date.now()): Account | undefined {
  if (!token || token.length > 4000) return undefined;
  const plain = unseal(token);
  if (!plain) return undefined;
  try {
    const s = Stored.parse(JSON.parse(plain));
    if (now - s.iat > ACCOUNT_DAYS * 86_400_000 || s.iat - now > 60_000) return undefined;
    return { email: s.email, sites: s.sites };
  } catch {
    return undefined;
  }
}

export function accountFrom(req: Request): Account | undefined {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${ACCOUNT_COOKIE}=([^;]+)`));
  if (!m) return undefined;
  try {
    return unsealAccount(decodeURIComponent(m[1]));
  } catch {
    return undefined;
  }
}

export const accountCookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: ACCOUNT_DAYS * 86_400 });
