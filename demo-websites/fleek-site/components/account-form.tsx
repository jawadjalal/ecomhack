"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { track } from "@/lib/track";

/** Demo account page: sign-up / log-in forms that store nothing but a local flag. */
export function AccountForm({ signup }: { signup: boolean }) {
  const [done, setDone] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    track(signup ? "sign_up" : "login", {});
    setDone(signup ? "Account created (demo). You can now check out." : "Logged in (demo).");
  };
  return (
    <div className="page" style={{ maxWidth: 520, padding: "40px 16px 80px" }}>
      <h1 className="page-title">{signup ? "Open a reseller account" : "Log in"}</h1>
      {done ? (
        <div className="notice notice-info">
          {done}{" "}
          <Link href="/bundles" style={{ textDecoration: "underline" }}>
            Browse bundles
          </Link>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          {signup && (
            <label className="field">
              Business or shop name
              <input name="business" required />
            </label>
          )}
          <label className="field">
            Email
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label className="field">
            Password
            <input type="password" name="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} />
          </label>
          <button type="submit" className="btn btn-accent  btn-block">
            {signup ? "Create account" : "Log in"}
          </button>
          <p className="muted" style={{ fontSize: 13 }}>
            {signup ? (
              <>
                Already have an account? <Link href="/account" style={{ textDecoration: "underline" }}>Log in</Link>
              </>
            ) : (
              <>
                New to Rackd? <Link href="/account?mode=signup" style={{ textDecoration: "underline" }}>Open an account</Link>
              </>
            )}
          </p>
        </form>
      )}
    </div>
  );
}
