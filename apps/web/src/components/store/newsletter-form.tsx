"use client";

import { Check } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { WELCOME_CODE } from "@/lib/storefront/coupons";
import { NEWSLETTER_FLAG_KEY, isValidEmail, newsletterSignupProps } from "@/lib/storefront/newsletter";
import { useTrack } from "./store-provider";

const noopSubscribe = () => () => {};

function readFlag(): boolean {
  try {
    return window.localStorage.getItem(NEWSLETTER_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Footer sign-up. Validates the address, records `newsletter_signup` WITHOUT the email (no raw or hashed
 * address ever reaches analytics), remembers "signed up" in this browser and hands over the welcome code.
 */
export function NewsletterForm() {
  const track = useTrack();
  const stored = useSyncExternalStore(noopSubscribe, readFlag, () => false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (done || stored) {
    return (
      <div className="mt-6 rounded-(--r-input) border border-white/15 bg-white/5 p-4 text-sm" role="status" data-darwin="newsletter-success">
        <p className="flex items-center gap-2 font-semibold text-white">
          <Check className="size-4 text-emerald-400" strokeWidth={3} aria-hidden /> You&apos;re signed up
        </p>
        <p className="mt-1.5 leading-relaxed text-white/60">
          This is a demo store, so we don&apos;t keep your address or send email. Your welcome code for 10% off at checkout:{" "}
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono font-semibold tracking-wide text-white">{WELCOME_CODE}</span>
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-6"
      aria-label="Newsletter"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!isValidEmail(email)) {
          setError("Enter a valid email address, like you@example.com.");
          return;
        }
        track("newsletter_signup", newsletterSignupProps("footer"));
        try {
          window.localStorage.setItem(NEWSLETTER_FLAG_KEY, "1");
        } catch {
          /* storage blocked: the thank-you state still shows for this visit */
        }
        setEmail("");
        setError(null);
        setDone(true);
      }}
    >
      <div className="flex gap-2">
        <label htmlFor="pace-newsletter" className="sr-only">
          Email address
        </label>
        <input
          id="pace-newsletter"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pace-newsletter-err" : undefined}
          placeholder="Email for early access"
          className="min-h-11 w-full min-w-0 rounded-(--r-input) border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none aria-invalid:border-[#f87171]"
        />
        <button type="submit" className="pace-btn pace-btn-dark-surface min-h-11 shrink-0 px-5 text-sm" data-darwin="newsletter-join">
          Join
        </button>
      </div>
      {error && (
        <p id="pace-newsletter-err" className="mt-2 text-xs font-medium text-[#fca5a5]">
          {error}
        </p>
      )}
    </form>
  );
}
