"use client";

/**
 * The Human | Agent switch. <ModeSwitch> sits inside the Ask Darwin bar (components/console/assistant-panel.tsx) on
 * the console pages that have an agent view; <ModeToggle> is the older floating bottom-left version, no longer mounted.
 * Phones don't show it (the agent view carries its own "back to human" button).
 */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { setViewMode, useViewMode, type ViewMode } from "./mode";

const TOAST_GAP = 10;

/** How far to lift so the toggle clears the provider's bottom-left toast stack (fixed bottom-6 left-6). */
function useToastLift(ref: React.RefObject<HTMLElement | null>): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const stack = document.querySelector<HTMLElement>("div.fixed.bottom-6.left-6");
    const el = ref.current;
    if (!stack || !el) return;
    const measure = () => {
      if (!stack.childElementCount) return setLift(0);
      const toastTop = stack.getBoundingClientRect().top;
      const base = parseFloat(getComputedStyle(el).bottom) || 0;
      const selfBottomAtRest = window.innerHeight - base;
      setLift(Math.max(0, selfBottomAtRest - toastTop + TOAST_GAP));
    };
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(stack, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(measure);
    ro.observe(stack);
    window.addEventListener("resize", measure);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return lift;
}

function HumanGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M2.8 14c.6-2.9 2.7-4.4 5.2-4.4s4.6 1.5 5.2 4.4" />
    </svg>
  );
}

function AgentGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 3.5 2 8l3.5 4.5M10.5 3.5 14 8l-3.5 4.5" />
    </svg>
  );
}

const OPTIONS: { mode: ViewMode; label: string; hint: string; Glyph: () => React.JSX.Element }[] = [
  { mode: "human", label: "Human", hint: "The page as designed", Glyph: HumanGlyph },
  { mode: "agent", label: "Agent", hint: "The same page, machine-readable, with the commands an agent can call", Glyph: AgentGlyph },
];

export function ModeToggle() {
  const mode = useViewMode();
  const ref = useRef<HTMLDivElement>(null);
  const lift = useToastLift(ref);
  const reduce = useReducedMotion();

  return (
    <div
      ref={ref}
      data-agent-toggle={mode}
      role="radiogroup"
      aria-label="View this page as"
      style={{ transform: lift ? `translateY(-${lift}px)` : undefined }}
      className="fixed bottom-[118px] left-6 z-[45] flex h-10 items-center gap-0.5 rounded-full bg-dw-surface p-1 ring-1 ring-dw-hairline transition-transform duration-200 ease-out max-sm:hidden min-[1220px]:bottom-[34px]"
    >
      <span aria-hidden className="px-2 font-dwmono text-[10px] tracking-[0.12em] text-dw-muted uppercase">
        view
      </span>
      {OPTIONS.map(({ mode: m, label, hint, Glyph }) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            title={hint}
            data-mode={m}
            onClick={() => setViewMode(m)}
            className={`relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink ${
              on ? "text-white" : "text-dw-ink hover:bg-dw-sand"
            } ${m === "agent" ? "font-dwmono tracking-tight" : "font-dw font-medium"}`}
          >
            {on && (
              <motion.span
                layoutId="dw-mode-pill"
                aria-hidden
                className="absolute inset-0 rounded-full bg-dw-ink"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Glyph />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pages wrapped in <AgentModeGate> (the DarwinShell pages): only there does the switch change anything. */
export function hasAgentView(pathname: string | null): boolean {
  if (!pathname?.startsWith("/console")) return false;
  return !/^\/console\/(research|classic)(\/|$)/.test(pathname);
}

/** The switch as it sits inside the dark Ask Darwin bar: cream on ink, icon only below 1280px. */
export function ModeSwitch({ className = "" }: { className?: string }) {
  const mode = useViewMode();
  const reduce = useReducedMotion();
  return (
    <div
      data-agent-toggle={mode}
      role="radiogroup"
      aria-label="View this page as"
      className={`flex h-9 shrink-0 items-center gap-0.5 rounded-full p-[3px] ${className}`}
      style={{ background: "rgba(247,241,229,0.10)" }}
    >
      {OPTIONS.map(({ mode: m, label, hint, Glyph }) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={hint}
            data-mode={m}
            onClick={() => setViewMode(m)}
            className={`relative flex h-[30px] items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F7F1E5] ${
              on ? "text-dw-ink" : "text-[#F7F1E5]/70 hover:text-[#F7F1E5]"
            } ${m === "agent" ? "font-dwmono tracking-tight" : "font-medium"}`}
          >
            {on && (
              <motion.span
                layoutId="dw-mode-pill-bar"
                aria-hidden
                className="absolute inset-0 rounded-full bg-[#F7F1E5]"
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Glyph />
              <span className="max-xl:sr-only">{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
