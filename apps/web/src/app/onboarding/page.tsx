import type { Metadata } from "next";
import { OnboardingApp } from "@/components/onboarding/onboarding-app";

export const metadata: Metadata = {
  title: "Darwin · Set up",
  description: "Connect Whop and GitHub, choose what Darwin collects, and pick your dashboards.",
};

/** /onboarding — first-run setup: connect → analytics install PR → dashboards → mission control. */
export default function OnboardingPage() {
  return <OnboardingApp />;
}
