"use client";

/**
 * Onboarding pieces in the cream Darwin design: stepper, chat bubbles, the crew working through steps,
 * check animations, the "which brain" chip and the stage backdrop. Used by components/onboarding.
 */
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, ListChecks, TriangleAlert } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { BrandGlyph, type BrandKey } from "@/components/dw/brand-logos";
import { Art, type ArtId } from "@/components/dw/art";

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ------------------------------------------------------------------ stepper */

export type Step = "connect" | "plan" | "install" | "live";
const STEPS: { id: Step; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "plan", label: "Plan" },
  { id: "install", label: "Install" },
  { id: "live", label: "Live" },
];

/** What screen 1 promises: short, and true for the timed path. */
export const SETUP_SUMMARY = "4 steps · about 2 minutes";

/**
 * The top-nav's black pill, as numbered setup steps. The cream pill slides to the current step.
 * `variant="bar"` (phones): four thin segments that fill up, with the step names under them.
 * With `onStep`, every step reached so far (up to `reached`) is a button: back without losing answers.
 */
export function Stepper({
  step,
  className,
  variant = "pill",
  reached,
  onStep,
}: {
  step: Step;
  className?: string;
  variant?: "pill" | "bar";
  reached?: Step;
  onStep?: (s: Step) => void;
}) {
  const idx = STEPS.findIndex((s) => s.id === step);
  const reachIdx = Math.max(idx, reached ? STEPS.findIndex((s) => s.id === reached) : idx);
  const canGo = (i: number) => !!onStep && i !== idx && i <= reachIdx;
  if (variant === "bar") {
    return (
      <ol aria-label="Setup steps" className={cn("grid w-full grid-cols-4 gap-1.5", className)}>
        {STEPS.map((s, i) => {
          const on = i === idx;
          const done = i < idx;
          return (
            <li key={s.id} className="relative flex min-w-0 flex-col gap-1.5" aria-current={on ? "step" : undefined}>
              {canGo(i) && (
                <button
                  type="button"
                  onClick={() => onStep?.(s.id)}
                  aria-label={`${i < idx ? "Back" : "Go"} to ${s.label}`}
                  className="absolute -inset-y-2 inset-x-0 z-10 rounded-md focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
                />
              )}
              <span className="relative block h-1 overflow-hidden rounded-full bg-dw-ink/10">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full bg-dw-ink"
                  initial={false}
                  animate={{ width: done || on ? "100%" : "0%" }}
                  transition={{ duration: 0.6, ease: EASE, delay: on ? 0.15 : 0 }}
                />
              </span>
              <span className={cn("flex items-center gap-1 truncate text-[12px] leading-none", on ? "font-semibold text-dw-ink" : done ? "font-medium text-dw-ink/60" : "text-dw-ink/40")}>
                {done && <Check className="size-3 shrink-0 text-dw-live" strokeWidth={3} aria-hidden />}
                {s.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }
  return (
    <ol
      aria-label="Setup steps"
      className={cn("flex h-[50px] items-center gap-0.5 rounded-full bg-dw-ink p-[5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_rgba(20,20,19,0.16)]", className)}
    >
      {STEPS.map((s, i) => {
        const on = i === idx;
        const done = i < idx;
        return (
          <li key={s.id} className="relative flex items-center" aria-current={on ? "step" : undefined}>
            {canGo(i) && (
              <button
                type="button"
                onClick={() => onStep?.(s.id)}
                aria-label={`${i < idx ? "Back" : "Go"} to ${s.label}`}
                title={`${i < idx ? "Back" : "Go"} to ${s.label}`}
                className="peer absolute inset-y-0 left-0 right-4 z-10 rounded-full focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              />
            )}
            <span
              className={cn(
                "relative flex h-10 items-center gap-2 rounded-full px-3 text-[14px] whitespace-nowrap transition-colors sm:px-3.5",
                on ? "font-semibold text-dw-ink" : done ? "font-medium text-white" : "font-medium text-[#CFCAC0]",
                canGo(i) && "peer-hover:bg-white/[0.1]",
              )}
            >
              {on && <motion.span layoutId="dwo-step" className="absolute inset-0 rounded-full bg-dw-bg" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <span
                className={cn(
                  "relative grid size-[18px] place-items-center rounded-full text-[11px] font-semibold",
                  on ? "bg-dw-ink text-dw-bg" : done ? "bg-dw-live text-white" : "bg-white/[0.12] text-[#CFCAC0]",
                )}
              >
                {done ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className="grid place-items-center">
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                ) : (
                  i + 1
                )}
              </span>
              <span className={cn("relative", !on && "max-sm:sr-only")}>{s.label}</span>
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="mx-0.5 size-3 shrink-0 text-[#5E5A52]" strokeWidth={2.2} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ checks */

/** A check that pops in and draws itself. `burst` adds a ring that ripples out once. */
export function CheckPop({ size = 20, tone = "ink", burst, delay = 0, className }: { size?: number; tone?: "ink" | "live"; burst?: boolean; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      {burst && !reduce && (
        <motion.span
          className={cn("absolute inset-0 rounded-full", tone === "ink" ? "bg-dw-ink/30" : "bg-dw-live/40")}
          initial={{ scale: 0.6, opacity: 0.9 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 0.7, delay: delay + 0.05, ease: "easeOut" }}
        />
      )}
      <motion.span
        className={cn("relative grid size-full place-items-center rounded-full text-white", tone === "ink" ? "bg-dw-ink" : "bg-dw-live")}
        initial={reduce ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 17, delay }}
      >
        <svg viewBox="0 0 16 16" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} fill="none">
          <motion.path
            d="M3.6 8.4l2.9 2.9 5.9-6.4"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{
              duration: 0.32,
              delay: delay + 0.12,
              ease: "easeOut",
            }}
          />
        </svg>
      </motion.span>
    </span>
  );
}

/** Which crew member does a step: observers read, designers plan, shippers open PRs. */
export function crewFor(step: string): MascotKind {
  if (/pull request|shipping|opening/i.test(step)) return "shipper";
  if (/plan|choos|adding|dashboard/i.test(step)) return "designer";
  return "observer";
}

/** A list of steps: done ones tick, the current one has its crew member bobbing, later ones wait. */
export function StepList({ steps, current, finished, className, reveal }: { steps: string[]; current: number; finished?: boolean; className?: string; reveal?: boolean }) {
  const shown = reveal ? steps.slice(0, current + 1) : steps;
  return (
    <ol className={cn("flex flex-col gap-2", className)} aria-live="polite">
      {shown.map((s, k) => {
        const done = finished || k < current;
        const now = !finished && k === current;
        return (
          <motion.li
            key={s}
            initial={reveal ? { opacity: 0, x: -6 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex min-h-7 items-center gap-2.5 text-[14.5px]"
          >
            <span className="grid size-7 shrink-0 place-items-center">
              {done ? (
                <CheckPop size={20} />
              ) : now ? (
                <Mascot kind={crewFor(s)} size={26} active />
              ) : (
                <span className="size-[18px] rounded-full border-[1.5px] border-dashed border-dw-ink/25" />
              )}
            </span>
            <span className={cn(done ? "text-dw-ink/60" : now ? "font-medium text-dw-ink" : "text-dw-ink/40")}>
              {s}
              {now && "…"}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ chat */

/** Darwin talking: the framed 3D analyst as the avatar, a white bubble. */
export function AgentBubble({ children, working, thinking, className }: { children: ReactNode; working?: boolean; thinking?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 max-sm:gap-2.5", className)}>
      <Mascot kind="leader" frame size={40} active={working ?? true} state={thinking ? "thinking" : undefined} title="Darwin" />
      <div className="min-w-0 flex-1 rounded-[22px] rounded-tl-[8px] border border-dw-hairline bg-dw-surface px-4 py-3 text-[15px] leading-relaxed text-dw-ink/85 shadow-[0_1px_0_rgba(20,20,19,0.03),0_12px_30px_-22px_rgba(20,20,19,0.35)] max-sm:border-0 max-sm:bg-dw-sand max-sm:shadow-none">
        {children}
      </div>
    </div>
  );
}

/** The merchant talking: a black bubble on the right, with optional answer chips. */
export function YouBubble({ text, chips }: { text?: string; chips?: string[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="ml-auto flex max-w-[85%] flex-col items-end"
    >
      <div className="rounded-[22px] rounded-br-[8px] bg-dw-ink px-4 py-3 text-[15px] leading-relaxed text-white">
        {text && <p className="whitespace-pre-line">{text}</p>}
        {!!chips?.length && (
          <div className={cn("flex flex-wrap gap-1.5", text && "mt-2.5")}>
            {chips.map((c) => (
              <span key={c} className="inline-flex h-6 items-center rounded-full bg-white/[0.14] px-2.5 text-[12.5px] font-medium text-white/90">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ brain */

export interface Brain {
  label: string;
  glyph?: BrandKey;
  model?: string;
}

/** GET /api/loop `designer`: "llm:<model>" → which provider Darwin thinks with; "heuristic" → built-in rules. */
export function brainOf(designer?: string): Brain | null {
  if (!designer) return null;
  if (!designer.startsWith("llm:")) return { label: "Built-in rules" };
  const model = designer.slice(4);
  const m = model.toLowerCase();
  if (/grok|xai/.test(m)) return { label: "Thinking with Grok", glyph: "grok", model };
  if (/claude|anthropic/.test(m)) return { label: "Thinking with Claude", glyph: "claude", model };
  if (/gpt|openai|(^|\/)o[1345]\b/.test(m)) return { label: "Thinking with OpenAI", glyph: "openai", model };
  if (m.includes("/")) return { label: "Thinking with OpenRouter", glyph: "openrouter", model };
  return { label: `Thinking with ${model}`, model };
}

export function BrainChip({ brain, className }: { brain: Brain | null; className?: string }) {
  if (!brain) return null;
  const short = brain.model?.split("/").pop();
  return (
    <span
      title={brain.model ? `Darwin plans with ${brain.model}` : "No AI key set: Darwin plans with its built-in rules"}
      className={cn("inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-dw-sand pr-3 pl-1.5 text-[13px] font-medium text-dw-ink", className)}
    >
      <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-white text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.06)]">
        {brain.glyph ? <BrandGlyph brand={brain.glyph} size={13} /> : <ListChecks className="size-3.5" />}
      </span>
      <span className="truncate">{brain.label}</span>
      {short && brain.glyph === "openrouter" && <span className="truncate font-dwmono text-[12px] font-normal text-dw-ink/55">{short}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ stage heads */

/** A framed crew member that pops when it changes, and hops when `celebrate` flips on. */
export function StageMascot({ kind, size = 64, active = true, celebrate = false }: { kind: MascotKind; size?: number; active?: boolean; celebrate?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-grid shrink-0" style={{ width: size, height: size }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={kind}
          className="col-start-1 row-start-1 inline-grid"
          initial={reduce ? false : { scale: 0.4, rotate: -24, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: 0.4, rotate: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 19 }}
        >
          <motion.span
            key={celebrate ? "hop" : "rest"}
            className="inline-grid"
            animate={celebrate && !reduce ? { y: [0, -16, 0, -7, 0], rotate: [0, -10, 8, -3, 0] } : undefined}
            transition={{ duration: 0.9, ease: "easeOut" }}
          >
            <Mascot kind={kind} frame size={size} active={active} />
          </motion.span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** H1 46/600 with a crew member, a one-line lede and optional right-hand actions. */
export function StageHead({ mascot, title, lede, right, celebrate }: { mascot: MascotKind; title: ReactNode; lede?: ReactNode; right?: ReactNode; celebrate?: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 items-center gap-4 sm:gap-5">
        <StageMascot kind={mascot} size={64} celebrate={celebrate} />
        <div className="min-w-0">
          <h1 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[46px]">{title}</h1>
          {lede && <p className="mt-2 max-w-[46rem] text-[15.5px] leading-snug text-dw-ink/70 sm:text-[17px]">{lede}</p>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2.5">{right}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ forms */

export const inputCls =
  "h-11 w-full min-w-0 rounded-full border sm:flex-1 border-dw-hairline bg-white px-4 font-dwmono text-[14px] text-dw-ink outline-none placeholder:text-dw-ink/35 focus:border-dw-ink/40 focus-visible:ring-2 focus-visible:ring-dw-ink/15";

export const linkCls =
  "self-start rounded text-[13px] text-dw-ink/55 underline-offset-2 hover:text-dw-ink hover:underline focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none";

export function ErrorLine({ error }: { error: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[16px] bg-dw-warn-bg px-3.5 py-2.5 text-[13.5px] text-dw-warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
    </div>
  );
}

/**
 * A drawer that opens inside the composer (GitHub, Whop): on a computer a section under the field,
 * split off by a hairline (no box inside the box); on a phone a cream sheet above the dock.
 */
export function Drawer({ children }: { children: ReactNode }) {
  // Clipped while it slides open or shut; visible once open, so dropdowns inside can float over the page.
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      onAnimationStart={() => setOpen(false)}
      onAnimationComplete={() => setOpen(true)}
      className={open ? "relative z-30 overflow-visible" : "overflow-hidden"}
    >
      <div className="mx-3 mb-3 rounded-[24px] bg-dw-bg p-4 sm:mx-5 sm:mb-1 sm:rounded-none sm:border-t sm:border-dw-ink/[0.08] sm:bg-transparent sm:px-0 sm:pt-4 sm:pb-2">{children}</div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ paintings */

/** One painting per stage: which one, and which part of it stays in view. */
const STAGE_ART: Record<string, { id: ArtId; pos: string }> = {
  connect: { id: "hero-field", pos: "50% 45%" },
  ask: { id: "lake-marsh", pos: "50% 30%" },
  plan: { id: "forest-path", pos: "50% 35%" },
  install: { id: "castle-dusk", pos: "50% 30%" },
  live: { id: "big-sky", pos: "50% 28%" },
};

/**
 * The stage's painting. Screen 1 sits on it full-bleed (the composer is the crisp object on top); the
 * later stages wear it as a band behind the nav, with the cream sheet of the stage rising over it.
 * Flat: no glow, no fade. Crossfades when the stage changes.
 */
export function StageArt({ stage }: { stage: string }) {
  const art = STAGE_ART[stage] ?? STAGE_ART.connect;
  const full = stage === "connect";
  return (
    <div aria-hidden className={cn("pointer-events-none overflow-hidden bg-[#9fc3dc]", full ? "fixed inset-0" : "absolute inset-x-0 top-0 h-[210px] sm:h-[320px]")}>
      <AnimatePresence initial={false}>
        <motion.div key={art.id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }}>
          <Art id={art.id} position={art.pos} priority={full} sizes="100vw" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ phones */

const PHONE = "(max-width: 639.98px)";

/** True under 640px. False on the server and during hydration, then the real value. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(PHONE);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
