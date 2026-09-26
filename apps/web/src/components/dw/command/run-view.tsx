"use client";

/**
 * One run, as the merchant sees it: what they asked, Darwin's one-line plan, the checklist of steps
 * (queued → spinner → check), an inline confirm for risky steps, and the result with a link.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, LoaderCircle, Minus, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot } from "../mascot";
import { Tag, Typing } from "../ui";
import type { Run, RunStep } from "./store";
import { isLive } from "./store";

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function withMock(href: string, mock: boolean): string {
  if (!mock || !href.startsWith("/console") || /[?&]mock=/.test(href)) return href;
  return href.includes("?") ? `${href}&mock=1` : `${href}?mock=1`;
}

function StatusIcon({ status }: { status: RunStep["status"] }) {
  const base = "grid size-6 shrink-0 place-items-center rounded-full";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "bg-dw-sand")} aria-label="Running">
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
        </span>
      );
    case "done":
      return (
        <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }} className={cn(base, "bg-dw-ink text-white")} aria-label="Done">
          <Check className="size-3.5" strokeWidth={3} />
        </motion.span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-dw-warn-bg text-dw-warn")} aria-label="Failed">
          <X className="size-3.5" strokeWidth={3} />
        </span>
      );
    case "confirm":
      return (
        <span className={cn(base, "bg-dw-yellow text-[13px] font-semibold")} aria-label="Waiting for you">
          ?
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "bg-dw-sand text-dw-ink/40")} aria-label="Skipped">
          <Minus className="size-3.5" />
        </span>
      );
    default:
      return <span className={cn(base, "border-[1.5px] border-dashed border-dw-ink/25")} aria-label="Queued" />;
  }
}

/** Button label for a confirm step: "Roll back", "Ship it", "Stop it". */
function confirmLabel(step: RunStep): string {
  if (step.command === "rollback") return "Roll back";
  if (step.command === "act_on_briefing") return step.input.action === "stop" ? "Stop it" : "Ship it";
  return "Confirm";
}

function Cards({ cards }: { cards: { label: string; value: string }[] }) {
  if (!cards.length) return null;
  const tones = ["bg-dw-yellow", "bg-dw-blue", "bg-dw-olive"];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cards.slice(0, 3).map((c, i) => (
        <div key={c.label} className={cn("flex min-w-0 flex-col gap-0.5 rounded-[16px] px-3.5 py-2.5", tones[i % tones.length])}>
          <span className="truncate text-[12px] text-dw-ink/70">{c.label}</span>
          <span className="num truncate text-[19px] leading-tight font-semibold tracking-[-0.02em]">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

export function RunView({ run, mock, mod, onApprove, onNavigate }: { run: Run; mock: boolean; mod: string; onApprove: (index: number, ok: boolean) => void; onNavigate: () => void }) {
  const reduce = useReducedMotion();
  const live = isLive(run);
  const current = run.steps.find((s) => s.status === "running" || s.status === "confirm");
  const actor = current?.actor ?? run.steps.at(-1)?.actor ?? "analyst";
  const answerOnly = run.steps.length === 1 && run.steps[0].command === "ask_darwin";
  const link = run.status === "done" ? [...run.steps].reverse().find((s) => s.result?.href)?.result : undefined;
  const synthetic = run.steps.some((s) => s.result?.synthetic);
  const sourceLabel = run.origin === "webmcp" ? "Asked by a browser agent (WebMCP)" : run.origin === "api" ? "Asked from window.darwin" : run.source === "llm" ? "Planned by AI" : run.source === "heuristic" ? "Planned from your words" : undefined;

  return (
    <div className="flex flex-col gap-3 px-2 pt-2 pb-3 sm:px-3">
      {/* what they asked */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="max-w-[85%] self-end rounded-[18px_18px_6px_18px] bg-dw-ink px-4 py-2.5 text-[15px] leading-snug text-white"
      >
        {run.text}
      </motion.div>

      <div className="flex gap-3">
        <span className="shrink-0 pt-0.5">
          <Mascot kind={actor} size={34} frame active={live} title="Darwin" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {run.status === "planning" ? (
            <div className="flex h-8 items-center gap-2 text-[14px] text-dw-ink/60">
              <Typing /> <span>Working out the steps…</span>
            </div>
          ) : (
            <>
              {!answerOnly && (
                <div className="flex min-h-8 flex-col justify-center gap-0.5">
                  <p className="text-[15px] leading-snug font-medium">{headline(run)}</p>
                  {sourceLabel && (
                    <span className="text-[12.5px] leading-snug text-dw-ink/55">
                      {sourceLabel}
                      {run.source === "llm" && run.say ? `: ${run.say}` : ""}
                    </span>
                  )}
                </div>
              )}

              {answerOnly ? (
                <AnswerBlock step={run.steps[0]} />
              ) : (
                <ol className="flex flex-col gap-0.5 rounded-[20px] bg-white/75 p-1.5 shadow-[0_0_0_1px_#EDE4D2]" aria-label="Steps">
                  {run.steps.map((s, i) => (
                    <motion.li
                      key={`${s.command}-${i}`}
                      initial={reduce ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, ease: EASE, delay: i * 0.06 }}
                      className={cn("flex items-start gap-3 rounded-[15px] px-2.5 py-2", s.status === "running" && "bg-dw-sand/60")}
                    >
                      <StatusIcon status={s.status} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("text-[14.5px] leading-6 font-medium", s.status === "skipped" && "text-dw-ink/40 line-through decoration-dw-ink/30")}>{s.label}</span>
                          {s.risk === "confirm" && (s.status === "queued" || s.status === "confirm") && <Tag tone="warn">Asks you first</Tag>}
                        </div>
                        {s.status === "confirm" && (
                          <div className="flex flex-col gap-2.5 rounded-[16px] bg-dw-yellow/70 px-3.5 py-3" role="alertdialog" aria-label="Confirm this step">
                            <p className="text-[14px] leading-snug">{s.confirmText ?? `${s.label}?`}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onApprove(i, true)}
                                className="h-9 rounded-full bg-dw-ink px-4 text-[13.5px] font-medium text-white transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-95"
                              >
                                {confirmLabel(s)}
                              </button>
                              <button
                                type="button"
                                onClick={() => onApprove(i, false)}
                                className="h-9 rounded-full bg-white/80 px-4 text-[13.5px] font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
                              >
                                Cancel
                              </button>
                              <span className="text-[12px] text-dw-ink/60 max-sm:hidden">{mod} ↵ to confirm · esc to cancel</span>
                            </div>
                          </div>
                        )}
                        {s.result && s.status !== "confirm" && (
                          <p className={cn("text-[13.5px] leading-snug", s.result.ok || s.status === "skipped" ? "text-dw-ink/70" : "text-dw-warn")}>{s.result.text}</p>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </ol>
              )}

              {run.status === "failed" && !run.steps.length && <p className="text-[14px] text-dw-warn">{run.say}</p>}

              {!live && (link?.href || synthetic) && (
                <motion.div initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex flex-wrap items-center gap-2">
                  {link?.href && (
                    <Link
                      href={withMock(link.href, mock)}
                      onClick={onNavigate}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-dw-ink px-4 text-[13.5px] font-medium text-white transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
                    >
                      {link.linkLabel ?? "Open"} <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                  {synthetic && <Tag tone="warn">Simulated traffic</Tag>}
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "On it: step 2 of 3", "Needs your OK", "Done: all 3 steps." */
function headline(run: Run): string {
  const n = run.steps.length;
  const at = run.steps.findIndex((s) => s.status === "running" || s.status === "confirm");
  switch (run.status) {
    case "waiting":
      return n > 1 ? `Step ${at + 1} of ${n} needs your OK first.` : "This one needs your OK first.";
    case "running":
      return n > 1 && at >= 0 ? `On it: step ${at + 1} of ${n}.` : "On it.";
    case "done":
      return n > 1 ? `Done: all ${n} steps.` : "Done.";
    case "failed": {
      const f = run.steps.findIndex((s) => s.status === "failed");
      return n > 1 && f >= 0 ? `Stopped at step ${f + 1} of ${n}.` : "That didn't work.";
    }
    case "cancelled":
      return "Cancelled.";
    default:
      return "";
  }
}

function AnswerBlock({ step }: { step: RunStep }) {
  if (step.status === "running" || step.status === "queued") {
    return (
      <div className="flex h-8 items-center">
        <Typing />
      </div>
    );
  }
  const data = step.result?.data as { cards?: { label: string; value: string }[]; source?: string } | undefined;
  return (
    <div className="flex flex-col gap-2.5">
      <p className={cn("text-[15.5px] leading-[1.55]", step.result && !step.result.ok && "text-dw-warn")}>{step.result?.text}</p>
      <Cards cards={data?.cards ?? []} />
      {data?.source && <span className="text-[12px] text-dw-ink/50">{data.source === "llm" ? "AI answer from your numbers" : "Answered from your numbers"}</span>}
    </div>
  );
}
