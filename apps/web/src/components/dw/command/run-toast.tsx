"use client";

/**
 * The run toast: top-centre, below the nav. Shows a run the ⌘K sheet isn't showing (it navigated away,
 * the sheet was closed mid-run, or a browser agent / window.darwin ran a command): the step in progress,
 * then the result with its link. Hides itself 7 s after the run ends (not while hovered).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { withMock } from "./run-view";
import { useCommandRuntime, useCommandState } from "./runtime";
import { isLive } from "./store";

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function RunToast() {
  const rt = useCommandRuntime();
  const state = useCommandState();
  const reduce = useReducedMotion();
  const { mock } = useDarwin();
  const [hover, setHover] = useState(false);
  const run = state?.toastId ? state.runs[state.toastId] : undefined;
  const show = !!run && !(state?.open && state.runId === run.id);
  const live = isLive(run);

  useEffect(() => {
    if (!rt || !run || live || hover) return;
    const t = setTimeout(() => rt.dismissToast(), 7000);
    return () => clearTimeout(t);
  }, [rt, run, live, hover]);

  if (!rt) return null;

  const current = run?.steps.find((s) => s.status === "running" || s.status === "confirm");
  const index = current && run ? run.steps.indexOf(current) : -1;
  const done = run ? [...run.steps].reverse().find((s) => s.result) : undefined;
  const link = run && !live ? [...run.steps].reverse().find((s) => s.result?.href)?.result : undefined;
  const who = run?.origin === "webmcp" ? "A browser agent: " : run?.origin === "api" ? "window.darwin: " : "";
  const text = !run
    ? ""
    : run.status === "planning"
      ? "Working out the steps…"
      : live && current
        ? `${run.steps.length > 1 ? `Step ${index + 1} of ${run.steps.length}: ` : ""}${current.status === "confirm" ? `waiting for you: ${current.label}` : `${current.label}…`}`
        : run.status === "cancelled"
          ? "Cancelled. Nothing changed."
          : (done?.result?.text ?? run.say);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(58px+env(safe-area-inset-top))] z-[65] flex justify-center px-3 sm:top-[88px]">
      <AnimatePresence>
        {show && run && (
          <motion.div
            key={run.id}
            role="status"
            aria-live="polite"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.18 } }}
            transition={{ duration: 0.38, ease: EASE, delay: 0.12 }}
            className="pointer-events-auto flex w-full max-w-[600px] items-center gap-3 rounded-[24px] bg-dw-ink py-2 pr-2 pl-2.5 text-white shadow-[0_18px_50px_-18px_rgba(20,20,19,0.55)]"
          >
            <Mascot kind={current?.actor ?? done?.actor ?? "analyst"} size={36} frame active={live} title="Darwin" />
            <button type="button" onClick={() => rt.open({ runId: run.id })} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
              <span className="line-clamp-2 text-[14px] leading-snug">
                {who && <span className="text-white/60">{who}</span>}
                {text}
              </span>
              {live && run.steps.length > 1 && (
                <span className="mt-1.5 flex gap-1" aria-hidden>
                  {run.steps.map((s, i) => (
                    <span key={i} className={s.status === "done" ? "h-1 w-5 rounded-full bg-white" : s.status === "running" ? "h-1 w-5 animate-pulse rounded-full bg-white/60" : "h-1 w-5 rounded-full bg-white/20"} />
                  ))}
                </span>
              )}
            </button>
            {link?.href && (
              <Link
                href={withMock(link.href, mock)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-white/[0.14] px-3.5 text-[13px] font-medium transition-colors hover:bg-white/25"
              >
                {link.linkLabel ?? "Open"} <ArrowRight className="size-3.5" />
              </Link>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => rt.dismissToast()} className="grid size-9 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
