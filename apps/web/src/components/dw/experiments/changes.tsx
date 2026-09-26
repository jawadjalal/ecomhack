"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Experiment, LoopState } from "@/lib/contracts";
import { signedPct, timeAgo } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot } from "../mascot";
import { Card, DEPTH, Tag } from "../ui";
import { ListCard } from "./frame";
import { appHref, chance, historyFor, outcomeOf, type ChangeRow, type Outcome } from "./model";
import { Tip } from "./tip";

const WHO: Record<ChangeRow["seenBy"], { label: string; dot: string; tip: string }> = {
  people: { label: "People", dot: "bg-dw-blue", tip: "A page change: only people see it" },
  agents: { label: "Agents", dot: "bg-dw-pink", tip: "Lives in the store API: only AI shoppers see it" },
  both: { label: "Both", dot: "bg-dw-blue ring-[3px] ring-inset ring-dw-pink", tip: "People see it on the page, agents feel it in the price with delivery" },
};

export function WhatChangesCard({ rows, source }: { rows: ChangeRow[]; source?: string }) {
  const reduce = useReducedMotion();
  return (
    <Card tone="white" hover={false} className={`rounded-[28px] p-5 sm:px-6 ${DEPTH}`} aria-label="What the new version changes">
      <div className="flex flex-wrap items-center gap-2.5 px-1.5 pb-3">
        <Mascot kind="designer" size={30} active />
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">What the new version changes</h2>
        {source && <span className="ml-auto text-[13px] text-dw-ink/55">{source}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-4 text-[14px] text-dw-ink/60">Theo didn&apos;t log the page settings for this test, so there&apos;s nothing to compare.</p>
      ) : (
        <div role="table" aria-label="Settings the new version changes">
          <div role="row" className="grid grid-cols-[1.5fr_1.2fr_0.7fr_1.5fr] px-3.5 pb-2 text-[13px] text-[#8A8478] max-md:hidden">
            <span role="columnheader">Setting</span>
            <span role="columnheader">Before → after</span>
            <span role="columnheader">Seen by</span>
            <span role="columnheader">Problem it fixes</span>
          </div>
          {rows.map((r, i) => (
            <motion.div
              key={r.path}
              role="row"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="dw-row grid items-center gap-x-4 gap-y-1.5 rounded-[16px] px-3.5 py-3 text-[15px] hover:bg-[#F6F0E4] md:min-h-14 md:grid-cols-[1.5fr_1.2fr_0.7fr_1.5fr] md:py-2"
            >
              <span role="cell" className="font-semibold">
                {r.setting}
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2.5 font-dwmono text-[13px]">
                <span className="max-w-[40%] shrink-0 truncate text-[#8A8478] line-through" title={r.a}>
                  {r.a}
                </span>
                <ArrowRight className="size-3.5 shrink-0" aria-label="becomes" />
                <span className="dw-tilt min-w-0 truncate rounded-full bg-dw-ink px-2.5 py-0.5 text-white" title={r.b}>
                  {r.b}
                </span>
              </span>
              <span role="cell">
                <Tip tip={WHO[r.seenBy].tip} align="start">
                  <span tabIndex={0} className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
                    <span className={cn("size-2.5 rounded-full", WHO[r.seenBy].dot)} />
                    {WHO[r.seenBy].label}
                  </span>
                </Tip>
              </span>
              <span role="cell" className="text-dw-ink/75">
                {r.leak ?? "A new idea, not tied to one problem"}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ every test (the list) */

const OUTCOME: Record<Outcome, { label: string; className: string }> = {
  running: { label: "Testing now", className: "bg-dw-pink text-dw-ink" },
  shipped: { label: "Won, shipped", className: "bg-dw-olive text-dw-ink" },
  lost: { label: "Lost", className: "bg-dw-sand text-dw-ink/70" },
  unclear: { label: "No clear winner", className: "bg-dw-sand text-dw-ink/70" },
  stopped: { label: "Stopped", className: "bg-dw-sand text-dw-ink/70" },
};

export function PastExperiments({
  experiments,
  loop,
  selectedId,
  onSelect,
  now,
  mock,
}: {
  mock: boolean;
  experiments: Experiment[];
  loop: LoopState | undefined;
  selectedId?: string;
  onSelect: (id: string) => void;
  now: number;
}) {
  const reduce = useReducedMotion();
  return (
    <ListCard title="Every test" meta={`${experiments.length} · newest first`} label="Every test">
      <ul className="flex flex-col gap-1.5">
        {experiments.map((e, i) => {
          const outcome = outcomeOf(e, loop);
          const rec = historyFor(e, loop);
          const on = e.id === selectedId;
          const r = e.result;
          return (
            <motion.li
              key={e.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.3 }}
              className="relative"
            >
              {on && (
                <motion.span
                  layoutId="dw-exp-past-sel"
                  className="absolute inset-0 rounded-[20px] bg-dw-pink shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <div className={cn("dw-row relative flex flex-col gap-1.5 rounded-[20px] border px-3.5 py-3", on ? "border-dw-pink-shape" : "border-transparent hover:bg-[#F6F0E4]")}>
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold", on && outcome !== "shipped" ? "bg-white/70 text-dw-ink" : OUTCOME[outcome].className)}>
                    {OUTCOME[outcome].label}
                  </span>
                  <span className="relative z-10 ml-auto flex items-center gap-2 text-[12.5px] text-dw-ink/55">
                    {outcome === "shipped" && rec ? (
                      <Link
                        href={appHref(`/console/changes#gen-${rec.generation}`, mock)}
                        className="inline-flex h-6 items-center gap-1 rounded-full bg-dw-ink px-2.5 text-[12px] font-medium text-white transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none"
                      >
                        Version {rec.generation} <ArrowUpRight className="size-3" aria-hidden />
                      </Link>
                    ) : (
                      <span className="num">{timeAgo(e.completedAt ?? e.createdAt, now)}</span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-pressed={on}
                  className="min-w-0 rounded-md text-left text-[15px] leading-snug font-semibold outline-none after:absolute after:inset-0 after:rounded-[20px] focus-visible:after:ring-2 focus-visible:after:ring-dw-ink"
                >
                  {e.name}
                </button>
                {r && (
                  <span className="num text-[12.5px] text-dw-ink/65">
                    <b className={cn("font-semibold text-dw-ink", r.lift < 0 && "text-dw-ink/55")}>{signedPct(r.lift)}</b> · {chance(r.probabilityToBeat)} chance the new version is better
                  </span>
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </ListCard>
  );
}

/** Small tag for the detail header: what happened to this test. */
export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  return <Tag className={OUTCOME[outcome].className}>{OUTCOME[outcome].label}</Tag>;
}
