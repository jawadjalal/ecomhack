"use client";

import { LiveDashboard } from "@/components/dw/landing/mini-dashboard";

/**
 * The landing page's hero visual: the Darwin loop, live — a miniature Overview running on the
 * in-browser demo engine (simulated shoppers, labelled as such).
 */
export function LandingLoop({ className }: { className?: string }) {
  return <LiveDashboard className={className} embed />;
}
