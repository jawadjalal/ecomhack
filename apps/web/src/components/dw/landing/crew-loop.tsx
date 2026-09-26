/**
 * The landing page loop: the five-mascot crew on an orbit (observe → diagnose → propose → experiment →
 * ship). The ring turns slowly, each crew member bobs, and the spotlight passes round the loop. The
 * storefront in the middle gains one improvement every time the loop reaches "ship". No data: it is an
 * illustration of how Darwin works, not a report. Hover or focus a crew member to hold on that step.
 */
"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";

const STEPS: { kind: MascotKind; verb: string; line: string }[] = [
  { kind: "observer", verb: "Observe", line: "Watches how people and AI shoppers move through your store." },
  { kind: "analyst", verb: "Diagnose", line: "Finds where they drop off, and why." },
  { kind: "designer", verb: "Propose", line: "Drafts a small, reversible change to the page or the agent API." },
  { kind: "experimenter", verb: "Experiment", line: "A/B tests it on live traffic until the answer is clear." },
  { kind: "shipper", verb: "Ship", line: "Opens a pull request with the winner. Then it starts again." },
];

/** What the illustrated store picks up, one per trip round the loop. */
const GAINS = ["Delivery date on the page", "Shipping shown in the bag", "Stock shared with agents"];

const R = 38; // ring radius, % of the box
const at = (i: number) => {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) };
};
const arc = (i: number) => {
  const a = at((i + 4) % 5);
  const b = at(i);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

export function CrewLoop({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [held, setHeld] = useState<number>();
  useEffect(() => {
    if (reduce || held !== undefined) return;
    const t = setInterval(() => setTick((x) => x + 1), 2600);
    return () => clearInterval(t);
  }, [reduce, held]);

  const active = held ?? tick % 5;
  // one improvement per completed loop; the mock resets after all three
  const gained = Math.floor(tick / 5) % (GAINS.length + 1);
  const step = STEPS[active];

  return (
    <div className={cn("relative mx-auto flex w-full max-w-[560px] flex-col items-center", className)}>
      <div className="relative aspect-square w-full">
        {/* soft glow behind the ring */}
        <div className="pointer-events-none absolute inset-[14%] rounded-full bg-[radial-gradient(circle,rgba(213,204,245,0.75),rgba(247,241,229,0)_70%)]" aria-hidden />

        <motion.div
          className="absolute inset-0"
          animate={reduce ? undefined : { rotate: 360 }}
          transition={reduce ? undefined : { duration: 140, ease: "linear", repeat: Infinity }}
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <circle cx="50" cy="50" r={R} fill="none" stroke="#141413" strokeOpacity="0.16" strokeWidth="0.45" strokeDasharray="1.2 1.6" />
            <motion.path
              key={active}
              d={arc(active)}
              fill="none"
              stroke="#141413"
              strokeWidth="0.9"
              strokeLinecap="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </svg>

          {STEPS.map((s, i) => {
            const p = at(i);
            const on = i === active;
            return (
              <div key={s.kind} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                <motion.div
                  animate={reduce ? undefined : { rotate: -360 }}
                  transition={reduce ? undefined : { duration: 140, ease: "linear", repeat: Infinity }}
                >
                  <motion.div
                    animate={reduce ? undefined : { y: [0, -7, 0] }}
                    transition={reduce ? undefined : { duration: 3 + i * 0.25, delay: i * 0.35, ease: "easeInOut", repeat: Infinity }}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${s.verb}: ${s.line}`}
                      onMouseEnter={() => setHeld(i)}
                      onMouseLeave={() => setHeld(undefined)}
                      onFocus={() => setHeld(i)}
                      onBlur={() => setHeld(undefined)}
                      onClick={() => setHeld(i)}
                      className="group flex flex-col items-center gap-2 rounded-[28px] p-1 outline-none focus-visible:ring-2 focus-visible:ring-dw-ink"
                    >
                      <motion.span
                        className="block"
                        animate={{ scale: on ? 1.14 : 1 }}
                        transition={{ type: "spring", stiffness: 320, damping: 20 }}
                      >
                        <span className="block max-sm:-m-[11px] max-sm:scale-[0.72]">
                          <Mascot kind={s.kind} size={78} frame active={on} />
                        </span>
                      </motion.span>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap transition-colors duration-300",
                          on ? "bg-dw-ink text-white" : "bg-white/80 text-dw-ink/70 group-hover:text-dw-ink",
                        )}
                      >
                        {s.verb}
                      </span>
                    </button>
                  </motion.div>
                </motion.div>
              </div>
            );
          })}
        </motion.div>

        {/* the storefront in the middle, getting better each lap */}
        <div className="absolute top-1/2 left-1/2 w-[40%] -translate-x-1/2 -translate-y-1/2">
          <div className="overflow-hidden rounded-[18px] border border-dw-ink/10 bg-white shadow-[0_24px_50px_-24px_rgba(20,20,19,0.45)]">
            <div className="flex items-center gap-1 border-b border-dw-hairline bg-[#FBF7EE] px-2.5 py-1.5" aria-hidden>
              <span className="size-1.5 rounded-full bg-[#F0A59A]" />
              <span className="size-1.5 rounded-full bg-[#F2D27A]" />
              <span className="size-1.5 rounded-full bg-[#9FD3A8]" />
              <span className="ml-1.5 h-2 flex-1 rounded-full bg-dw-sand" />
            </div>
            <div className="flex flex-col gap-1.5 p-2.5 sm:p-3">
              <span className="text-[11px] leading-none font-semibold sm:text-[13px]">Your store</span>
              <span className="h-1.5 w-4/5 rounded-full bg-dw-sand" aria-hidden />
              <span className="h-1.5 w-3/5 rounded-full bg-dw-sand" aria-hidden />
              <ul className="flex min-h-[3.25rem] flex-col gap-1 max-sm:hidden" aria-label="Improvements shipped in this illustration">
                <AnimatePresence initial={false}>
                  {GAINS.slice(0, gained).map((g) => (
                    <motion.li
                      key={g}
                      layout
                      initial={{ opacity: 0, scale: 0.8, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 380, damping: 22 }}
                      className="flex items-center gap-1 rounded-full bg-dw-win-bg px-1.5 py-0.5 text-[10.5px] font-medium text-dw-win"
                    >
                      <Check className="size-2.5 shrink-0" aria-hidden />
                      <span className="truncate">{g}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              <span className="mt-0.5 h-5 rounded-full bg-dw-ink sm:h-6" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      {/* caption for the step in the spotlight */}
      <div className="relative -mt-2 h-[4.5rem] w-full max-w-[26rem]" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step.kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex items-center gap-3 rounded-full bg-white/80 py-2 pr-6 pl-2 shadow-[0_10px_30px_-18px_rgba(20,20,19,0.4)]"
          >
            <Mascot kind={step.kind} size={48} frame active={false} />
            <p className="min-w-0 text-[14px] leading-snug text-dw-ink/75">
              <span className="font-semibold text-dw-ink">{step.verb}. </span>
              {step.line}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
