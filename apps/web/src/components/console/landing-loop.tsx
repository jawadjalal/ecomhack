"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { LoopPhase } from "@/lib/contracts";
import { PHASES } from "@/lib/console/format";
import { LoopRing } from "./loop-ring";

type Phase = Exclude<LoopPhase, "idle">;

const CAPTIONS: Record<Phase, { who: string; text: string; tone: string }> = {
  observe: { who: "Observer", text: "Watching 1,204 humans and 318 AI agents shop PACE", tone: "text-[#9cc5ff]" },
  diagnose: { who: "Analyst", text: "62% of checkouts die when shipping appears. 41% of agents quit: no delivery ETA", tone: "text-[#ffd27a]" },
  propose: { who: "Designer", text: "cart.showShippingUpfront: false → true · agentSurface.exposeDeliveryEta: false → true", tone: "text-[#f5a6cb]" },
  experiment: { who: "Experimenter", text: "A/B test on live traffic: treatment 9.2% vs control 5.4%", tone: "text-brand" },
  decide: { who: "Experimenter", text: "P(treatment beats control) = 0.97 → SHIP", tone: "text-brand" },
  ship: { who: "Shipper", text: "Opened PR #12 “Darwin Gen 1: shipping upfront + agent ETAs”", tone: "text-[#7ee2a0]" },
};

/** Auto-cycling loop diagram for the landing page. */
export function LandingLoop() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setTick((x) => x + 1), 1900);
    return () => clearInterval(t);
  }, [reduce]);
  const phase = PHASES[tick % PHASES.length];
  // a new generation goes live every time the loop reaches "ship"
  const gen = Math.floor((tick + 1) / PHASES.length);
  const cap = CAPTIONS[phase];

  return (
    <div className="relative flex w-full flex-col items-center">
      <div className="pointer-events-none absolute top-[42%] left-1/2 size-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/[0.07] blur-3xl" />
      <LoopRing phase={phase} generation={gen} autopilot className="relative w-full max-w-[27rem]" />
      <div className="relative mt-4 h-[4.6rem] w-full max-w-[30rem]">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase + gen}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 backdrop-blur"
          >
            <div className="text-[0.7rem] font-semibold tracking-[0.16em] text-white/40 uppercase">{cap.who}</div>
            <div className={`mt-1 line-clamp-2 font-mono text-[0.8rem] leading-snug ${cap.tone}`}>{cap.text}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
