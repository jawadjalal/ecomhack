"use client";

import type { ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { AudienceCard } from "../settings/audience-card";
import { AutopilotCard } from "../settings/autopilot-card";
import { GrokCard } from "../settings/grok-card";
import { DemoCard, ResetCard } from "../settings/reset-card";
import { StoreCard } from "../settings/store-card";
import { PageHead, PlainSurface } from "../ui";

/**
 * Settings (opened from the avatar): how much Darwin may do on its own, what it's plugged into,
 * who each test is judged on, where it reports back, and the way back to Gen 0.
 * One column of sections. Each control still lives in its card module.
 */
export function SettingsScreen() {
  return (
    <MotionConfig reducedMotion="user">
      <PlainSurface>
        <PageHead title="Settings" lede="How much Darwin may do on its own, and where it reports back." />

        <div className="mx-auto mt-2 flex w-full max-w-[760px] flex-col divide-y divide-dw-ink/10">
          <Rise i={0}>
            <AutopilotCard className="py-8" />
          </Rise>
          <Rise i={1}>
            <StoreCard className="py-8" />
          </Rise>
          <Rise i={2}>
            <AudienceCard className="py-8" />
          </Rise>
          <Rise i={3}>
            <GrokCard className="py-8" />
          </Rise>
          <Rise i={4}>
            <ResetCard className="py-8" />
          </Rise>
          <Rise i={5}>
            <DemoCard className="py-8" />
          </Rise>
        </div>
      </PlainSurface>
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
