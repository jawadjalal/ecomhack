"use client";

import { useReducedMotion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { LiveDashboard, LiveStrip } from "@/components/dw/landing/mini-dashboard";
import { useLiveDemo } from "@/components/dw/landing/use-live-demo";

/**
 * The landing page's hero visual: the Darwin loop, live — a miniature Overview running on the
 * in-browser demo engine (simulated shoppers, labelled as such). One engine drives both layouts:
 * the tilted dashboard from 640px up, a swipeable strip of cards on phones.
 */
export function LandingLoop({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const demo = useLiveDemo({ slow: reduce });
  return (
    <>
      <LiveDashboard demo={demo} className={cn("max-sm:hidden", className)} />
      <LiveStrip demo={demo} className="sm:hidden" />
    </>
  );
}
