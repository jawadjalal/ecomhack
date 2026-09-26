import type { Metadata } from "next";
import Script from "next/script";
import { OnboardingApp } from "@/components/onboarding/onboarding-app";

export const metadata: Metadata = {
  title: "Darwin · Set up",
  description: "Tell Darwin about your store, connect GitHub (and Whop), and it plans what to record, installs it and builds your dashboards.",
};

/**
 * /onboarding — first-run setup: connect → plan (Darwin asks) → install PR → live dashboards.
 * Darwin runs on its own onboarding (site "darwin-onboarding"): every step is an event, so the same
 * dashboards, heatmap and A/B tests work on it.
 */
export default function OnboardingPage() {
  return (
    <>
      <Script src="/darwin.js" data-darwin-site="darwin-onboarding" strategy="afterInteractive" />
      <OnboardingApp />
    </>
  );
}
