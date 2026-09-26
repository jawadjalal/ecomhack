"use client";

import { motion, AnimatePresence } from "motion/react";
import { Eye, FlaskConical, Rocket, Scale, ScanSearch, WandSparkles, type LucideIcon } from "lucide-react";
import type { LoopPhase } from "@/lib/contracts";
import { PHASES, PHASE_META, phaseIndex } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";

export const PHASE_ICONS: Record<Exclude<LoopPhase, "idle">, LucideIcon> = {
  observe: Eye,
  diagnose: ScanSearch,
  propose: WandSparkles,
  experiment: FlaskConical,
  decide: Scale,
  ship: Rocket,
};

/** Round so server and browser trig agree to the digit (avoids hydration mismatches). */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const R = 35; // ring radius, % of box
const CIRC = r3(2 * Math.PI * R);

function nodePos(i: number) {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return { x: r3(50 + R * Math.cos(a)), y: r3(50 + R * Math.sin(a)) };
}

export function LoopRing({
  phase,
  generation,
  autopilot,
  pending,
  viewPhase,
  onSelectPhase,
  className,
  centerSlot,
}: {
  phase: LoopPhase;
  generation: number;
  autopilot?: boolean;
  /** A step is in flight (spinner on the next node). */
  pending?: boolean;
  /** Phase the stage panel is currently showing (if the user is peeking). */
  viewPhase?: LoopPhase;
  onSelectPhase?: (p: Exclude<LoopPhase, "idle">) => void;
  className?: string;
  centerSlot?: React.ReactNode;
}) {
  const idx = phaseIndex(phase);
  const progress = idx < 0 ? 0 : idx / PHASES.length;
  const nextIdx = (idx + 1) % PHASES.length;

  return (
    // sized in container units (cqw) so the ring scales cleanly from a phone to a projector
    <div className={cn("@container relative aspect-square w-full select-none", className)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b6f05a" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
          <radialGradient id="ring-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(182,240,90,0.10)" />
            <stop offset="60%" stopColor="rgba(182,240,90,0.02)" />
            <stop offset="100%" stopColor="rgba(182,240,90,0)" />
          </radialGradient>
          <filter id="ring-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>
        <circle cx="50" cy="50" r={R - 4} fill="url(#ring-core)" />
        {/* tick marks */}
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i * 5 * Math.PI) / 180;
          const r1 = R + 5.2;
          const r2 = R + (i % 6 === 0 ? 6.6 : 5.9);
          return (
            <line
              key={i}
              x1={r3(50 + r1 * Math.cos(a))}
              y1={r3(50 + r1 * Math.sin(a))}
              x2={r3(50 + r2 * Math.cos(a))}
              y2={r3(50 + r2 * Math.sin(a))}
              stroke="white"
              strokeOpacity={i % 6 === 0 ? 0.16 : 0.07}
              strokeWidth={0.25}
            />
          );
        })}
        <circle cx="50" cy="50" r={R} fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={0.6} />
        {/* progress arc (glow + crisp) */}
        <g transform="rotate(-90 50 50)">
          <motion.circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth={1.6}
            strokeLinecap="round"
            filter="url(#ring-glow)"
            strokeDasharray={CIRC}
            initial={false}
            animate={{ strokeDashoffset: CIRC * (1 - progress), opacity: idx < 0 ? 0 : 0.8 }}
            transition={{ type: "spring", stiffness: 60, damping: 18 }}
          />
          <motion.circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="url(#ring-grad)"
            strokeWidth={0.9}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            initial={false}
            animate={{ strokeDashoffset: CIRC * (1 - progress), opacity: idx < 0 ? 0 : 1 }}
            transition={{ type: "spring", stiffness: 60, damping: 18 }}
          />
        </g>
        {/* orbiting comet while autopilot runs */}
        {autopilot && (
          <g style={{ transformOrigin: "50px 50px", animation: "darwin-orbit 3.2s linear infinite" }}>
            <circle cx="50" cy={50 - R} r={1.1} fill="#e9ffc8" filter="url(#ring-glow)" />
            <circle cx="50" cy={50 - R} r={0.6} fill="#ffffff" />
          </g>
        )}
      </svg>

      {/* nodes */}
      {PHASES.map((p, i) => {
        const { x, y } = nodePos(i);
        const Icon = PHASE_ICONS[p];
        const state = idx < 0 ? "todo" : i < idx ? "done" : i === idx ? "current" : "todo";
        const isNext = pending && i === nextIdx && idx >= 0;
        const viewing = viewPhase === p && viewPhase !== phase;
        return (
          <button
            key={p}
            type="button"
            disabled={!onSelectPhase}
            onClick={() => onSelectPhase?.(p)}
            title={`${PHASE_META[p].label}: ${PHASE_META[p].blurb}`}
            className="group absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center outline-none disabled:cursor-default"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span
              className={cn(
                "relative flex size-[14.3cqw] items-center justify-center rounded-full border transition-colors duration-500",
                state === "current" && "border-brand bg-brand text-[#0b1200] shadow-[0_0_0_1.4cqw_rgba(182,240,90,0.12),0_0_10cqw_1.6cqw_rgba(182,240,90,0.45)]",
                state === "done" && "border-brand/45 bg-[#11160c] text-brand",
                state === "todo" && "border-white/12 bg-[#0c0f15] text-white/40 group-hover:border-white/25 group-hover:text-white/70",
                viewing && "ring-2 ring-white/60 ring-offset-2 ring-offset-[#07090d]",
              )}
            >
              {state === "current" && (
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-brand"
                  initial={{ scale: 1, opacity: 0.6 }}
                  animate={{ scale: 1.7, opacity: 0 }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              {isNext && (
                <motion.span
                  className="absolute -inset-[1.3cqw] rounded-full border-2 border-transparent border-t-brand/80"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                />
              )}
              <Icon className="size-[5.9cqw]" strokeWidth={state === "current" ? 2.2 : 1.8} />
            </span>
            <span
              className={cn(
                "absolute top-full rounded-[1cqw] bg-[#080a0f]/85 px-[1.3cqw] py-[0.25cqw] text-[2.85cqw] font-medium tracking-[0.12em] whitespace-nowrap uppercase transition-colors duration-500",
                state === "current" ? "mt-[3cqw]" : "mt-[1.6cqw]",
                state === "current" ? "text-brand" : state === "done" ? "text-white/60" : "text-white/35",
              )}
            >
              {PHASE_META[p].label}
            </span>
          </button>
        );
      })}

      {/* center */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {centerSlot ?? (
          <>
            <div className="text-[2.8cqw] font-medium tracking-[0.28em] text-white/40 uppercase">
              Generation
            </div>
            <div className="relative h-[22.5cqw] w-full">
              <AnimatePresence initial={false}>
                <motion.div
                  key={generation}
                  initial={{ y: "45%", opacity: 0, filter: "blur(8px)" }}
                  animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                  exit={{ y: "-45%", opacity: 0, filter: "blur(8px)" }}
                  transition={{ type: "spring", stiffness: 200, damping: 22 }}
                  className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-white to-white/70 bg-clip-text text-[22cqw] font-semibold tracking-[-0.04em] text-transparent tabular"
                  style={{ lineHeight: 1 }}
                >
                  {generation}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-[0.5cqw] flex items-center gap-[1.5cqw] text-[3.7cqw] font-medium">
              <span className={cn("size-[1.8cqw] rounded-full", idx < 0 ? "bg-white/30" : "bg-brand pulse-dot")} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={phase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="text-white/80"
                >
                  {PHASE_META[phase].verb}
                </motion.span>
              </AnimatePresence>
            </div>
            {autopilot && (
              <div className="mt-[1.6cqw] rounded-full border border-brand/30 bg-brand/10 px-[2cqw] py-[0.4cqw] text-[2.4cqw] font-semibold tracking-[0.16em] text-brand uppercase">
                Autopilot
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
