"use client";

import type { ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { AudienceCard } from "../settings/audience-card";
import { AutonomyCard } from "../settings/autonomy-card";
import { AutopilotCard } from "../settings/autopilot-card";
import { GrokCard } from "../settings/grok-card";
import { DemoCard, ResetCard } from "../settings/reset-card";
import { StoreCard } from "../settings/store-card";
import { PageHead } from "../ui";

/**
 * Settings (opened from the avatar): how much Darwin may do on its own, what it's plugged into,
 * who each test is judged on, where it reports back, and the way back to Gen 0.
 * Card rows alternate 1.7fr/1fr and 1fr/1.7fr (never equal boxes).
 */
export function SettingsScreen() {
  return (
    <MotionConfig reducedMotion="user">
      <PageHead title="Settings" lede="How much Darwin may do on its own, and where it reports back." />

      <Rise i={0}>
        <AutonomyCard />
      </Rise>

      <div className="grid items-stretch gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Rise i={1}>
          <AutopilotCard className="h-full" />
        </Rise>
        <Rise i={1}>
          <StoreCard className="h-full" />
        </Rise>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_1.7fr]">
        <Rise i={2}>
          <AudienceCard className="h-full" />
        </Rise>
        <Rise i={3}>
          <GrokCard className="h-full" />
        </Rise>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Rise i={4}>
          <ResetCard className="h-full" />
        </Rise>
        <Rise i={5}>
          <DemoCard className="h-full" />
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
      transition={{ delay: 0.04 + i * 0.06, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
