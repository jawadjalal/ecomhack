"use client";

import type { ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { AudienceCard } from "../settings/audience-card";
import { AutopilotCard } from "../settings/autopilot-card";
import { GrokCard } from "../settings/grok-card";
import { DemoCard, ResetCard } from "../settings/reset-card";
import { StoreCard } from "../settings/store-card";
import { PageHead } from "../ui";

/**
 * Settings (opened from the avatar): how much Darwin may do on its own, what it's plugged into,
 * who each test is judged on, where it reports back, and the way back to the original page.
 * One column of sections (#57), not a grid of equal boxes. Each control still lives in its card module.
 */
export function SettingsScreen() {
  return (
    <MotionConfig reducedMotion="user">
      <PageHead title="Settings" lede="How much the crew may do on its own, what Darwin is plugged into, and where Grok reports back." />

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <Rise i={0}>
          <AutopilotCard />
        </Rise>
        <Rise i={1}>
          <StoreCard />
        </Rise>
        <Rise i={2}>
          <AudienceCard />
        </Rise>
        <Rise i={3}>
          <GrokCard />
        </Rise>
        <Rise i={4}>
          <ResetCard />
        </Rise>
        <Rise i={5}>
          <DemoCard />
        </Rise>
      </div>
    </MotionConfig>
  );
}

function Rise({ i, children }: { i: number; children: ReactNode }) {
  return (
    <motion.div
      className="min-w-0"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.04 + i * 0.06,
        duration: 0.45,
        ease: [0.2, 0.8, 0.2, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
