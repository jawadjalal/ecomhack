/**
 * Footer newsletter sign-up. Pure. The email address itself is never recorded: the `newsletter_signup`
 * event carries only where the form was (`placement`), and the store keeps a "signed up" flag in this
 * browser so the form shows its thank-you state on the next visit.
 */
import type { EventProperties } from "@/lib/contracts";

export const NEWSLETTER_FLAG_KEY = "pace_newsletter_v1";

/** A plausible address: something@domain.tld, no spaces, at most 254 characters. */
export function isValidEmail(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  return s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(s);
}

/** Properties for the `newsletter_signup` event: no email, hashed or otherwise. */
export function newsletterSignupProps(placement: string): EventProperties {
  return { placement };
}
